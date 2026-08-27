import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function nowIso() {
  return new Date().toISOString();
}

function safeFileBase(value = "") {
  return String(value || "model")
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\//g, "__")
    .slice(0, 160) || "model";
}

function stableHash(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function compact(value = "", max = 600) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function modelApiUrl(repoId, searchParams = {}) {
  const encodedRepo = String(repoId || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const url = new URL(`https://huggingface.co/api/models/${encodedRepo}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

export function formatModelSize(bytes) {
  const numericBytes = Number(bytes);
  if (!Number.isFinite(numericBytes) || numericBytes <= 0) {
    return {
      sizeBytes: null,
      sizeGb: null,
      sizeLabel: "unknown size"
    };
  }
  const sizeGb = Number((numericBytes / 1_000_000_000).toFixed(2));
  return {
    sizeBytes: Math.round(numericBytes),
    sizeGb,
    sizeLabel: `${sizeGb.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`
  };
}

export function estimateHuggingFaceModelSize(model = {}) {
  const siblingSize = Array.isArray(model.siblings)
    ? model.siblings.reduce((sum, item) => sum + (Number.isFinite(Number(item?.size)) ? Number(item.size) : 0), 0)
    : 0;
  const bytes = Number(model.usedStorage) > 0 ? Number(model.usedStorage) : siblingSize;
  return formatModelSize(bytes);
}

function modelPoolRoot(root) {
  return path.join(root, "runtime", "model-pool", "huggingface");
}

function ledgerPath(root) {
  return path.join(modelPoolRoot(root), "models.jsonl");
}

function serviceRegistryPath(root) {
  return path.join(modelPoolRoot(root), "services.jsonl");
}

function latestStatusPath(root) {
  return path.join(root, "observability", "model-pool", "huggingface-latest.json");
}

async function appendJsonLine(filePath, value) {
  await fs.ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`);
}

async function readJsonLines(filePath) {
  if (!(await fs.pathExists(filePath))) return [];
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function inferHuggingFaceModelIntent(instruction = "") {
  const text = String(instruction || "");
  const lower = text.toLowerCase();
  const requested = /\b(hugging\s*face|huggingface|\bhf\b|transformers?|model card|local model|download(?: the)? model)\b/i.test(text);
  const searchRequested = requested && /\b(search|find|relevant|suitable|best|choose|recommend)\b/i.test(text);
  const explicitModelIds = [...text.matchAll(/\b([A-Za-z0-9][\w.-]+\/[A-Za-z0-9][\w.-]+)\b/g)]
    .map((match) => match[1])
    .filter((id) => !/\.(png|jpe?g|webp|gif|mp4|mov|json|js|ts|jsx|tsx)$/i.test(id));
  let task = "";
  if (/image[- ]?to[- ]?video|i2v|video/.test(lower)) task = "image-to-video";
  else if (/text[- ]?to[- ]?image|image generation|generate image/.test(lower)) task = "text-to-image";
  else if (/classif|sentiment|categor/.test(lower)) task = "text-classification";
  else if (/embed|similarity|retrieval|vector/.test(lower)) task = "feature-extraction";
  else if (/summari[sz]|brief|compress/.test(lower)) task = "summarization";
  else if (/question|answer|qa\b/.test(lower)) task = "question-answering";
  else if (/text generation|chat|llm|language model/.test(lower)) task = "text-generation";
  return {
    requested,
    searchRequested,
    explicitModelIds: [...new Set(explicitModelIds)],
    task,
    reason: requested ? searchRequested ? "hf_search_requested" : explicitModelIds.length ? "explicit_hf_model" : "hf_model_instruction" : "not_hf"
  };
}

export function localModelRoutingForTask({ taskType = "Medium", workflowMode = "executor", target = "project", instruction = "" } = {}) {
  return {
    preferredProvider: "governed-brainx",
    enforceLocalHuggingFace: false,
    requiresGovernedRoute: true,
    reason: "Task size and instruction keywords are advisory only. AIX must select a registered model through enterprise policy, budget, data, region, licence, and health gates.",
    workflowMode,
    target,
    taskType,
    instructionClass: /\b(hugging\s*face|huggingface|\bhf\b)\b/i.test(instruction) ? "huggingface_candidate_requested" : "standard"
  };
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

export function huggingFaceDownloadArgs(repoId, localDir, { revision = "", allowPartial = false, include = "", exclude = "" } = {}) {
  const args = ["download", repoId, "--local-dir", localDir];
  if (revision) args.push("--revision", revision);
  if (allowPartial) {
    for (const pattern of splitPatterns(include)) args.push("--include", pattern);
    for (const pattern of splitPatterns(exclude)) args.push("--exclude", pattern);
  }
  return args;
}

export function createHuggingFaceModelPool({ root, emit = () => {} } = {}) {
  if (!root) throw new Error("Hugging Face model pool requires a PlutoniX root.");
  const poolRoot = modelPoolRoot(root);
  const modelsRoot = path.join(poolRoot, "models");
  const readmeRoot = path.join(poolRoot, "model-cards");

  async function record(record) {
    const row = {
      id: record.id || `hf_${stableHash(`${record.repoId || record.query || ""}:${Date.now()}`).slice(0, 16)}`,
      recordedAt: nowIso(),
      ...record
    };
    await appendJsonLine(ledgerPath(root), row);
    await fs.ensureDir(path.dirname(latestStatusPath(root)));
    await fs.writeJson(latestStatusPath(root), await status(), { spaces: 2 });
    return row;
  }

  async function listModels({ limit = 100 } = {}) {
    const rows = await readJsonLines(ledgerPath(root));
    return rows.sort((a, b) => new Date(b.recordedAt || 0) - new Date(a.recordedAt || 0)).slice(0, limit);
  }

  async function listServices({ limit = 100 } = {}) {
    const rows = await readJsonLines(serviceRegistryPath(root));
    return rows.sort((a, b) => new Date(b.recordedAt || 0) - new Date(a.recordedAt || 0)).slice(0, limit);
  }

  async function searchModels({ query = "", task = "", limit = 5 } = {}) {
    const url = new URL("https://huggingface.co/api/models");
    if (query) url.searchParams.set("search", query);
    if (task) url.searchParams.set("pipeline_tag", task);
    url.searchParams.set("sort", "downloads");
    url.searchParams.set("direction", "-1");
    url.searchParams.set("limit", String(Math.min(Math.max(Number(limit) || 5, 1), 10)));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Hugging Face model search failed: ${response.status}`);
    const models = (await response.json()).map((model) => {
      const size = estimateHuggingFaceModelSize(model);
      return {
        id: model.id,
        pipeline_tag: model.pipeline_tag || "",
        library_name: model.library_name || "",
        downloads: model.downloads || 0,
        likes: model.likes || 0,
        private: Boolean(model.private),
        gated: Boolean(model.gated),
        tags: (model.tags || []).slice(0, 12),
        ...size
      };
    });
    await record({
      type: "search",
      status: "completed",
      query,
      task,
      resultCount: models.length,
      results: models
    });
    return models;
  }

  async function fetchModelSize(repoId) {
    try {
      const response = await fetch(modelApiUrl(repoId, { blobs: 1 }));
      if (!response.ok) return { ...formatModelSize(null), sizeSource: `model_api_unavailable_${response.status}` };
      return {
        ...estimateHuggingFaceModelSize(await response.json()),
        sizeSource: "huggingface_model_api"
      };
    } catch (error) {
      return {
        ...formatModelSize(null),
        sizeSource: "model_api_error",
        sizeError: compact(error.message, 200)
      };
    }
  }

  async function fetchModelCard(repoId, revision = "main") {
    const response = await fetch(`https://huggingface.co/${repoId}/raw/${encodeURIComponent(revision)}/README.md`);
    if (!response.ok) return { readme: "", readmePath: "", status: `readme_unavailable_${response.status}` };
    const readme = await response.text();
    const readmePath = path.join(readmeRoot, `${safeFileBase(repoId)}.md`);
    await fs.ensureDir(path.dirname(readmePath));
    await fs.writeFile(readmePath, readme);
    return { readme: readme.slice(0, 20000), readmePath, status: "readme_saved" };
  }

  async function downloadModel({ repoId, task = "", sourceInstruction = "", dryRun = false, governedApproval = null } = {}) {
    if (!repoId) throw new Error("repoId is required.");
    const approval = governedApproval && typeof governedApproval === "object" ? governedApproval : null;
    const revision = String(approval?.immutableRevision || "").trim();
    const approved = approval?.status === "approved" && /^[a-f0-9]{40,64}$/i.test(revision)
      && /^[a-f0-9]{64}$/i.test(String(approval?.artifactChecksum || ""));
    if (!approved) {
      return record({
        type: "download",
        status: "blocked",
        repoId,
        task,
        sourceInstruction: compact(sourceInstruction),
        reason: "governed_registration_and_human_approval_required",
        note: "Hugging Face artifacts are staged only after a pinned BrainX registration, artefact verification, policy review, and explicit human approval."
      });
    }
    const localDir = path.join(modelsRoot, safeFileBase(repoId));
    const size = await fetchModelSize(repoId);
    emit("hf-model-size-estimated", `Selected Hugging Face model ${repoId} size: ${size.sizeLabel}`, {
      repoId,
      sizeBytes: size.sizeBytes,
      sizeGb: size.sizeGb,
      sizeLabel: size.sizeLabel,
      sizeSource: size.sizeSource
    });
    const card = await fetchModelCard(repoId, revision).catch(() => ({ readme: "", readmePath: "", status: "not_fetched" }));
    if (dryRun) {
      return record({
        type: "download",
        status: "planned",
        repoId,
        immutableRevision: revision,
        task,
        localDir,
        readmePath: card.readmePath,
        downloadMode: "full-repository-with-weights",
        ...size,
        sourceInstruction: compact(sourceInstruction),
        note: "Dry run: model card was read, but hf download was not executed."
      });
    }
    const startedAt = Date.now();
    const allowPartial = partialDownloadsEnabled();
    const downloadMode = allowPartial ? "partial-explicit" : "full-repository-with-weights";
    const downloadArgs = huggingFaceDownloadArgs(repoId, localDir, {
      revision,
      allowPartial,
      include: process.env.HF_MODEL_INCLUDE,
      exclude: process.env.HF_MODEL_EXCLUDE
    });
    try {
      await fs.ensureDir(localDir);
      await execFileAsync("hf", downloadArgs, {
        cwd: root,
        timeout: Number(process.env.HF_MODEL_DOWNLOAD_TIMEOUT_MS || 20 * 60 * 1000),
        maxBuffer: 1024 * 1024 * 8
      });
      const service = await registerLocalService({ repoId, task, localDir, downloadMode, size });
      emit("hf-model-downloaded", `Downloaded Hugging Face model ${repoId} locally`, { repoId, localDir, serviceId: service.id });
      return record({
        type: "download",
        status: "completed",
        repoId,
        immutableRevision: revision,
        task,
        localDir,
        readmePath: card.readmePath,
        durationMs: Date.now() - startedAt,
        serviceId: service.id,
        downloadMode,
        ...size,
        sourceInstruction: compact(sourceInstruction)
      });
    } catch (error) {
      const failure = await record({
        type: "download",
        status: "failed",
        repoId,
        immutableRevision: revision,
        task,
        localDir,
        readmePath: card.readmePath,
        durationMs: Date.now() - startedAt,
        downloadMode,
        ...size,
        error: error.code === "ENOENT" ? "HF CLI is not installed. Install with: curl -LsSf https://hf.co/cli/install.sh | bash -s" : error.message,
        sourceInstruction: compact(sourceInstruction)
      });
      emit("hf-model-download-failed", failure.error, { repoId, localDir });
      return failure;
    }
  }

  async function registerLocalService({ repoId, task = "", localDir = "", downloadMode = "full-repository-with-weights", size = {} } = {}) {
    const service = {
      id: `hf_service_${stableHash(repoId).slice(0, 16)}`,
      recordedAt: nowIso(),
      status: "registered",
      repoId,
      task,
      localDir,
      runtime: "local-huggingface",
      downloadMode,
      sizeBytes: size.sizeBytes ?? null,
      sizeGb: size.sizeGb ?? null,
      sizeLabel: size.sizeLabel || "unknown size",
      endpoint: `/api/model-pool/huggingface/services/${safeFileBase(repoId)}`,
      instructions: [
        "Run through the local model pool service adapter.",
        "Prefer @huggingface/transformers for small text tasks when the model supports Transformers.js.",
        "Use the saved Hugging Face model card before creating task-specific inference code."
      ]
    };
    await appendJsonLine(serviceRegistryPath(root), service);
    return service;
  }

  async function prepareFromInstruction({ instruction = "", limit = 3, autoDownload = false } = {}) {
    const intent = inferHuggingFaceModelIntent(instruction);
    if (!intent.requested) return { intent, actions: [] };
    const candidates = intent.explicitModelIds.slice(0, limit).map((repoId) => ({
      repoId,
      task: intent.task,
      status: "requires_governed_registration",
      reason: "Pinned revision, artifact checksum, licence, hardware, policy, and human approval are required before acquisition."
    }));
    return {
      intent,
      actions: candidates,
      status: autoDownload ? "blocked_governed_approval_required" : "staged_candidates_only",
      search: intent.searchRequested ? "not_performed_without_an_approved_research_source" : "not_requested"
    };
  }

  async function status() {
    const [models, services] = await Promise.all([listModels({ limit: 200 }), listServices({ limit: 200 })]);
    const downloads = models.filter((row) => row.type === "download");
    return {
      status: "ok",
      poolRoot,
      modelsRoot,
      totalRecords: models.length,
      downloads: downloads.length,
      downloaded: downloads.filter((row) => row.status === "completed").length,
      planned: downloads.filter((row) => row.status === "planned").length,
      failed: downloads.filter((row) => row.status === "failed").length,
      services: services.length,
      latest: models[0] || null,
      performance: {
        completedDownloads: downloads.filter((row) => row.status === "completed").length,
        averageDownloadMs: Math.round(
          downloads.filter((row) => Number.isFinite(row.durationMs)).reduce((sum, row) => sum + row.durationMs, 0) /
            Math.max(1, downloads.filter((row) => Number.isFinite(row.durationMs)).length)
        )
      }
    };
  }

  return {
    inferHuggingFaceModelIntent,
    localModelRoutingForTask,
    searchModels,
    fetchModelSize,
    downloadModel,
    prepareFromInstruction,
    registerLocalService,
    listModels,
    listServices,
    status
  };
}
