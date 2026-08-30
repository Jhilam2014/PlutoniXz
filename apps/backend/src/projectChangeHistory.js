import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const HISTORY_VERSION = 1;
const MAX_HISTORY_RECORDS = 20;
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".cache",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules"
]);

export class ProjectChangeHistoryError extends Error {
  constructor(message, code = "history_failed") {
    super(message);
    this.name = "ProjectChangeHistoryError";
    this.code = code;
  }
}

function safeSegment(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "project";
}

function historyDirectory(root, projectId) {
  const resolvedRoot = path.resolve(root || process.cwd());
  return path.join(resolvedRoot, "runtime", "gotham-change-history", safeSegment(projectId));
}

function assertWorkspace(workspaceDir) {
  const resolved = path.resolve(String(workspaceDir || ""));
  if (!workspaceDir || resolved === path.parse(resolved).root) {
    throw new ProjectChangeHistoryError("The project workspace is not safe to checkpoint.", "unsafe_workspace");
  }
  return resolved;
}

function excludedFile(name) {
  if (name === ".DS_Store" || name.endsWith(".log")) return true;
  if (name === ".env") return true;
  if (name.startsWith(".env.") && !name.endsWith(".example")) return true;
  return false;
}

async function hashFile(filePath) {
  const contents = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function scanWorkspace(workspaceDir) {
  const workspace = assertWorkspace(workspaceDir);
  const entries = [];
  let totalBytes = 0;

  async function visit(directory, relativeDirectory = "") {
    const children = await fs.readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (child.isDirectory() && EXCLUDED_DIRECTORIES.has(child.name)) continue;
      if (!child.isDirectory() && excludedFile(child.name)) continue;
      const relativePath = path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), child.name);
      const absolutePath = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      const stats = await fs.lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        entries.push({ path: relativePath, type: "symlink", target: await fs.readlink(absolutePath) });
        continue;
      }
      if (!stats.isFile()) continue;
      totalBytes += stats.size;
      if (totalBytes > MAX_SNAPSHOT_BYTES) {
        throw new ProjectChangeHistoryError("Project source is too large for a safe Gotham checkpoint.", "snapshot_too_large");
      }
      entries.push({
        path: relativePath,
        type: "file",
        size: stats.size,
        mode: stats.mode & 0o777,
        hash: await hashFile(absolutePath)
      });
    }
  }

  await visit(workspace);
  return entries;
}

function manifestIdentity(manifest) {
  return JSON.stringify(manifest.map(({ path: filePath, type, target, size, mode, hash }) => ({
    path: filePath,
    type,
    target: target || "",
    size: size || 0,
    mode: mode || 0,
    hash: hash || ""
  })));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

async function createSnapshot(workspaceDir, snapshotDir) {
  const workspace = assertWorkspace(workspaceDir);
  const manifest = await scanWorkspace(workspace);
  const filesDir = path.join(snapshotDir, "files");
  await fs.mkdir(filesDir, { recursive: true, mode: 0o700 });
  for (const entry of manifest) {
    const source = path.join(workspace, ...entry.path.split("/"));
    const destination = path.join(filesDir, ...entry.path.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    if (entry.type === "symlink") await fs.symlink(entry.target, destination);
    else await fs.copyFile(source, destination);
  }
  await writeJson(path.join(snapshotDir, "manifest.json"), manifest);
  return manifest;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readState(projectHistoryDir) {
  const state = await readJson(path.join(projectHistoryDir, "state.json"), null);
  if (!state || state.version !== HISTORY_VERSION || !Array.isArray(state.records)) {
    return { version: HISTORY_VERSION, cursor: 0, records: [] };
  }
  return { ...state, cursor: Math.max(0, Math.min(Number(state.cursor) || 0, state.records.length)) };
}

async function saveState(projectHistoryDir, state) {
  await writeJson(path.join(projectHistoryDir, "state.json"), state);
}

function publicStatus(state) {
  const undo = state.cursor > 0 ? state.records[state.cursor - 1] : null;
  const redo = state.cursor < state.records.length ? state.records[state.cursor] : null;
  const summarize = (record) => record ? {
    id: record.id,
    instruction: record.instruction,
    buildId: record.buildId || "",
    createdAt: record.createdAt,
    status: record.status,
    changedFiles: record.changedFiles || []
  } : null;
  return {
    canUndo: Boolean(undo),
    canRedo: Boolean(redo),
    undo: summarize(undo),
    redo: summarize(redo),
    position: state.cursor,
    total: state.records.length
  };
}

export async function projectChangeHistoryStatus({ root, projectId }) {
  return publicStatus(await readState(historyDirectory(root, projectId)));
}

export async function beginProjectChange({ root, projectId, workspaceDir, instruction = "", workflowId = "" }) {
  const projectHistoryDir = historyDirectory(root, projectId);
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const recordDir = path.join(projectHistoryDir, "records", id);
  const beforeManifest = await createSnapshot(workspaceDir, path.join(recordDir, "before"));
  return {
    id,
    projectId,
    workspaceDir: assertWorkspace(workspaceDir),
    projectHistoryDir,
    root: path.resolve(root || process.cwd()),
    recordDir,
    instruction: String(instruction).trim().slice(0, 300),
    workflowId: String(workflowId || ""),
    beforeManifest
  };
}

export async function commitProjectChange(checkpoint, { buildId = "", status = "completed" } = {}) {
  if (!checkpoint) return null;
  const afterManifest = await createSnapshot(checkpoint.workspaceDir, path.join(checkpoint.recordDir, "after"));
  if (manifestIdentity(checkpoint.beforeManifest) === manifestIdentity(afterManifest)) {
    await fs.rm(checkpoint.recordDir, { recursive: true, force: true });
    return projectChangeHistoryStatus({ root: checkpoint.root, projectId: checkpoint.projectId });
  }
  const beforeByPath = new Map(checkpoint.beforeManifest.map((entry) => [entry.path, manifestIdentity([entry])]));
  const afterByPath = new Map(afterManifest.map((entry) => [entry.path, manifestIdentity([entry])]));
  const changedFiles = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])]
    .filter((filePath) => beforeByPath.get(filePath) !== afterByPath.get(filePath))
    .sort();
  const state = await readState(checkpoint.projectHistoryDir);
  const discarded = state.records.slice(state.cursor);
  for (const record of discarded) {
    await fs.rm(path.join(checkpoint.projectHistoryDir, "records", record.id), { recursive: true, force: true });
  }
  state.records = state.records.slice(0, state.cursor);
  state.records.push({
    id: checkpoint.id,
    instruction: checkpoint.instruction || "Gotham project change",
    workflowId: checkpoint.workflowId,
    buildId: String(buildId || ""),
    status,
    createdAt: new Date().toISOString(),
    changedFiles
  });
  while (state.records.length > MAX_HISTORY_RECORDS) {
    const removed = state.records.shift();
    await fs.rm(path.join(checkpoint.projectHistoryDir, "records", removed.id), { recursive: true, force: true });
  }
  state.cursor = state.records.length;
  await saveState(checkpoint.projectHistoryDir, state);
  return publicStatus(state);
}

