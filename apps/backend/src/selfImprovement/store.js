import crypto from "node:crypto";
import fs from "fs-extra";
import fsp from "node:fs/promises";
import path from "node:path";
import { observabilityRoot, projectRoot, selfImprovementRoot } from "./constants.js";

export function createId(prefix = "si") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function stableHash(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export function nowIso() {
  return new Date().toISOString();
}

function statePaths(root = projectRoot()) {
  const runtimeRoot = selfImprovementRoot(root);
  const obsRoot = observabilityRoot(root);
  return {
    runtimeRoot,
    obsRoot,
    config: path.join(runtimeRoot, "state", "control-state.json"),
    signals: path.join(runtimeRoot, "signals", "signals.jsonl"),
    patterns: path.join(runtimeRoot, "patterns", "patterns.jsonl"),
    triggers: path.join(runtimeRoot, "triggers", "triggers.jsonl"),
    evidence: path.join(runtimeRoot, "evidence", "evidence-packages.jsonl"),
    analyses: path.join(runtimeRoot, "analyses", "analyses.jsonl"),
    proposals: path.join(runtimeRoot, "proposals", "proposals.jsonl"),
    candidates: path.join(runtimeRoot, "candidates", "candidate-changesets.jsonl"),
    validations: path.join(runtimeRoot, "validations", "validation-runs.jsonl"),
    reviews: path.join(runtimeRoot, "reviews", "review-decisions.jsonl"),
    promotions: path.join(runtimeRoot, "promotions", "promotion-decisions.jsonl"),
    rollbacks: path.join(runtimeRoot, "rollbacks", "rollback-events.jsonl"),
    lessons: path.join(runtimeRoot, "lessons", "lessons.jsonl"),
    investigations: path.join(runtimeRoot, "investigations", "investigator-decisions.jsonl"),
    researchLogs: path.join(runtimeRoot, "research", "research-agent-usage.jsonl"),
    toolPlans: path.join(runtimeRoot, "tools", "tool-incorporation-plans.jsonl"),
    generatedTools: path.join(runtimeRoot, "tools", "generated-tools.jsonl"),
    toolRuns: path.join(runtimeRoot, "tools", "tool-runs.jsonl"),
    monetaryApprovals: path.join(runtimeRoot, "approvals", "monetary-approvals.jsonl"),
    runLogs: path.join(runtimeRoot, "run-logs", "run-logs.jsonl"),
    deadLetters: path.join(runtimeRoot, "dead-letter", "events.jsonl"),
    latestCycle: path.join(obsRoot, "latest-cycle.json"),
    latestInvestigation: path.join(obsRoot, "latest-investigation.json"),
    latestResearchLog: path.join(obsRoot, "latest-research-log.json"),
    latestToolPlan: path.join(obsRoot, "latest-tool-plan.json"),
    latestMonetaryApproval: path.join(obsRoot, "latest-monetary-approval.json"),
    latestRunLog: path.join(obsRoot, "latest-run-log.json"),
    latestStatus: path.join(obsRoot, "latest-status.json"),
    lock: path.join(runtimeRoot, "locks", "cycle.lock")
  };
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

async function appendJsonLines(filePath, rows = []) {
  const cleanRows = rows.filter(Boolean);
  if (!cleanRows.length) return;
  await fs.ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${cleanRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function writeJson(filePath, value) {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, value, { spaces: 2 });
}

async function readJson(filePath, fallback = null) {
  if (!(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

export class SelfImprovementStore {
  constructor({ root = projectRoot() } = {}) {
    this.root = root;
    this.paths = statePaths(root);
  }

  async ensure() {
    await Promise.all([
      fs.ensureDir(this.paths.runtimeRoot),
      fs.ensureDir(this.paths.obsRoot)
    ]);
  }

  async readState(defaultState = {}) {
    return readJson(this.paths.config, defaultState);
  }

  async writeState(state) {
    await writeJson(this.paths.config, state);
  }

  async append(collection, rows) {
    await appendJsonLines(this.paths[collection], Array.isArray(rows) ? rows : [rows]);
  }

  async read(collection) {
    return readJsonLines(this.paths[collection]);
  }

  async writeLatestCycle(cycle) {
    await writeJson(this.paths.latestCycle, cycle);
  }

  async writeLatestStatus(status) {
    await writeJson(this.paths.latestStatus, status);
  }

  async writeLatestRunLog(runLog) {
    await writeJson(this.paths.latestRunLog, runLog);
  }

  async writeLatestInvestigation(investigation) {
    await writeJson(this.paths.latestInvestigation, investigation);
  }

  async writeLatestResearchLog(researchLog) {
    await writeJson(this.paths.latestResearchLog, researchLog);
  }

  async writeLatestToolPlan(toolPlan) {
    await writeJson(this.paths.latestToolPlan, toolPlan);
  }

  async writeLatestMonetaryApproval(approval) {
    await writeJson(this.paths.latestMonetaryApproval, approval);
  }

  async readLatestStatus() {
    return readJson(this.paths.latestStatus, null);
  }

  async readLatestRunLog() {
    return readJson(this.paths.latestRunLog, null);
  }

  async readLatestInvestigation() {
    return readJson(this.paths.latestInvestigation, null);
  }

  async readLatestResearchLog() {
    return readJson(this.paths.latestResearchLog, null);
  }

  async readLatestToolPlan() {
    return readJson(this.paths.latestToolPlan, null);
  }

  async readLatestMonetaryApproval() {
    return readJson(this.paths.latestMonetaryApproval, null);
  }

  async writeDeadLetter(event, error) {
    await this.append("deadLetters", {
      id: createId("si_dead"),
      recordedAt: nowIso(),
      event,
      error: error?.message || String(error || "unknown")
    });
  }

  async acquireCycleLock({ staleAfterMs = 20 * 60 * 1000, owner = process.pid } = {}) {
    await fs.ensureDir(path.dirname(this.paths.lock));
    const payload = {
      owner,
      acquiredAt: nowIso(),
      staleAfterMs
    };
    try {
      const handle = await fsp.open(this.paths.lock, "wx");
      await handle.writeFile(JSON.stringify(payload, null, 2));
      await handle.close();
      return async () => fs.remove(this.paths.lock).catch(() => {});
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readJson(this.paths.lock, null);
      const acquiredAt = new Date(existing?.acquiredAt || 0).getTime();
      if (Date.now() - acquiredAt > Number(existing?.staleAfterMs || staleAfterMs)) {
        await fs.remove(this.paths.lock).catch(() => {});
        return this.acquireCycleLock({ staleAfterMs, owner });
      }
      return null;
    }
  }

  async writeCandidateArtifact(proposalId, fileName, content) {
    const dir = path.join(this.paths.runtimeRoot, "candidates", proposalId);
    await fs.ensureDir(dir);
    const filePath = path.join(dir, fileName);
    if (typeof content === "string") {
      await fs.writeFile(filePath, content);
    } else {
      await fs.writeJson(filePath, content, { spaces: 2 });
    }
    return filePath;
  }
}
