import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";

function projectRoot() {
  return process.env.PLUTONIX_PROJECT_ROOT || "/workspace/project";
}

function tablePath() {
  return path.join(projectRoot(), "database", "agent-token-usage.table.jsonl");
}

function efficiencyTimelinePath() {
  return path.join(projectRoot(), "observability", "agent-efficiency", "agent-efficiency.timeline.jsonl");
}

function latestEfficiencyPath() {
  return path.join(projectRoot(), "observability", "agent-efficiency", "latest-agent-efficiency.json");
}

const CREDIT_USD_RATE = Number(process.env.CODEX_CREDIT_USD_RATE || 0.04);
const DEFAULT_COST_MODEL = process.env.CODEX_TOKEN_COST_MODEL || "gpt-5.5";
const CODEX_CREDIT_RATES = {
  "gpt-5.5": { inputCreditsPerMillion: 125, outputCreditsPerMillion: 750 },
  "gpt-5.4": { inputCreditsPerMillion: 62.5, outputCreditsPerMillion: 375 },
  "gpt-5.4-mini": { inputCreditsPerMillion: 18.75, outputCreditsPerMillion: 113 },
  "gpt-5.3-codex": { inputCreditsPerMillion: 43.75, outputCreditsPerMillion: 350 },
  "gpt-5.2": { inputCreditsPerMillion: 43.75, outputCreditsPerMillion: 350 }
};

function costModelFor(model) {
  if (CODEX_CREDIT_RATES[model]) return model;
  if (CODEX_CREDIT_RATES[DEFAULT_COST_MODEL]) return DEFAULT_COST_MODEL;
  return "gpt-5.5";
}

export function estimateTokenCost({ inputTokens = 0, outputTokens = 0, model = DEFAULT_COST_MODEL } = {}) {
  const costModel = costModelFor(model);
  const rates = CODEX_CREDIT_RATES[costModel] || CODEX_CREDIT_RATES[DEFAULT_COST_MODEL];
  const inputCredits = (Number(inputTokens || 0) / 1_000_000) * rates.inputCreditsPerMillion;
  const outputCredits = (Number(outputTokens || 0) / 1_000_000) * rates.outputCreditsPerMillion;
  const totalCredits = inputCredits + outputCredits;
  return {
    model: costModel,
    inputCredits: Number(inputCredits.toFixed(6)),
    outputCredits: Number(outputCredits.toFixed(6)),
    totalCredits: Number(totalCredits.toFixed(6)),
    estimatedUsd: Number((totalCredits * CREDIT_USD_RATE).toFixed(6)),
    creditUsdRate: CREDIT_USD_RATE,
    pricingSource: "openai_codex_token_credit_rate_card"
  };
}

