import fs from "fs-extra";
import path from "node:path";
import { summarizeAgentTokenEconomy } from "./tokenEconomy.js";

const MAX_LOG_ROWS = 220;
const MAX_INSTRUCTION_ROWS = 120;
const DEFAULT_MAX_DAILY_AUDITS = 3;
const DEFAULT_AUDIT_TIME_ZONE = "Asia/Kolkata";

function plutonixRoot() {
  if (process.env.PLUTONIX_PROJECT_ROOT) return process.env.PLUTONIX_PROJECT_ROOT;
  if (fs.existsSync(path.join(process.cwd(), "apps", "backend"))) return process.cwd();
  return path.resolve(process.cwd(), "../..");
}

function clamp(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function recentRows(rows = [], limit = 50) {
  return [...rows]
    .filter(Boolean)
    .sort((left, right) => new Date(right.createdAt || right.recordedAt || 0) - new Date(left.createdAt || left.recordedAt || 0))
    .slice(0, limit);
}

function safeInstruction(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_KEY]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .trim()
    .slice(0, 420);
}

function includeInstructionSamples() {
  return String(process.env.PLUTONIX_ORCHESTRATOR_STORE_INSTRUCTION_SAMPLES || "0") === "1";
}

function issue(severity, category, title, detail, evidence = {}) {
  return { severity, category, title, detail, evidence };
}

function loadRuntimeAgents(root) {
  const agents = [];
  const runtimeAgentsRoot = path.join(root, "runtime", "agents");
  if (!fs.existsSync(runtimeAgentsRoot)) return agents;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const parsed = fs.readJsonSync(fullPath);
        const rows = Array.isArray(parsed?.agents) ? parsed.agents : [parsed];
        for (const row of rows) {
          const id = row.agent_id || row.agentId || row.id;
          if (!id) continue;
          agents.push({
            id,
            name: row.name || row.agentName || id,
            role: row.role || row.runtime || "",
            status: row.status || "unknown",
            sourcePath: path.relative(root, fullPath).split(path.sep).join("/")
          });
        }
      } catch {
        // Ignore malformed runtime cache files; the audit will flag missing health via events.
      }
    }
  };
  walk(runtimeAgentsRoot);
  return agents;
}

function analyzeRuntimeEvents(events = []) {
  const recent = recentRows(events, MAX_LOG_ROWS);
  const errors = recent.filter((row) => /failed|error|rejected/i.test(`${row.type || ""} ${row.status || ""} ${row.message || ""}`));
  const previewFailures = errors.filter((row) => /preview did not become ready|runtime.*exited|nanoid|notarget|vite|npm/i.test(row.message || ""));
  const repairFailures = errors.filter((row) => /repair/i.test(`${row.type || ""} ${row.message || ""}`));
  const stopRequests = recent.filter((row) => /stop requested|stopped by the user/i.test(`${row.type || ""} ${row.message || ""}`));
  const issues = [];
  if (previewFailures.length) {
    issues.push(issue(
      previewFailures.length >= 3 ? "critical" : "high",
      "functionality",
      "Preview/runtime failures are recurring",
      "Generated apps are failing at install/start/preview time. PlutoniX should prefer pinned runtime dependencies and send runtime errors to repair before failing the workflow.",
      { count: previewFailures.length, lastMessage: previewFailures[0]?.message || "" }
    ));
  }
  if (repairFailures.length) {
    issues.push(issue(
      "high",
      "self-repair",
      "Automatic repair failed or was rejected",
      "The repair loop needs better error context or narrower repair prompts for this class of failure.",
      { count: repairFailures.length, lastMessage: repairFailures[0]?.message || "" }
    ));
  }
  if (errors.length >= 5) {
    issues.push(issue(
      "high",
      "quality",
      "High error density in recent activity",
      "Recent PlutoniX activity has too many failed or rejected events compared with successful completion signals.",
      { recentEvents: recent.length, errors: errors.length }
    ));
  }
  if (stopRequests.length >= 2) {
    issues.push(issue(
      "medium",
      "user-intent",
      "User repeatedly stopped active work",
      "The orchestrator may be over-running user intent or taking too long before producing usable feedback.",
      { count: stopRequests.length }
    ));
  }
  return { recent, errors, previewFailures, issues };
}

