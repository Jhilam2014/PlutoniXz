import { SELF_IMPROVEMENT_SCHEMA_VERSION } from "./constants.js";
import { ImprovementSignalSchema } from "./contracts.js";
import { fingerprintText, hasPromptInjection, neutralizeLogInstruction } from "./redaction.js";
import { createId, nowIso, stableHash } from "./store.js";

function severityFromText(value = "", fallback = "medium") {
  const text = String(value || "").toLowerCase();
  if (/auth|credential|secret|permission|security|delete|rollback|critical/.test(text)) return "critical";
  if (/failed|error|crash|timeout|not become ready|rejected|repair failed/.test(text)) return "high";
  if (/warning|retry|slow|stopped|empty changed files|no changed files/.test(text)) return "medium";
  return fallback;
}

function componentFromEvent(row = {}) {
  const text = `${row.type || ""} ${row.message || ""}`.toLowerCase();
  if (/hosting|deploy|rollback|credential/.test(text)) return "hosting";
  if (/ui|ux|design|layout|panel|chat|scroll|button|control|modal|dropdown|navigation|responsive|aesthetic|frontend|gotham chat/.test(text)) return "plutomix-ui-ux";
  if (/project-instance|project-runtime|preview|vite|docker|port/.test(text)) return "managed-project-runtime";
  if (/repair/.test(text)) return "automatic-repair";
  if (/vector|memory|agent-memory/.test(text)) return "agent-memory";
  if (/gotham|generate|codex|claude|model/.test(text)) return "gotham-generation";
  if (/auth|google|profile/.test(text)) return "authentication";
  return "plutomix-runtime";
}

const instructionStopWords = new Set([
  "a",
  "an",
  "and",
  "app",
  "build",
  "change",
  "create",
  "do",
  "for",
  "get",
  "i",
  "in",
  "is",
  "it",
  "make",
  "of",
  "on",
  "project",
  "should",
  "that",
  "the",
  "this",
  "to",
  "with"
]);

function instructionTerms(value = "") {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !instructionStopWords.has(word))
  );
}

function instructionSimilarity(left = "", right = "") {
  const leftTerms = instructionTerms(left);
  const rightTerms = instructionTerms(right);
  if (!leftTerms.size || !rightTerms.size) return 0;
  let shared = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) shared += 1;
  }
  return shared / Math.max(leftTerms.size, rightTerms.size);
}