export function estimateTokens(text = "") {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function clampScore(value, fallback = 0) {
  const score = Number(value);
  if (!Number.isFinite(score)) return fallback;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function estimateAccuracyValue(record = {}) {
  if (record.accuracyValue !== undefined) return clampScore(record.accuracyValue, 70);
  if (record.accuracy !== undefined) return clampScore(record.accuracy, 70);
  if (record.status === "failed" || record.failed) return 25;
  const changedFiles = Number(record.changedFiles || 0);
  const outputTokens = Number(record.outputTokens || 0);
  const durationMs = Number(record.durationMs || 0);
  let score = 68;
  if (changedFiles > 0) score += 12;
  if (changedFiles >= 3) score += 4;
  if (outputTokens > 0) score += 6;
  if (durationMs > 0 && durationMs < 180_000) score += 4;
  if (durationMs > 600_000) score -= 8;
  if (record.validationStatus === "passed" || record.validationPassed) score += 8;
  if (record.validationStatus === "failed" || record.validationFailed) score -= 20;
  if (record.reworkRequired || record.correctionRequired) score -= 12;
  return clampScore(score, 70);
}

function calculateEfficiencyMetrics({
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = Number(inputTokens || 0) + Number(outputTokens || 0),
  estimatedUsd = 0,
  durationMs = 0,
  changedFiles = 0,
  accuracyValue = 70
} = {}) {
  const tokens = Math.max(0, Number(totalTokens || 0));
  const usd = Math.max(0, Number(estimatedUsd || 0));
  const duration = Math.max(0, Number(durationMs || 0));
  const files = Math.max(0, Number(changedFiles || 0));
  const accuracy = clampScore(accuracyValue, 70);
  const tokenThriftScore = clampScore(100 - Math.log10(Math.max(tokens, 1)) * 14, 40);
  const costThriftScore = clampScore(100 - Math.log10(Math.max(usd, 0.000001) * 1_000_000) * 10, 45);
  const speedScore = duration ? clampScore(100 - Math.log10(Math.max(duration / 1000, 1)) * 18, 55) : 55;
  const outputRatio = Number(inputTokens || 0) ? Number(outputTokens || 0) / Math.max(Number(inputTokens || 0), 1) : 0;
  const outputBalanceScore = clampScore(100 - Math.abs(outputRatio - 8) * 4, 65);
  const yieldScore = files ? clampScore((accuracy / Math.max(tokens / 10_000, 1)) + Math.min(files * 4, 20), 60) : clampScore(accuracy * 0.45, 30);
  const efficiencyScore = clampScore(
    accuracy * 0.42 +
      tokenThriftScore * 0.18 +
      costThriftScore * 0.12 +
      speedScore * 0.12 +
      outputBalanceScore * 0.08 +
      yieldScore * 0.08,
    60
  );
  const abilityScore = clampScore(accuracy * 0.6 + efficiencyScore * 0.25 + yieldScore * 0.15, 65);
  return {
    accuracyValue: accuracy,
    efficiencyScore,
    abilityScore,
    tokenThriftScore,
    costThriftScore,
    speedScore,
    outputBalanceScore,
    yieldScore,
    tokensPerAccuracyPoint: Number((tokens / Math.max(accuracy, 1)).toFixed(2)),
    usdPerAccuracyPoint: Number((usd / Math.max(accuracy, 1)).toFixed(6))
  };
}

export async function recordAgentTokenUsage(record) {
  const inputTokens = Number(record.inputTokens || 0);
  const outputTokens = Number(record.outputTokens || 0);
  const cost = estimateTokenCost({ inputTokens, outputTokens, model: record.model || DEFAULT_COST_MODEL });
  const totalTokens = inputTokens + outputTokens;
  const accuracyValue = estimateAccuracyValue(record);
  const efficiency = calculateEfficiencyMetrics({
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedUsd: cost.estimatedUsd,
    durationMs: record.durationMs,
    changedFiles: record.changedFiles,
    accuracyValue
  });
  const row = {
    id: crypto
      .createHash("sha256")
      .update(`${record.buildId || ""}:${record.agentId || ""}:${Date.now()}:${inputTokens}:${outputTokens}`)
      .digest("hex")
      .slice(0, 24),
    createdAt: new Date().toISOString(),
    agentId: record.agentId || "project-execution-agent",
    agentName: record.agentName || "",
    projectId: record.projectId || "",
    projectName: record.projectName || "",
    workflowId: record.workflowId || record.buildId || "",
    buildId: record.buildId || "",
    instructionHash: record.instructionHash || "",
    instructionSummary: String(record.instructionSummary || "").replace(/\s+/g, " ").trim().slice(0, 240),
    taskType: record.taskType || "",
    // Gotham account usage is owner-scoped. This digest is intentionally
    // opaque and is never a provider credential or account identifier.
    gothamUsageOwnerKey: String(record.gothamUsageOwnerKey || "").slice(0, 80),
    provider: String(record.provider || "").slice(0, 48),
    executionModel: String(record.executionModel || record.model || "").slice(0, 160),
    inputTokens,
    outputTokens,
    totalTokens,
    costModel: cost.model,
    inputCredits: cost.inputCredits,
    outputCredits: cost.outputCredits,
    totalCredits: cost.totalCredits,
    estimatedUsd: cost.estimatedUsd,
    creditUsdRate: cost.creditUsdRate,
    pricingSource: cost.pricingSource,
    durationMs: Number(record.durationMs || 0),
    changedFiles: Number(record.changedFiles || 0),
    accuracyValue: efficiency.accuracyValue,
    efficiencyScore: efficiency.efficiencyScore,
    abilityScore: efficiency.abilityScore,
    tokenThriftScore: efficiency.tokenThriftScore,
    costThriftScore: efficiency.costThriftScore,
    speedScore: efficiency.speedScore,
    outputBalanceScore: efficiency.outputBalanceScore,
    yieldScore: efficiency.yieldScore,
    tokensPerAccuracyPoint: efficiency.tokensPerAccuracyPoint,
    usdPerAccuracyPoint: efficiency.usdPerAccuracyPoint,
    source: record.source || "plutonix-codex-workflow",
    estimationMethod: "chars_div_4_local_estimate"
  };
  await fs.ensureDir(path.dirname(tablePath()));
  await fs.appendFile(tablePath(), `${JSON.stringify(row)}\n`);
  await fs.ensureDir(path.dirname(efficiencyTimelinePath()));
  await fs.appendFile(efficiencyTimelinePath(), `${JSON.stringify(row)}\n`);
  return row;
}

export async function readAgentTokenRows() {
  if (!(await fs.pathExists(tablePath()))) return [];
  const content = await fs.readFile(tablePath(), "utf8");
  return content
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

export async function summarizeAgentTokenEconomy() {
  const rows = await readAgentTokenRows();
  const byAgent = new Map();
  for (const row of rows) {
    const key = row.agentId || "project-execution-agent";
    const rowCost = row.estimatedUsd !== undefined && row.totalCredits !== undefined
      ? {
          model: row.costModel || DEFAULT_COST_MODEL,
          totalCredits: Number(row.totalCredits || 0),
          estimatedUsd: Number(row.estimatedUsd || 0)
        }
      : estimateTokenCost({
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          model: row.costModel || DEFAULT_COST_MODEL
        });
    const current = byAgent.get(key) || {
      totalRuns: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputCredits: 0,
      outputCredits: 0,
      totalCredits: 0,
      estimatedUsd: 0,
      averageTotalTokens: 0,
      averageInputTokens: 0,
      averageOutputTokens: 0,
      averageUsd: 0,
      averageAccuracyValue: 0,
      averageEfficiencyScore: 0,
      averageAbilityScore: 0,
      tokensPerAccuracyPoint: 0,
      usdPerAccuracyPoint: 0,
      lastRunAt: "",
      timeline: []
    };
    const accuracyValue = estimateAccuracyValue(row);
    const efficiency = row.efficiencyScore !== undefined && row.abilityScore !== undefined
      ? {
          accuracyValue,
          efficiencyScore: clampScore(row.efficiencyScore, 60),
          abilityScore: clampScore(row.abilityScore, 65),
          tokenThriftScore: clampScore(row.tokenThriftScore, 40),
          costThriftScore: clampScore(row.costThriftScore, 45),
          speedScore: clampScore(row.speedScore, 55),
          outputBalanceScore: clampScore(row.outputBalanceScore, 65),
          yieldScore: clampScore(row.yieldScore, 60),
          tokensPerAccuracyPoint: Number(row.tokensPerAccuracyPoint || 0),
          usdPerAccuracyPoint: Number(row.usdPerAccuracyPoint || 0)
        }
      : calculateEfficiencyMetrics({ ...row, estimatedUsd: rowCost.estimatedUsd, accuracyValue });
    current.totalRuns += 1;
    current.inputTokens += Number(row.inputTokens || 0);
    current.outputTokens += Number(row.outputTokens || 0);
    current.totalTokens += Number(row.totalTokens || 0);
    current.inputCredits += Number(row.inputCredits || estimateTokenCost({ inputTokens: row.inputTokens, outputTokens: 0, model: row.costModel || DEFAULT_COST_MODEL }).inputCredits || 0);
    current.outputCredits += Number(row.outputCredits || estimateTokenCost({ inputTokens: 0, outputTokens: row.outputTokens, model: row.costModel || DEFAULT_COST_MODEL }).outputCredits || 0);
    current.totalCredits += Number(rowCost.totalCredits || 0);
    current.estimatedUsd += Number(rowCost.estimatedUsd || 0);
    current.averageAccuracyValue += efficiency.accuracyValue;
    current.averageEfficiencyScore += efficiency.efficiencyScore;
    current.averageAbilityScore += efficiency.abilityScore;
    current.lastRunAt = !current.lastRunAt || row.createdAt > current.lastRunAt ? row.createdAt : current.lastRunAt;
    current.timeline.push({
      createdAt: row.createdAt,
      totalTokens: Number(row.totalTokens || 0),
      inputTokens: Number(row.inputTokens || 0),
      outputTokens: Number(row.outputTokens || 0),
      inputCredits: Number(row.inputCredits || estimateTokenCost({ inputTokens: row.inputTokens, outputTokens: 0, model: row.costModel || DEFAULT_COST_MODEL }).inputCredits || 0),
      outputCredits: Number(row.outputCredits || estimateTokenCost({ inputTokens: 0, outputTokens: row.outputTokens, model: row.costModel || DEFAULT_COST_MODEL }).outputCredits || 0),
      totalCredits: Number(rowCost.totalCredits || 0),
      estimatedUsd: Number(rowCost.estimatedUsd || 0),
      costModel: rowCost.model || row.costModel || DEFAULT_COST_MODEL,
      accuracyValue: efficiency.accuracyValue,
      efficiencyScore: efficiency.efficiencyScore,
      abilityScore: efficiency.abilityScore,
      tokenThriftScore: efficiency.tokenThriftScore,
      costThriftScore: efficiency.costThriftScore,
      speedScore: efficiency.speedScore,
      outputBalanceScore: efficiency.outputBalanceScore,
      yieldScore: efficiency.yieldScore,
      tokensPerAccuracyPoint: efficiency.tokensPerAccuracyPoint,
      usdPerAccuracyPoint: efficiency.usdPerAccuracyPoint,
      taskType: row.taskType || "",
      instructionHash: row.instructionHash || "",
      instructionSummary: row.instructionSummary || "",
      buildId: row.buildId || "",
      projectName: row.projectName || ""
    });
    byAgent.set(key, current);
  }
  for (const summary of byAgent.values()) {
    summary.averageTotalTokens = summary.totalRuns ? Math.round(summary.totalTokens / summary.totalRuns) : 0;
    summary.averageInputTokens = summary.totalRuns ? Math.round(summary.inputTokens / summary.totalRuns) : 0;
    summary.averageOutputTokens = summary.totalRuns ? Math.round(summary.outputTokens / summary.totalRuns) : 0;
    summary.averageAccuracyValue = summary.totalRuns ? Math.round(summary.averageAccuracyValue / summary.totalRuns) : 0;
    summary.averageEfficiencyScore = summary.totalRuns ? Math.round(summary.averageEfficiencyScore / summary.totalRuns) : 0;
    summary.averageAbilityScore = summary.totalRuns ? Math.round(summary.averageAbilityScore / summary.totalRuns) : 0;
    summary.estimatedUsd = Number(summary.estimatedUsd.toFixed(6));
    summary.inputCredits = Number(summary.inputCredits.toFixed(6));
    summary.outputCredits = Number(summary.outputCredits.toFixed(6));
    summary.inputEstimatedUsd = Number((summary.inputCredits * CREDIT_USD_RATE).toFixed(6));
    summary.outputEstimatedUsd = Number((summary.outputCredits * CREDIT_USD_RATE).toFixed(6));
    summary.totalCredits = Number(summary.totalCredits.toFixed(6));
    summary.averageUsd = summary.totalRuns ? Number((summary.estimatedUsd / summary.totalRuns).toFixed(6)) : 0;
    summary.tokensPerAccuracyPoint = summary.averageAccuracyValue ? Number((summary.totalTokens / summary.averageAccuracyValue).toFixed(2)) : 0;
    summary.usdPerAccuracyPoint = summary.averageAccuracyValue ? Number((summary.estimatedUsd / summary.averageAccuracyValue).toFixed(6)) : 0;
    summary.timeline = summary.timeline.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-12);
  }
  const summary = Object.fromEntries(byAgent.entries());
  await fs.ensureDir(path.dirname(latestEfficiencyPath()));
  await fs.writeJson(latestEfficiencyPath(), { generatedAt: new Date().toISOString(), agents: summary }, { spaces: 2 });
  return summary;
}

export async function readAgentEfficiencySummary() {
  const agents = await summarizeAgentTokenEconomy();
  return {
    status: "ok",
    generatedAt: new Date().toISOString(),
    source: {
      tokenUsageTable: tablePath(),
      efficiencyTimeline: efficiencyTimelinePath(),
      latestEfficiency: latestEfficiencyPath()
    },
    agents
  };
}