function analyzeInstructions(instructions = []) {
  const recent = recentRows(instructions, MAX_INSTRUCTION_ROWS);
  const failed = recent.filter((row) => row.status === "failed" || row.error);
  const repaired = recent.filter((row) => row.repair || row.status === "repaired");
  const noOutput = recent.filter((row) => !row.error && row.status === "succeeded" && (!row.changedFiles || row.changedFiles.length === 0));
  const issues = [];
  if (failed.length) {
    issues.push(issue(
      failed.length >= 3 ? "critical" : "high",
      "user-outcome",
      "User instructions are not reliably reaching successful outcomes",
      "The user asked for working functionality, but recent instruction records include failures.",
      {
        count: failed.length,
        examples: includeInstructionSamples()
          ? failed.slice(0, 3).map((row) => safeInstruction(row.instruction || row.error))
          : failed.slice(0, 3).map((row) => ({
              projectName: row.projectName || "",
              taskType: row.taskType || "",
              status: row.status || "failed",
              hasInstruction: Boolean(row.instruction),
              hasError: Boolean(row.error)
            }))
      }
    ));
  }
  if (noOutput.length) {
    issues.push(issue(
      "medium",
      "functionality",
      "Successful records with no changed files",
      "A workflow reported success without useful implementation evidence.",
      { count: noOutput.length }
    ));
  }
  if (repaired.length >= 2) {
    issues.push(issue(
      "medium",
      "quality",
      "Repair loop is compensating for initial execution quality",
      "Automatic repair succeeded, but repeated repair dependence means the first-pass execution prompt or agent policy should be tightened.",
      { count: repaired.length }
    ));
  }
  return { recent, failed, repaired, noOutput, issues };
}

function analyzeTokenWaste(tokenEconomy = {}) {
  const issues = [];
  const agents = Object.entries(tokenEconomy || {}).map(([agentId, summary]) => ({ agentId, ...summary }));
  const wasteRows = agents.filter((agent) =>
    Number(agent.totalRuns || 0) > 0 &&
    (Number(agent.averageEfficiencyScore || 0) < 55 || Number(agent.tokensPerAccuracyPoint || 0) > 1800)
  );
  for (const agent of wasteRows.slice(0, 6)) {
    issues.push(issue(
      Number(agent.averageEfficiencyScore || 0) < 45 ? "high" : "medium",
      "token-waste",
      `${agent.agentId} has poor token/resource efficiency`,
      "The agent is spending too many tokens or too much time relative to useful changed-file and accuracy signals.",
      {
        agentId: agent.agentId,
        totalRuns: agent.totalRuns,
        averageEfficiencyScore: agent.averageEfficiencyScore,
        averageAbilityScore: agent.averageAbilityScore,
        tokensPerAccuracyPoint: agent.tokensPerAccuracyPoint,
        estimatedUsd: agent.estimatedUsd
      }
    ));
  }
  return { agents, issues };
}

function buildAgentHealth(runtimeAgents = [], tokenEconomy = {}, issues = []) {
  const byAgent = new Map();
  for (const agent of runtimeAgents) {
    byAgent.set(agent.id, {
      agentId: agent.id,
      name: agent.name,
      status: agent.status,
      sourcePath: agent.sourcePath,
      healthScore: agent.status === "active" ? 82 : 64,
      qualityScore: 70,
      efficiencyScore: 70,
      concerns: [],
      directives: []
    });
  }
  for (const [agentId, economy] of Object.entries(tokenEconomy || {})) {
    const row = byAgent.get(agentId) || {
      agentId,
      name: agentId,
      status: "observed",
      sourcePath: "",
      healthScore: 72,
      qualityScore: 70,
      efficiencyScore: 70,
      concerns: [],
      directives: []
    };
    row.qualityScore = clamp(economy.averageAbilityScore || economy.averageAccuracyValue || row.qualityScore, row.qualityScore);
    row.efficiencyScore = clamp(economy.averageEfficiencyScore || row.efficiencyScore, row.efficiencyScore);
    row.healthScore = clamp(row.qualityScore * 0.5 + row.efficiencyScore * 0.35 + (row.status === "active" ? 15 : 5), row.healthScore);
    row.tokenEconomy = {
      totalRuns: economy.totalRuns || 0,
      averageTotalTokens: economy.averageTotalTokens || 0,
      tokensPerAccuracyPoint: economy.tokensPerAccuracyPoint || 0,
      estimatedUsd: economy.estimatedUsd || 0
    };
    byAgent.set(agentId, row);
  }
  for (const item of issues) {
    const targetAgent = /repair/i.test(item.category) ? "plutonix-auto-repair-agent" : /token/.test(item.category) ? item.evidence?.agentId : "";
    if (!targetAgent || !byAgent.has(targetAgent)) continue;
    byAgent.get(targetAgent).concerns.push(item.title);
  }
  for (const row of byAgent.values()) {
    if (row.efficiencyScore < 60) row.directives.push("Use smaller context windows, cite exact files, and avoid broad rewrites unless required.");
    if (row.qualityScore < 65) row.directives.push("Before completion, verify requested behavior against the latest user instruction and runtime evidence.");
    if (row.healthScore < 60) row.directives.push("Route through independent review or auto-repair before PlutoniX approval.");
  }
  return [...byAgent.values()].sort((left, right) => left.healthScore - right.healthScore);
}