async function restoreSnapshot(workspaceDir, snapshotDir) {
  const workspace = assertWorkspace(workspaceDir);
  const expectedManifest = await readJson(path.join(snapshotDir, "manifest.json"), null);
  if (!Array.isArray(expectedManifest)) throw new ProjectChangeHistoryError("The Gotham checkpoint is incomplete.", "checkpoint_missing");
  const currentManifest = await scanWorkspace(workspace);
  const expectedPaths = new Set(expectedManifest.map((entry) => entry.path));
  for (const entry of currentManifest) {
    if (!expectedPaths.has(entry.path)) {
      await fs.rm(path.join(workspace, ...entry.path.split("/")), { force: true });
    }
  }
  for (const entry of expectedManifest) {
    const destination = path.join(workspace, ...entry.path.split("/"));
    const source = path.join(snapshotDir, "files", ...entry.path.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rm(destination, { force: true, recursive: true });
    if (entry.type === "symlink") await fs.symlink(entry.target, destination);
    else {
      await fs.copyFile(source, destination);
      if (entry.mode) await fs.chmod(destination, entry.mode);
    }
  }
}

async function applyHistoryDirection({ root, projectId, workspaceDir, direction }) {
  const projectHistoryDir = historyDirectory(root, projectId);
  const state = await readState(projectHistoryDir);
  const undoing = direction === "undo";
  const recordIndex = undoing ? state.cursor - 1 : state.cursor;
  const record = state.records[recordIndex];
  if (!record) throw new ProjectChangeHistoryError(`There is no Gotham change to ${direction}.`, `nothing_to_${direction}`);
  const expectedSide = undoing ? "after" : "before";
  const targetSide = undoing ? "before" : "after";
  const recordDir = path.join(projectHistoryDir, "records", record.id);
  const expectedManifest = await readJson(path.join(recordDir, expectedSide, "manifest.json"), null);
  const currentManifest = await scanWorkspace(workspaceDir);
  if (!Array.isArray(expectedManifest) || manifestIdentity(currentManifest) !== manifestIdentity(expectedManifest)) {
    throw new ProjectChangeHistoryError(
      `Cannot ${direction}: project files changed after this Gotham checkpoint. Preserve or commit those edits first.`,
      "workspace_changed"
    );
  }
  await restoreSnapshot(workspaceDir, path.join(recordDir, targetSide));
  state.cursor += undoing ? -1 : 1;
  await saveState(projectHistoryDir, state);
  return { record, history: publicStatus(state) };
}

export function undoProjectChange(options) {
  return applyHistoryDirection({ ...options, direction: "undo" });
}

export function redoProjectChange(options) {
  return applyHistoryDirection({ ...options, direction: "redo" });
}
