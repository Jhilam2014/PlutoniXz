#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const workspaceRoot = path.join(root, "models", "huggingface");
const manifestPath = path.join(workspaceRoot, "model-manifest.json");
const repositoriesRoot = path.join(workspaceRoot, "repositories");
const servicesRoot = path.join(workspaceRoot, "services");

function safeName(value = "model") {
  return String(value || "model")
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\//g, "__")
    .slice(0, 160) || "model";
}

async function ensureWorkspace() {
  await fs.mkdir(repositoriesRoot, { recursive: true });
  await fs.mkdir(servicesRoot, { recursive: true });
  try {
    await fs.access(manifestPath);
  } catch {
    await writeManifest({ version: 1, models: [], services: [], updatedAt: new Date().toISOString() });
  }
}

async function readManifest() {
  await ensureWorkspace();
  return JSON.parse(await fs.readFile(manifestPath, "utf8"));
}

async function writeManifest(manifest) {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify({ version: 1, models: [], services: [], ...manifest, updatedAt: new Date().toISOString() }, null, 2) + "\n");
}

function localDirFor(repoId) {
  return path.join(repositoriesRoot, safeName(repoId));
}

function modelApiUrl(repoId) {
  const encodedRepo = String(repoId || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://huggingface.co/api/models/${encodedRepo}?blobs=1`;
}

function formatModelSize(bytes) {
  const numericBytes = Number(bytes);
  if (!Number.isFinite(numericBytes) || numericBytes <= 0) return { sizeBytes: null, sizeGb: null, sizeLabel: "unknown size" };
  const sizeGb = Number((numericBytes / 1_000_000_000).toFixed(2));
  return {
    sizeBytes: Math.round(numericBytes),
    sizeGb,
    sizeLabel: `${sizeGb.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`
  };
}

function estimateModelSize(model = {}) {
  const siblingSize = Array.isArray(model.siblings)
    ? model.siblings.reduce((sum, item) => sum + (Number.isFinite(Number(item?.size)) ? Number(item.size) : 0), 0)
    : 0;
  return formatModelSize(Number(model.usedStorage) > 0 ? Number(model.usedStorage) : siblingSize);
}

async function fetchModelSize(repoId) {
  try {
    const response = await fetch(modelApiUrl(repoId));
    if (!response.ok) return { ...formatModelSize(null), sizeSource: `model_api_unavailable_${response.status}` };
    return { ...estimateModelSize(await response.json()), sizeSource: "huggingface_model_api" };
  } catch (error) {
    return { ...formatModelSize(null), sizeSource: "model_api_error", sizeError: String(error.message || error).slice(0, 200) };
  }
}

function splitPatterns(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function partialDownloadsEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.HF_MODEL_PARTIAL_DOWNLOAD || ""));
}

async function addModel(repoId, task = "") {
  if (!repoId || !repoId.includes("/")) throw new Error("Usage: npm run hf:models:add -- namespace/model [task]");
  const manifest = await readManifest();
  const current = manifest.models || [];
  const existing = current.find((model) => model.repoId === repoId);
  const size = await fetchModelSize(repoId);
  console.error(`Selected Hugging Face model ${repoId} size: ${size.sizeLabel}`);
  const entry = {
    repoId,
    task: task || existing?.task || "",
    localDir: path.relative(root, localDirFor(repoId)).split(path.sep).join("/"),
    status: existing?.status || "registered",
    ...size,
    addedAt: existing?.addedAt || new Date().toISOString()
  };
  await writeManifest({ ...manifest, models: [...current.filter((model) => model.repoId !== repoId), entry] });
  console.log(JSON.stringify(entry, null, 2));
}

