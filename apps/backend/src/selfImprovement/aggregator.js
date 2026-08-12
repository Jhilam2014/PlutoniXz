import { SELF_IMPROVEMENT_SCHEMA_VERSION, severityRank } from "./constants.js";
import { SignalPatternSchema } from "./contracts.js";
import { createId, nowIso, stableHash } from "./store.js";

function maxSeverity(rows = []) {
  return rows
    .map((row) => row.severity || "info")
    .sort((left, right) => severityRank(right) - severityRank(left))[0] || "info";
}

function confidenceFor(rows = [], { minSignalCount = 3 } = {}) {
  const count = rows.length;
  const severity = maxSeverity(rows);
  const severityBoost = { critical: 0.45, high: 0.28, medium: 0.12, low: 0.04, info: 0 }[severity] || 0;
  const frequencyScore = Math.min(0.6, count / Math.max(minSignalCount, 1) * 0.45);
  const targetSpread = new Set(rows.map((row) => `${row.target?.type || "unknown"}:${row.target?.id || ""}`)).size;
  const spreadScore = Math.min(0.15, Math.max(0, targetSpread - 1) * 0.05);
  return Math.max(0.05, Math.min(0.99, Number((frequencyScore + severityBoost + spreadScore).toFixed(2))));
}

function trendFor(rows = []) {
  if (rows.length < 3) return "new";
  const sorted = [...rows].sort((left, right) => new Date(left.timestamp || 0) - new Date(right.timestamp || 0));
  const midpoint = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, midpoint).length;
  const secondHalf = sorted.slice(midpoint).length;
  if (secondHalf > firstHalf + 1) return "increasing";
  return "stable";
}

export function aggregateSignals(signals = [], {
  correlationId = createId("si_cycle"),
  minSignalCount = 3,
  windowMs = 24 * 60 * 60 * 1000,
  now = Date.now()
} = {}) {
  const recentSignals = signals
    .filter(Boolean)
    .filter((signal) => {
      const timestamp = new Date(signal.timestamp || signal.createdAt || 0).getTime();
      return Number.isFinite(timestamp) && now - timestamp <= windowMs;
    });
  const groups = new Map();
  for (const signal of recentSignals) {
    const key = `${signal.kind}:${signal.component}:${signal.fingerprint}`;
    const rows = groups.get(key) || [];
    rows.push(signal);
    groups.set(key, rows);
  }
  return Array.from(groups.entries()).map(([key, rows]) => {
    const sorted = [...rows].sort((left, right) => new Date(left.timestamp || 0) - new Date(right.timestamp || 0));
    const severity = maxSeverity(rows);
    const confidence = confidenceFor(rows, { minSignalCount });
    const patternKey = stableHash(key).slice(0, 24);
    const components = [...new Set(rows.map((row) => row.component).filter(Boolean))];
    const enoughFrequency = rows.length >= minSignalCount;
    const severeEnough = ["critical", "high"].includes(severity) && rows.length >= Math.min(2, minSignalCount);
    return SignalPatternSchema.parse({
      id: createId("si_pattern"),
      schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
      correlationId,
      source: "self-improvement-signal-aggregator",
      timestamp: nowIso(),
      status: enoughFrequency || severeEnough ? "aggregated" : "skipped",
      evidenceRefs: rows.map((row) => row.id),
      actor: "self-improvement-aggregator",
      modelProfile: "",
      patternKey,
      kind: rows[0]?.kind || "unknown",
      severity,
      components,
      signalIds: rows.map((row) => row.id),
      signalCount: rows.length,
      firstSeenAt: sorted[0]?.timestamp || nowIso(),
      lastSeenAt: sorted.at(-1)?.timestamp || nowIso(),
      confidence,
      duplicateOf: "",
      trend: trendFor(rows),
      summary: `${rows.length} ${rows[0]?.kind || "signals"} signal${rows.length === 1 ? "" : "s"} in ${components.join(", ") || "unknown component"}.`
    });
  });
}

export function suppressDuplicatePatterns(patterns = [], existingTriggers = [], cooldownMs = 60 * 60 * 1000) {
  const recentTriggerByPattern = new Map();
  for (const trigger of existingTriggers || []) {
    if (!trigger.patternKey) continue;
    const timestamp = new Date(trigger.timestamp || 0).getTime();
    if (Date.now() - timestamp <= cooldownMs) recentTriggerByPattern.set(trigger.patternKey, trigger);
  }
  return patterns.map((pattern) => {
    const duplicate = recentTriggerByPattern.get(pattern.patternKey);
    return duplicate
      ? { ...pattern, duplicateOf: duplicate.id, status: "skipped" }
      : pattern;
  });
}