function recommendationsFor(issues = []) {
  const recs = [];
  if (issues.some((row) => row.category === "functionality")) {
    recs.push("Keep generated app runtime dependencies pinned and route preview/start failures to automatic repair before failing the user request.");
  }
  if (issues.some((row) => row.category === "token-waste")) {
    recs.push("Reduce prompt fan-out for low-yield agents and prefer targeted file reads plus explicit changed-file validation.");
  }
  if (issues.some((row) => row.category === "user-outcome")) {
    recs.push("Compare each user instruction with the final changed files and preview state before marking PlutoniX complete.");
  }
  if (issues.some((row) => row.category === "quality")) {
    recs.push("Tighten first-pass agent handoff prompts and require runtime/package checks for project creation tasks.");
  }
  return recs.length ? recs : ["No immediate self-change is required. Continue monitoring agent quality, user outcomes, and token/resource cost."];
}

function severityRank(value = "") {
  return { critical: 4, high: 3, medium: 2, low: 1 }[value] || 0;
}

function dailyKey(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function healthAuditError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export function createOrchestratorHealthMonitor({
  emit = () => {},
  getRuntimeEvents = () => [],
  getInstructionTimeline = () => [],
  getTokenEconomy = summarizeAgentTokenEconomy,
  onSelfHeal = null,
  root: configuredRoot = plutonixRoot(),
  now = () => new Date(),
  maxDailyAudits = Number(process.env.PLUTONIX_ORCHESTRATOR_HEALTH_MAX_DAILY_AUDITS || DEFAULT_MAX_DAILY_AUDITS),
  timeZone = process.env.PLUTONIX_ORCHESTRATOR_HEALTH_TIME_ZONE || DEFAULT_AUDIT_TIME_ZONE
} = {}) {
  const root = configuredRoot;
  const auditRoot = path.join(root, "observability", "orchestrator-health");
  const latestReportPath = path.join(auditRoot, "latest-health-report.json");
  const dailyBudgetPath = path.join(auditRoot, "daily-audit-budget.json");
  const overlayPath = path.join(root, "runtime", "agents", "health", "agent-health-overrides.json");
  let running = false;
  let lastSelfHealSignature = "";
  const dailyLimit = Math.max(1, Math.min(3, Number.isFinite(maxDailyAudits) ? Math.floor(maxDailyAudits) : DEFAULT_MAX_DAILY_AUDITS));

  const readDailyBudget = async () => {
    const day = dailyKey(now(), timeZone);
    const stored = await fs.readJson(dailyBudgetPath).catch(() => null);
    if (stored?.day === day && Array.isArray(stored.attempts)) {
      return { ...stored, maxDailyAudits: dailyLimit, timeZone };
    }
    return {
      schemaVersion: "plutonix-orchestrator-health-budget/v1",
      day,
      timeZone,
      maxDailyAudits: dailyLimit,
      attempts: []
    };
  };

  const writeDailyBudget = async (budget) => {
    await fs.ensureDir(auditRoot);
    await fs.writeJson(dailyBudgetPath, budget, { spaces: 2 });
  };

  const quota = async () => {
    const budget = await readDailyBudget();
    const used = budget.attempts.length;
    return {
      day: budget.day,
      timeZone,
      maxDailyAudits: dailyLimit,
      used,
      remaining: Math.max(0, dailyLimit - used)
    };
  };

  const status = async () => ({
    mode: "manual",
    scheduled: false,
    running,
    quota: await quota(),
    latestReport: await fs.readJson(latestReportPath).catch(() => null)
  });

  const audit = async ({ reason = "control-panel-user-request", requestedBy = "control-panel-user" } = {}) => {
    if (running) {
      throw healthAuditError("An orchestrator health audit is already running.", "orchestrator_health_audit_in_progress", 409);
    }
    running = true;
    let budget = null;
    let attempt = null;
    try {
      budget = await readDailyBudget();
      if (budget.attempts.length >= dailyLimit) {
        throw healthAuditError(
          `The daily orchestrator health-audit limit of ${dailyLimit} has been reached for ${budget.day} (${timeZone}).`,
          "orchestrator_health_daily_limit_reached",
          429
        );
      }
      const requestedAt = now().toISOString();
      attempt = {
        id: `health-audit-${budget.day}-${budget.attempts.length + 1}`,
        requestedAt,
        requestedBy: String(requestedBy || "control-panel-user").slice(0, 120),
        reason: String(reason || "control-panel-user-request").slice(0, 120),
        status: "running"
      };
      budget.attempts.push(attempt);
      await writeDailyBudget(budget);
      const runtimeAnalysis = analyzeRuntimeEvents(getRuntimeEvents());
      const instructionAnalysis = analyzeInstructions(getInstructionTimeline());
      const tokenEconomy = await getTokenEconomy();
      const tokenAnalysis = analyzeTokenWaste(tokenEconomy);
      const issues = [...runtimeAnalysis.issues, ...instructionAnalysis.issues, ...tokenAnalysis.issues]
        .sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
      const runtimeAgents = loadRuntimeAgents(root);
      const agents = buildAgentHealth(runtimeAgents, tokenEconomy, issues);
      const report = {
        status: issues.some((row) => row.severity === "critical") ? "critical" : issues.some((row) => row.severity === "high") ? "degraded" : "healthy",
        generatedAt: now().toISOString(),
        reason,
        scope: "plutonix-orchestrator-health",
        userActivitySummary: {
          recentEvents: runtimeAnalysis.recent.length,
          errors: runtimeAnalysis.errors.length,
          recentInstructions: instructionAnalysis.recent.length,
          failedInstructions: instructionAnalysis.failed.length,
          repairedInstructions: instructionAnalysis.repaired.length,
          sampleIntentSignals: instructionAnalysis.recent.slice(0, 5).map((row) => ({
            projectName: row.projectName || "",
            taskType: row.taskType || "",
            status: row.status || "",
            instruction: includeInstructionSamples() ? safeInstruction(row.instruction || row.error || "") : "",
            instructionStored: includeInstructionSamples()
          }))
        },
        tokenWasteSummary: {
          observedAgents: tokenAnalysis.agents.length,
          wasteIssues: tokenAnalysis.issues.length,
          worstAgents: tokenAnalysis.agents
            .sort((left, right) => Number(right.tokensPerAccuracyPoint || 0) - Number(left.tokensPerAccuracyPoint || 0))
            .slice(0, 5)
            .map((agent) => ({
              agentId: agent.agentId,
              totalRuns: agent.totalRuns || 0,
              averageEfficiencyScore: agent.averageEfficiencyScore || 0,
              tokensPerAccuracyPoint: agent.tokensPerAccuracyPoint || 0
            }))
        },
        issues,
        agents,
        recommendations: recommendationsFor(issues)
      };
      await fs.ensureDir(auditRoot);
      await fs.writeJson(latestReportPath, report, { spaces: 2 });
      await fs.appendFile(path.join(auditRoot, "health-report.timeline.jsonl"), `${JSON.stringify(report)}\n`);
      await fs.ensureDir(path.dirname(overlayPath));
      await fs.writeJson(overlayPath, {
        generatedAt: report.generatedAt,
        status: report.status,
        agents: Object.fromEntries(agents.map((agent) => [agent.agentId, {
          healthScore: agent.healthScore,
          qualityScore: agent.qualityScore,
          efficiencyScore: agent.efficiencyScore,
          directives: agent.directives,
          concerns: agent.concerns
        }])),
        recommendations: report.recommendations
      }, { spaces: 2 });

      emit("orchestrator-health-audit", `Orchestrator health audit ${report.status}: ${issues.length} issue${issues.length === 1 ? "" : "s"} found`, {
        source: "plutonix-orchestrator-health",
        status: report.status,
        issueCount: issues.length,
        criticalCount: issues.filter((row) => row.severity === "critical").length,
        highCount: issues.filter((row) => row.severity === "high").length
      });

      const selfHealEnabled = String(process.env.PLUTONIX_ORCHESTRATOR_SELF_HEAL || "1") === "1";
      const needsSelfHeal = selfHealEnabled && issues.some((row) => ["critical", "high"].includes(row.severity));
      const signature = issues.slice(0, 3).map((row) => `${row.severity}:${row.category}:${row.title}`).join("|");
      if (needsSelfHeal && signature && signature !== lastSelfHealSignature && typeof onSelfHeal === "function") {
        lastSelfHealSignature = signature;
        await onSelfHeal(report).catch((error) => {
          emit("orchestrator-health-self-heal-failed", error.message, {
            source: "plutonix-orchestrator-health",
            status: "failed"
          });
        });
      }
      attempt.status = "completed";
      attempt.completedAt = now().toISOString();
      attempt.reportStatus = report.status;
      attempt.issueCount = issues.length;
      await writeDailyBudget(budget);
      return report;
    } catch (error) {
      if (attempt && budget) {
        attempt.status = "failed";
        attempt.completedAt = now().toISOString();
        attempt.errorCode = String(error.code || "orchestrator_health_audit_failed").slice(0, 120);
        await writeDailyBudget(budget).catch(() => {});
      }
      throw error;
    } finally {
      running = false;
    }
  };

  return {
    start() {
      return { mode: "manual", scheduled: false, maxDailyAudits: dailyLimit };
    },
    stop() {},
    audit,
    status
  };
}