async function downloadModel(repoId = "") {
  const manifest = await readManifest();
  const targets = repoId ? [{ repoId, task: manifest.models?.find((model) => model.repoId === repoId)?.task || "" }] : manifest.models || [];
  if (!targets.length) throw new Error("No Hugging Face models registered. Run: npm run hf:models:add -- namespace/model");
  const completed = [];
  for (const target of targets) {
    const localDir = localDirFor(target.repoId);
    await fs.mkdir(localDir, { recursive: true });
    const size = await fetchModelSize(target.repoId);
    console.error(`Selected Hugging Face model ${target.repoId} size: ${size.sizeLabel}`);
    const args = ["download", target.repoId, "--local-dir", localDir];
    const allowPartial = partialDownloadsEnabled();
    const downloadMode = allowPartial ? "partial-explicit" : "full-repository-with-weights";
    if (allowPartial) {
      for (const pattern of splitPatterns(process.env.HF_MODEL_INCLUDE)) args.push("--include", pattern);
      for (const pattern of splitPatterns(process.env.HF_MODEL_EXCLUDE)) args.push("--exclude", pattern);
    }
    await execFileAsync("hf", args, { stdio: "inherit", maxBuffer: 1024 * 1024 * 8 });
    completed.push({
      repoId: target.repoId,
      task: target.task || "",
      localDir: path.relative(root, localDir).split(path.sep).join("/"),
      status: "downloaded",
      downloadMode,
      ...size,
      downloadedAt: new Date().toISOString()
    });
  }
  await writeManifest({
    ...manifest,
    models: [...(manifest.models || []).filter((model) => !completed.some((item) => item.repoId === model.repoId)), ...completed]
  });
  console.log(JSON.stringify({ downloaded: completed }, null, 2));
}

async function buildServices() {
  const manifest = await readManifest();
  const services = [];
  for (const model of manifest.models || []) {
    const repoId = model.repoId;
    if (!repoId) continue;
    const localDir = localDirFor(repoId);
    let exists = false;
    try {
      exists = (await fs.stat(localDir)).isDirectory();
    } catch {
      exists = false;
    }
    const service = {
      id: `hf_${safeName(repoId)}`,
      repoId,
      task: model.task || "",
      localDir: path.relative(root, localDir).split(path.sep).join("/"),
      status: exists ? "ready" : "missing-download",
      runtime: "local-huggingface",
      downloadMode: model.downloadMode || "full-repository-with-weights",
      sizeBytes: model.sizeBytes ?? null,
      sizeGb: model.sizeGb ?? null,
      sizeLabel: model.sizeLabel || "unknown size",
      instructions: [
        "Read the local model card before adding inference code.",
        "Use this local repository path instead of remote inference provider calls.",
        "Keep credentials in environment variables only."
      ],
      builtAt: new Date().toISOString()
    };
    await fs.writeFile(path.join(servicesRoot, `${safeName(repoId)}.json`), JSON.stringify(service, null, 2) + "\n");
    services.push(service);
  }
  await writeManifest({ ...manifest, services });
  console.log(JSON.stringify({ services }, null, 2));
}

async function status() {
  const manifest = await readManifest();
  const models = [];
  for (const model of manifest.models || []) {
    let repositoryReady = false;
    try {
      repositoryReady = (await fs.stat(localDirFor(model.repoId))).isDirectory();
    } catch {
      repositoryReady = false;
    }
    models.push({ ...model, repositoryReady });
  }
  console.log(JSON.stringify({ workspace: path.relative(root, workspaceRoot), models, services: manifest.services || [] }, null, 2));
}

async function main() {
  const [command = "status", repoId = "", task = ""] = process.argv.slice(2);
  if (command === "add") return addModel(repoId, task);
  if (command === "download") return downloadModel(repoId);
  if (command === "build") return buildServices();
  if (command === "status") return status();
  throw new Error(`Unknown command "${command}". Use add, download, build, or status.`);
}

main().catch((error) => {
  const message = error.code === "ENOENT" ? "HF CLI is not installed. Install with: curl -LsSf https://hf.co/cli/install.sh | bash -s" : error.message;
  console.error(message);
  process.exit(1);
});