function instructionLooksLikeStruggle(row = {}) {
  const text = `${row.instruction || ""} ${row.error || ""}`.toLowerCase();
  return Boolean(
    row.status === "failed" ||
    row.error ||
    (row.status === "succeeded" && (!row.changedFiles || row.changedFiles.length === 0)) ||
    /\b(still|again|same|not working|doesn't work|does not work|failed|error|bug|fix|broken|missing|nothing|no changes?)\b/.test(text)
  );
}

function rootCauseHypothesisForCluster(cluster = []) {
  if (cluster.some((row) => row.error || row.status === "failed")) {
    return "Repeated similar instructions are failing or returning errors before the requested job is complete.";
  }
  if (cluster.some((row) => row.status === "succeeded" && (!row.changedFiles || row.changedFiles.length === 0))) {
    return "Gotham reported success without changed-file evidence, so the user likely had to repeat the same job.";
  }
  if (cluster.some((row) => /\b(still|again|same|not working|doesn't work|does not work|missing|nothing)\b/i.test(row.instruction || ""))) {
    return "User language indicates the previous implementation did not satisfy the intended functionality.";
  }
  return "The same project job is being requested repeatedly and should be investigated for incomplete requirement understanding.";
}

function repeatedInstructionStruggleSignals(instructions = [], { correlationId = "", storeInstructionSamples = false } = {}) {
  const recentRows = instructions
    .filter((row) => row?.instruction)
    .slice(0, 120);
  const used = new Set();
  const signals = [];

  for (let index = 0; index < recentRows.length; index += 1) {
    if (used.has(index)) continue;
    const seed = recentRows[index];
    const cluster = [seed];
    for (let scan = index + 1; scan < recentRows.length; scan += 1) {
      if (used.has(scan)) continue;
      const candidate = recentRows[scan];
      const sameProject = (candidate.projectId || candidate.projectName) === (seed.projectId || seed.projectName);
      if (!sameProject) continue;
      if (instructionSimilarity(seed.instruction, candidate.instruction) >= 0.3) {
        cluster.push(candidate);
      }
    }
    if (cluster.length < 3 || !cluster.some(instructionLooksLikeStruggle)) continue;
    cluster.forEach((row) => used.add(recentRows.indexOf(row)));
    const rootCauseHypothesis = rootCauseHypothesisForCluster(cluster);
    signals.push(createSignal({
      correlationId,
      kind: "repeated_user_struggle",
      severity: cluster.some((row) => row.status === "failed" || row.error) ? "high" : "medium",
      component: "instruction-outcome",
      message: `User repeatedly requested a similar project job ${cluster.length} times. ${rootCauseHypothesis}`,
      metadata: {
        projectId: seed.projectId || "",
        projectName: seed.projectName || "",
        repeatedInstructionCount: cluster.length,
        rootCauseHypothesis,
        statuses: [...new Set(cluster.map((row) => row.status || "received"))],
        changedFileCounts: cluster.map((row) => (row.changedFiles || []).length),
        firstRecordedAt: cluster.at(-1)?.recordedAt || "",
        latestRecordedAt: cluster[0]?.recordedAt || "",
        instructionStored: storeInstructionSamples,
        instructionSamples: storeInstructionSamples
          ? cluster.slice(0, 3).map((row) => neutralizeLogInstruction(row.instruction || "", { maxLength: 220 }))
          : []
      }
    }));
  }
  return signals.slice(0, 20);
}

function signalBase({ correlationId = "", source = "self-improvement-observer", actor = "self-improvement-observer" } = {}) {
  return {
    id: createId("si_sig"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    correlationId: correlationId || createId("si_cycle"),
    source,
    timestamp: nowIso(),
    status: "observed",
    evidenceRefs: [],
    actor,
    modelProfile: ""
  };
}

function createSignal({ kind, severity, component, target = { type: "system", id: "plutomix" }, message = "", metadata = {}, correlationId = "", source = "self-improvement-observer" }) {
  const safeMessage = neutralizeLogInstruction(message, { maxLength: 700 });
  const fingerprint = stableHash(`${kind}:${component}:${fingerprintText(safeMessage || JSON.stringify(metadata || {}))}`).slice(0, 24);
  return ImprovementSignalSchema.parse({
    ...signalBase({ correlationId, source }),
    kind,
    severity,
    component,
    target,
    message: safeMessage,
    fingerprint,
    metadata: {
      ...metadata,
      promptInjectionDetected: hasPromptInjection(message)
    }
  });
}

export function observeRuntimeEvents(events = [], { correlationId = "" } = {}) {
  return events
    .filter(Boolean)
    .filter((row) => /failed|error|rejected|timeout|crash|repair|not become ready|stopped/i.test(`${row.type || ""} ${row.status || ""} ${row.message || ""}`))
    .slice(0, 200)
    .map((row) => createSignal({
      correlationId,
      kind: /repair/i.test(`${row.type || ""} ${row.message || ""}`) ? "repair_quality_issue" : "runtime_failure",
      severity: severityFromText(`${row.type || ""} ${row.status || ""} ${row.message || ""}`),
      component: componentFromEvent(row),
      message: row.message || row.type || "Runtime event indicated a possible issue.",
      metadata: {
        runtimeEventId: row.id || "",
        runtimeEventType: row.type || "",
        status: row.status || "",
        createdAt: row.createdAt || ""
      }
    }));
}

export function observeInstructionTimeline(instructions = [], { correlationId = "", storeInstructionSamples = false } = {}) {
  const outcomeSignals = instructions
    .filter(Boolean)
    .filter((row) => row.status === "failed" || row.error || (row.status === "succeeded" && (!row.changedFiles || row.changedFiles.length === 0)))
    .slice(0, 120)
    .map((row) => {
      const noOutput = row.status === "succeeded" && (!row.changedFiles || row.changedFiles.length === 0);
      return createSignal({
        correlationId,
        kind: noOutput ? "empty_success_outcome" : "user_outcome_failure",
        severity: noOutput ? "medium" : "high",
        component: "instruction-outcome",
        message: noOutput
          ? "A workflow reported success without changed-file evidence."
          : row.error || "A user instruction did not reach a successful outcome.",
        metadata: {
          projectId: row.projectId || "",
          projectName: row.projectName || "",
          taskType: row.taskType || "",
          recordedAt: row.recordedAt || "",
          instructionStored: storeInstructionSamples,
          instructionSample: storeInstructionSamples ? neutralizeLogInstruction(row.instruction || "", { maxLength: 260 }) : ""
        }
      });
    });
  return [
    ...outcomeSignals,
    ...repeatedInstructionStruggleSignals(instructions, { correlationId, storeInstructionSamples })
  ];
}

export function observeTokenEconomy(tokenEconomy = {}, { correlationId = "" } = {}) {
  return Object.entries(tokenEconomy || {})
    .filter(([, summary]) => Number(summary?.totalRuns || 0) > 0)
    .filter(([, summary]) => Number(summary?.averageEfficiencyScore || 0) < 55 || Number(summary?.tokensPerAccuracyPoint || 0) > 1800)
    .slice(0, 40)
    .map(([agentId, summary]) => createSignal({
      correlationId,
      kind: "token_resource_waste",
      severity: Number(summary.averageEfficiencyScore || 0) < 45 ? "high" : "medium",
      component: "token-economy",
      target: { type: "agent", id: agentId },
      message: `${agentId} is spending too many tokens or cost relative to ability and changed-file signals.`,
      metadata: {
        agentId,
        totalRuns: summary.totalRuns || 0,
        averageEfficiencyScore: summary.averageEfficiencyScore || 0,
        averageAbilityScore: summary.averageAbilityScore || 0,
        tokensPerAccuracyPoint: summary.tokensPerAccuracyPoint || 0,
        estimatedUsd: summary.estimatedUsd || 0
      }
    }));
}

export function observeHealthReport(report = {}, { correlationId = "" } = {}) {
  return (report.issues || []).slice(0, 40).map((item) => createSignal({
    correlationId,
    source: "orchestrator-health-monitor",
    kind: `health_${item.category || "issue"}`,
    severity: item.severity || "medium",
    component: item.category || "orchestrator-health",
    message: `${item.title || "Health issue"}: ${item.detail || ""}`,
    metadata: {
      reportGeneratedAt: report.generatedAt || "",
      healthStatus: report.status || "",
      evidence: item.evidence || {}
    }
  }));
}

export function observeSystemInstruction({ instruction = "", taskType = "Medium", user = {}, correlationId = "" } = {}) {
  const normalizedTaskType = String(taskType || "Medium").toLowerCase();
  return [createSignal({
    correlationId,
    source: "gotham-system-target",
    kind: "system_improvement_instruction",
    severity: /hard|large|complex/.test(normalizedTaskType) ? "high" : "medium",
    component: "system-improvement-chat",
    target: { type: "system", id: "plutomix" },
    message: instruction,
    metadata: {
      taskType,
      userId: user.id || "anonymous",
      instructionStored: false
    }
  })];
}

export function observeInvestigatorFinding(investigation = {}, { correlationId = "" } = {}) {
  if (!investigation?.problemStatement) return [];
  return [createSignal({
    correlationId,
    source: "self-improvement-investigator-agent",
    kind: "investigator_problem_statement",
    severity: investigation.severity || "medium",
    component: investigation.component || "plutomix-runtime",
    target: { type: "system", id: "plutomix" },
    message: investigation.problemStatement,
    metadata: {
      investigationId: investigation.id || "",
      investigatorAgentId: investigation.agentId || "",
      qualityScore: investigation.qualityScore || 0,
      keyParameters: investigation.keyParameters || {},
      relatedCount: investigation.relatedCount || 0,
      eventId: investigation.eventId || "",
      eventType: investigation.eventType || ""
    }
  })];
}

export function observeToolCapabilityFinding(toolPlan = {}, { correlationId = "" } = {}) {
  if (!toolPlan?.problemStatement) return [];
  return [createSignal({
    correlationId,
    source: "self-improvement-tool-capability-agent",
    kind: toolPlan.solutionKind === "external_paid_tool" ? "paid_tool_approval_required" : "tool_or_optimization_plan",
    severity: toolPlan.severity || "medium",
    component: toolPlan.component || "plutomix-runtime",
    target: { type: "system", id: "plutomix" },
    message: toolPlan.problemStatement,
    metadata: {
      toolPlanId: toolPlan.id || "",
      agentId: toolPlan.agentId || "",
      solutionKind: toolPlan.solutionKind || "",
      proposedTool: toolPlan.proposedTool || {},
      monetaryApprovalRequired: Boolean(toolPlan.monetaryApprovalRequired),
      costEstimate: toolPlan.costEstimate || {},
      eventId: toolPlan.eventId || ""
    }
  })];
}
