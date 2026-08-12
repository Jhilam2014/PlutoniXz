import fs from "fs-extra";
import path from "node:path";
import { aggregateSignals, suppressDuplicatePatterns } from "./aggregator.js";
import { analyzeEvidencePackage } from "./analyst.js";
import { createIsolatedCandidate } from "./candidateWorker.js";
import { AUTONOMY_MODES, DEFAULT_SELF_IMPROVEMENT_CONFIG, projectRoot } from "./constants.js";
import { buildEvidencePackage } from "./evidenceBuilder.js";
import {
  observeHealthReport,
  observeInvestigatorFinding,
  observeInstructionTimeline,
  observeRuntimeEvents,
  observeSystemInstruction,
  observeToolCapabilityFinding,
  observeTokenEconomy
} from "./observer.js";
import { investigateRuntimeEvent } from "./investigatorAgent.js";
import { canCreateCandidate } from "./policy.js";
import { createProposalFromAnalysis, createSystemInstructionProposal } from "./planner.js";
import { planMarketResearch } from "./researchAgents.js";
import { SelfImprovementStore, createId, nowIso } from "./store.js";
import {
  applyMonetaryDecision,
  assessToolAndOptimizationNeed,
  buildGeneratedTool,
  createMonetaryApprovalRequest,
  runGeneratedTool
} from "./toolCapabilityAgent.js";
import { createManualTrigger, createTriggersFromPatterns } from "./triggerEngine.js";
import { decidePromotion, reviewCandidate, validateCandidate } from "./validation.js";
import { resolveGovernedSelfImprovementRuntimePolicy } from "../governedPromotion.js";

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

// JSONL is intentionally an append-only audit log.  It must not, however,
// become an append-only UI: one underlying issue can be observed many times
// while a page is open.  Keep the latest record and expose the observation
// count so BrainX reports the problem once, with its recurrence visible.
export function consolidateBrainXRecords(rows = [], keyFor = (row) => row?.id) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!row) continue;
    const key = String(keyFor(row) || row.id || "");
    const current = groups.get(key);
    const timestamp = new Date(row.timestamp || row.createdAt || 0).getTime();
    if (!current) {
      groups.set(key, { row, count: 1, firstSeenAt: row.timestamp || row.createdAt || "" });
      continue;
    }
    current.count += 1;
    const currentTimestamp = new Date(current.row.timestamp || current.row.createdAt || 0).getTime();
    if (timestamp >= currentTimestamp) current.row = row;
  }
  return [...groups.values()]
    .map(({ row, count, firstSeenAt }) => ({ ...row, occurrenceCount: count, firstSeenAt }))
    .sort((left, right) => new Date(right.timestamp || right.createdAt || 0) - new Date(left.timestamp || left.createdAt || 0));
}

export function readSelfImprovementConfig({ promotionScope } = {}) {
  const mode = process.env.SELF_IMPROVEMENT_MODE || DEFAULT_SELF_IMPROVEMENT_CONFIG.mode;
  const environmentConfig = {
    enabled: boolEnv("SELF_IMPROVEMENT_ENABLED", DEFAULT_SELF_IMPROVEMENT_CONFIG.enabled),
    mode: AUTONOMY_MODES.includes(mode) ? mode : DEFAULT_SELF_IMPROVEMENT_CONFIG.mode,
    scheduleMs: numberEnv("SELF_IMPROVEMENT_SCHEDULE_MS", numberEnv("SELF_IMPROVEMENT_SCHEDULE", DEFAULT_SELF_IMPROVEMENT_CONFIG.scheduleMs)),
    modelProfile: process.env.SELF_IMPROVEMENT_MODEL_PROFILE || "",
    maxCallsPerCycle: numberEnv("SELF_IMPROVEMENT_MAX_CALLS_PER_CYCLE", DEFAULT_SELF_IMPROVEMENT_CONFIG.maxCallsPerCycle),
    maxTokensPerCycle: numberEnv("SELF_IMPROVEMENT_MAX_TOKENS_PER_CYCLE", DEFAULT_SELF_IMPROVEMENT_CONFIG.maxTokensPerCycle),
    maxCostPerDay: numberEnv("SELF_IMPROVEMENT_MAX_COST_PER_DAY", DEFAULT_SELF_IMPROVEMENT_CONFIG.maxCostPerDay),
    minSignalCount: numberEnv("SELF_IMPROVEMENT_MIN_SIGNAL_COUNT", DEFAULT_SELF_IMPROVEMENT_CONFIG.minSignalCount),
    minConfidence: numberEnv("SELF_IMPROVEMENT_MIN_CONFIDENCE", DEFAULT_SELF_IMPROVEMENT_CONFIG.minConfidence),
    autoPromoteMaxRisk: process.env.SELF_IMPROVEMENT_AUTO_PROMOTE_MAX_RISK || DEFAULT_SELF_IMPROVEMENT_CONFIG.autoPromoteMaxRisk,
    postPromotionWindowMs: numberEnv("SELF_IMPROVEMENT_POST_PROMOTION_WINDOW_MS", numberEnv("SELF_IMPROVEMENT_POST_PROMOTION_WINDOW", DEFAULT_SELF_IMPROVEMENT_CONFIG.postPromotionWindowMs)),
    autoRollback: boolEnv("SELF_IMPROVEMENT_AUTO_ROLLBACK", DEFAULT_SELF_IMPROVEMENT_CONFIG.autoRollback),
    retentionDays: numberEnv("SELF_IMPROVEMENT_RETENTION_DAYS", DEFAULT_SELF_IMPROVEMENT_CONFIG.retentionDays),
    storeInstructionSamples: boolEnv("SELF_IMPROVEMENT_STORE_INSTRUCTION_SAMPLES", DEFAULT_SELF_IMPROVEMENT_CONFIG.storeInstructionSamples),
    eventCheckEnabled: boolEnv("SELF_IMPROVEMENT_EVENT_CHECK_ENABLED", DEFAULT_SELF_IMPROVEMENT_CONFIG.eventCheckEnabled),
    eventTriggerMinScore: numberEnv("SELF_IMPROVEMENT_EVENT_TRIGGER_MIN_SCORE", DEFAULT_SELF_IMPROVEMENT_CONFIG.eventTriggerMinScore),
    eventWindowMs: numberEnv("SELF_IMPROVEMENT_EVENT_WINDOW_MS", DEFAULT_SELF_IMPROVEMENT_CONFIG.eventWindowMs),
    eventMinRelatedSignals: numberEnv("SELF_IMPROVEMENT_EVENT_MIN_RELATED_SIGNALS", DEFAULT_SELF_IMPROVEMENT_CONFIG.eventMinRelatedSignals),
    eventTriggerCooldownMs: numberEnv("SELF_IMPROVEMENT_EVENT_TRIGGER_COOLDOWN_MS", DEFAULT_SELF_IMPROVEMENT_CONFIG.eventTriggerCooldownMs),
    randomAuditRate: numberEnv("SELF_IMPROVEMENT_RANDOM_AUDIT_RATE", DEFAULT_SELF_IMPROVEMENT_CONFIG.randomAuditRate),
    researchEnabled: boolEnv("SELF_IMPROVEMENT_RESEARCH_ENABLED", DEFAULT_SELF_IMPROVEMENT_CONFIG.researchEnabled),
    researchAllowNetwork: boolEnv("SELF_IMPROVEMENT_RESEARCH_ALLOW_NETWORK", DEFAULT_SELF_IMPROVEMENT_CONFIG.researchAllowNetwork),
    researchMaxCallsPerDay: numberEnv("SELF_IMPROVEMENT_RESEARCH_MAX_CALLS_PER_DAY", DEFAULT_SELF_IMPROVEMENT_CONFIG.researchMaxCallsPerDay),
    researchMaxTokensPerDay: numberEnv("SELF_IMPROVEMENT_RESEARCH_MAX_TOKENS_PER_DAY", DEFAULT_SELF_IMPROVEMENT_CONFIG.researchMaxTokensPerDay),
    researchMaxCostPerDay: numberEnv("SELF_IMPROVEMENT_RESEARCH_MAX_COST_PER_DAY", DEFAULT_SELF_IMPROVEMENT_CONFIG.researchMaxCostPerDay),
    researchSources: String(process.env.SELF_IMPROVEMENT_RESEARCH_SOURCES || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    toolBuildEnabled: boolEnv("SELF_IMPROVEMENT_TOOL_BUILD_ENABLED", DEFAULT_SELF_IMPROVEMENT_CONFIG.toolBuildEnabled),
    toolPlanAutoTrigger: boolEnv("SELF_IMPROVEMENT_TOOL_PLAN_AUTO_TRIGGER", DEFAULT_SELF_IMPROVEMENT_CONFIG.toolPlanAutoTrigger),
    toolPlanCooldownMs: numberEnv("SELF_IMPROVEMENT_TOOL_PLAN_COOLDOWN_MS", DEFAULT_SELF_IMPROVEMENT_CONFIG.toolPlanCooldownMs),
    maxToolBuildsPerDay: numberEnv("SELF_IMPROVEMENT_MAX_TOOL_BUILDS_PER_DAY", DEFAULT_SELF_IMPROVEMENT_CONFIG.maxToolBuildsPerDay),
    monetaryApprovalRequired: boolEnv("SELF_IMPROVEMENT_MONETARY_APPROVAL_REQUIRED", DEFAULT_SELF_IMPROVEMENT_CONFIG.monetaryApprovalRequired),
    monetaryApprovalThresholdUsd: numberEnv("SELF_IMPROVEMENT_MONETARY_APPROVAL_THRESHOLD_USD", DEFAULT_SELF_IMPROVEMENT_CONFIG.monetaryApprovalThresholdUsd)
  };
  // This is the actual runtime seam for Step 4. The resolver only returns a
  // promoted policy after the governed selector is enabled and hydrated; an
  // unconfigured production process continues with its explicit environment
  // policy and never silently activates a candidate.
  const governed = resolveGovernedSelfImprovementRuntimePolicy(promotionScope);
  if (!governed.policy) return { ...environmentConfig, governedPromotion: { source: governed.source, halted: governed.halted } };
  return {
    ...environmentConfig,
    ...governed.policy,
    governedPromotion: { source: governed.source, digest: governed.digest || "", halted: governed.halted }
  };
}

async function readRuntimeMetrics(root) {
  const latestEfficiencyPath = path.join(root, "observability", "agent-efficiency", "latest-agent-efficiency.json");
  const latestHealthPath = path.join(root, "observability", "orchestrator-health", "latest-health-report.json");
  const [efficiency, health] = await Promise.all([
    fs.pathExists(latestEfficiencyPath).then((exists) => exists ? fs.readJson(latestEfficiencyPath).catch(() => null) : null),
    fs.pathExists(latestHealthPath).then((exists) => exists ? fs.readJson(latestHealthPath).catch(() => null) : null)
  ]);
  return { efficiency, health };
}

export function createSelfImprovementControlPlane({
  root = projectRoot(),
  emit = () => {},
  getRuntimeEvents = () => [],
  getInstructionTimeline = () => [],
  getTokenEconomy = async () => ({}),
  configProvider = readSelfImprovementConfig
} = {}) {
  const store = new SelfImprovementStore({ root });
  let timer = null;
  let inMemoryState = null;
  let nextRunAt = "";
  let activeRunIndicator = null;

  const runIndicatorFor = ({
    state = "idle",
    phase = "idle",
    cycleId = "",
    reason = "",
    manual = false,
    mode = "",
    message = "",
    startedAt = "",
    completedAt = "",
    nextScheduledRunAt = nextRunAt
  } = {}) => ({
    state,
    phase,
    cycleId,
    reason,
    manual,
    mode,
    message,
    startedAt,
    completedAt,
    nextRunAt: nextScheduledRunAt,
    updatedAt: nowIso()
  });

  const recordRunLog = async ({
    cycle = {},
    state = "idle",
    phase = "idle",
    message = "",
    error = "",
    summary = null
  } = {}) => {
    await store.ensure();
    const record = {
      id: createId("si_run"),
      schemaVersion: "1.0.0",
      timestamp: nowIso(),
      state,
      phase,
      cycleId: cycle.id || "",
      reason: cycle.reason || "",
      manual: Boolean(cycle.manual),
      mode: cycle.mode || "",
      message,
      error,
      summary: summary || cycle.summary || {},
      nextRunAt
    };
    await store.append("runLogs", record);
    await store.writeLatestRunLog(record);
    activeRunIndicator = runIndicatorFor({
      state,
      phase,
      cycleId: record.cycleId,
      reason: record.reason,
      manual: record.manual,
      mode: record.mode,
      message,
      startedAt: cycle.startedAt || "",
      completedAt: cycle.completedAt || ""
    });
    return record;
  };

  const writeCycleSnapshots = async (cycle, indicatorPatch = {}) => {
    cycle.runIndicator = {
      ...(cycle.runIndicator || activeRunIndicator || runIndicatorFor()),
      ...indicatorPatch,
      nextRunAt,
      updatedAt: nowIso()
    };
    activeRunIndicator = cycle.runIndicator;
    await store.writeLatestCycle(cycle);
    await store.writeLatestStatus(cycle);
  };

  const loadState = async () => {
    const config = configProvider();
    const state = await store.readState({
      schemaVersion: "1.0.0",
      enabled: config.enabled,
      mode: config.mode,
      paused: false,
      emergencyStopped: false,
      updatedAt: nowIso(),
      consecutiveRollbacks: 0,
      lastCycleId: ""
    });
    inMemoryState = { ...state, enabled: config.enabled, mode: state.mode || config.mode };
    return inMemoryState;
  };

  const writeState = async (patch = {}) => {
    const current = inMemoryState || await loadState();
    inMemoryState = { ...current, ...patch, updatedAt: nowIso() };
    await store.writeState(inMemoryState);
    return inMemoryState;
  };

  const status = async () => {
    const state = await loadState();
    const latest = await store.readLatestStatus();
    const latestRunLog = await store.readLatestRunLog();
    return {
      status: state.emergencyStopped ? "emergency_stopped" : state.paused ? "paused" : state.enabled ? "enabled" : "disabled",
      mode: state.mode,
      enabled: state.enabled,
      paused: state.paused,
      emergencyStopped: state.emergencyStopped,
      scheduler: "event_driven_adhoc",
      durability: "file_backed_jsonl_with_lock",
      runIndicator: activeRunIndicator || latest?.runIndicator || runIndicatorFor({
        state: state.emergencyStopped ? "emergency_stopped" : state.paused ? "paused" : state.enabled ? "adhoc_ready" : "disabled",
        phase: state.enabled ? "waiting_for_event" : "disabled",
        mode: state.mode,
        message: state.enabled
          ? "Self-improvement is event-driven and will run only when logged activity, investigator findings, health findings, or Gotham system-target requests require it."
          : "Self-improvement is disabled."
      }),
      latestRunLog,
      latest
    };
  };

  const collectSignals = async ({ correlationId, extraSignals = [] } = {}) => {
    const config = configProvider();
    const [runtimeEvents, instructionTimeline, tokenEconomy] = await Promise.all([
      Promise.resolve(getRuntimeEvents()),
      Promise.resolve(getInstructionTimeline()),
      Promise.resolve(getTokenEconomy())
    ]);
    return [
      ...observeRuntimeEvents(runtimeEvents, { correlationId }),
      ...observeInstructionTimeline(instructionTimeline, {
        correlationId,
        storeInstructionSamples: config.storeInstructionSamples
      }),
      ...observeTokenEconomy(tokenEconomy, { correlationId }),
      ...extraSignals
    ];
  };

  const runMarketResearchCheck = async ({ topic = "", reason = "investigator-agent-research-signal" } = {}) => {
    await store.ensure();
    const config = configProvider();
    const previousResearchLogs = await store.read("researchLogs");
    const researchLog = planMarketResearch({
      topic,
      reason,
      config,
      previousResearchLogs
    });
    await store.append("researchLogs", researchLog);
    await store.writeLatestResearchLog(researchLog);
    return researchLog;
  };

  const runToolCapabilityCheck = async ({ eventRow = {}, investigation = {} } = {}) => {
    await store.ensure();
    const config = configProvider();
    const recentToolPlans = await store.read("toolPlans");
    const toolPlan = assessToolAndOptimizationNeed({
      event: eventRow,
      investigation,
      config,
      recentToolPlans
    });
    if (!toolPlan.required) return { toolPlan };
    await store.append("toolPlans", toolPlan);
    await store.writeLatestToolPlan(toolPlan);

    let approval = null;
    let generatedTool = null;
    let toolRun = null;
    if (toolPlan.monetaryApprovalRequired) {
      approval = createMonetaryApprovalRequest(toolPlan);
      await store.append("monetaryApprovals", approval);
      await store.writeLatestMonetaryApproval(approval);
      emit("self-improvement-monetary-approval-required", toolPlan.approvalPrompt, {
        source: "self-improvement-tool-capability-agent",
        toolPlanId: toolPlan.id,
        approvalId: approval.id,
        component: toolPlan.component,
        estimatedUsd: toolPlan.costEstimate?.estimatedUsd || 0,
        cheaperAlternatives: toolPlan.cheaperAlternatives || []
      });
      return { toolPlan, approval };
    }

    if (config.toolBuildEnabled && toolPlan.status === "ready_for_candidate") {
      generatedTool = await buildGeneratedTool({ toolPlan, store });
      await store.append("generatedTools", generatedTool);
      toolRun = runGeneratedTool({ generatedTool, event: eventRow, investigation, toolPlan });
      await store.append("toolRuns", toolRun);
      emit("self-improvement-tool-built", `Built generated tool ${generatedTool.name} for ${toolPlan.component}`, {
        source: "self-improvement-tool-capability-agent",
        toolPlanId: toolPlan.id,
        generatedToolId: generatedTool.id,
        component: toolPlan.component,
        solutionKind: toolPlan.solutionKind
      });
    }
    return { toolPlan, generatedTool, toolRun };
  };

  const processTrigger = async ({ trigger, signals, patterns, cycle, systemInstruction = null } = {}) => {
    const config = configProvider();
    const runtimeMetrics = await readRuntimeMetrics(root);
    const evidencePackage = await buildEvidencePackage({ root, trigger, signals, patterns, runtimeMetrics, config });
    await store.append("evidence", evidencePackage);
    const existingProposals = await store.read("proposals");
    let analysis = null;
    let proposal = null;
    if (systemInstruction) {
      proposal = createSystemInstructionProposal({
        instruction: systemInstruction.instruction,
        taskType: systemInstruction.taskType,
        evidencePackage,
        existingProposals
      });
    } else {
      analysis = await analyzeEvidencePackage(evidencePackage, {
        modelProfile: config.modelProfile,
        allowModelCall: trigger.estimatedInvestigationCost?.modelCalls > 0
      });
      await store.append("analyses", analysis);
      proposal = createProposalFromAnalysis({ analysis, evidencePackage, existingProposals });
    }
    await store.append("proposals", proposal);

    let candidate = null;
    let validation = null;
    let review = null;
    let promotion = null;
    if (proposal.status !== "rejected" && canCreateCandidate(cycle.mode)) {
      candidate = await createIsolatedCandidate({ proposal, store, root, mode: cycle.mode });
      await store.append("candidates", candidate);
      validation = await validateCandidate({ root, proposal, candidate });
      await store.append("validations", validation);
      review = reviewCandidate({ proposal, validation });
      await store.append("reviews", review);
      promotion = decidePromotion({ proposal, validation, review, mode: cycle.mode, config });
      await store.append("promotions", promotion);
    }
    return { trigger, evidencePackage, analysis, proposal, candidate, validation, review, promotion };
  };

  const runCycle = async ({ reason = "adhoc", manual = false, extraSignals = [], systemInstruction = null, investigation = null } = {}) => {
    await store.ensure();
    const state = await loadState();
    const config = configProvider();
    const cycleId = createId("si_cycle");
    const cycle = {
      id: cycleId,
      reason,
      manual,
      mode: state.mode || config.mode,
      startedAt: nowIso(),
      status: "running",
      summary: {}
    };
    await recordRunLog({
      cycle,
      state: "starting",
      phase: "cycle_starting",
      message: `Self-improvement cycle is about to run for reason: ${reason}.`
    });
    cycle.runIndicator = activeRunIndicator;
    emit("self-improvement-cycle-starting", `Self-improvement cycle is about to run: ${reason}`, {
      source: "self-improvement-control-plane",
      cycleId: cycle.id,
      mode: cycle.mode,
      reason,
      manual,
      nextRunAt
    });
    await writeCycleSnapshots(cycle);
    if (!state.enabled || !config.enabled) {
      cycle.status = "skipped";
      cycle.summary.skipReason = "self_improvement_disabled";
      await recordRunLog({
        cycle,
        state: "skipped",
        phase: "cycle_skipped",
        message: "Self-improvement cycle skipped because the control plane is disabled."
      });
      await writeCycleSnapshots(cycle, activeRunIndicator);
      return cycle;
    }
    if (state.paused || state.emergencyStopped) {
      cycle.status = "skipped";
      cycle.summary.skipReason = state.emergencyStopped ? "emergency_stop_active" : "paused";
      await recordRunLog({
        cycle,
        state: "skipped",
        phase: "cycle_skipped",
        message: state.emergencyStopped
          ? "Self-improvement cycle skipped because emergency stop is active."
          : "Self-improvement cycle skipped because the control plane is paused."
      });
      await writeCycleSnapshots(cycle, activeRunIndicator);
      return cycle;
    }
    const release = await store.acquireCycleLock({ owner: cycleId });
    if (!release) {
      cycle.status = "skipped";
      cycle.summary.skipReason = "cycle_lock_held_by_another_instance";
      await recordRunLog({
        cycle,
        state: "skipped",
        phase: "cycle_lock_skipped",
        message: "Self-improvement cycle skipped because another instance holds the cycle lock."
      });
      await writeCycleSnapshots(cycle, activeRunIndicator);
      return cycle;
    }
    try {
      await recordRunLog({
        cycle,
        state: "running",
        phase: "cycle_running",
        message: "Self-improvement cycle acquired its lock and is collecting signals."
      });
      await writeCycleSnapshots(cycle, activeRunIndicator);
      const signals = await collectSignals({ correlationId: cycleId, extraSignals });
      await store.append("signals", signals);
      const existingTriggers = await store.read("triggers");
      const patterns = suppressDuplicatePatterns(aggregateSignals(signals, {
        correlationId: cycleId,
        minSignalCount: config.minSignalCount
      }), existingTriggers);
      await store.append("patterns", patterns);
      const triggers = investigation
        ? [createManualTrigger({
            reason: investigation.problemStatement || "Self-improvement investigator found a possible platform issue.",
            severity: investigation.severity || "medium",
            affectedComponents: investigation.affectedComponents || [investigation.component || "plutonix-runtime"],
            evidenceRefs: signals.map((signal) => signal.id),
            confidence: investigation.qualityScore || 0.8,
            correlationId: cycleId
          })]
        : systemInstruction
        ? [createManualTrigger({
            reason: "Gotham system target requested platform improvement proposal.",
            severity: /hard|large|complex/i.test(systemInstruction.taskType || "") ? "high" : "medium",
            affectedComponents: ["plutonix-platform", "gotham-system-target"],
            evidenceRefs: signals.map((signal) => signal.id),
            correlationId: cycleId
          })]
        : createTriggersFromPatterns(patterns, {
            correlationId: cycleId,
            minSignalCount: config.minSignalCount,
            minConfidence: config.minConfidence
          });
      await store.append("triggers", triggers);
      const processed = [];
      for (const trigger of triggers.slice(0, Math.max(0, config.maxCallsPerCycle))) {
        processed.push(await processTrigger({ trigger, signals, patterns, cycle, systemInstruction }));
      }
      cycle.status = "completed";
      cycle.completedAt = nowIso();
      cycle.summary = {
        signalCount: signals.length,
        patternCount: patterns.length,
        triggerCount: triggers.length,
        proposalCount: processed.filter((item) => item.proposal).length,
        candidateCount: processed.filter((item) => item.candidate).length,
        promotionDecisions: processed.map((item) => item.promotion?.decision).filter(Boolean)
      };
      cycle.results = processed.map((item) => ({
        triggerId: item.trigger.id,
        proposalId: item.proposal?.proposalId || "",
        proposalStatus: item.proposal?.status || "",
        candidateId: item.candidate?.candidateId || "",
        reviewDecision: item.review?.decision || "",
        promotionDecision: item.promotion?.decision || ""
      }));
      await writeState({ lastCycleId: cycle.id, mode: cycle.mode });
      await recordRunLog({
        cycle,
        state: "completed",
        phase: "cycle_completed",
        message: `Self-improvement cycle completed with ${cycle.summary.proposalCount} proposal${cycle.summary.proposalCount === 1 ? "" : "s"}.`
      });
      await writeCycleSnapshots(cycle, activeRunIndicator);
      emit("self-improvement-cycle-complete", `Self-improvement cycle completed with ${cycle.summary.proposalCount} proposal${cycle.summary.proposalCount === 1 ? "" : "s"}`, {
        source: "self-improvement-control-plane",
        cycleId: cycle.id,
        mode: cycle.mode,
        summary: cycle.summary
      });
      return cycle;
    } catch (error) {
      cycle.status = "failed";
      cycle.completedAt = nowIso();
      cycle.error = error.message;
      await store.writeDeadLetter(cycle, error);
      await recordRunLog({
        cycle,
        state: "failed",
        phase: "cycle_failed",
        message: "Self-improvement cycle failed.",
        error: error.message
      });
      await writeCycleSnapshots(cycle, activeRunIndicator);
      emit("self-improvement-cycle-failed", error.message, {
        source: "self-improvement-control-plane",
        cycleId: cycle.id
      });
      return cycle;
    } finally {
      await release();
    }
  };

  const recordRuntimeEvent = async (eventRow = {}) => {
    const config = configProvider();
    if (!config.enabled || !config.eventCheckEnabled) {
      return { checked: false, skipped: true, reason: "event_check_disabled" };
    }
    const state = await loadState();
    if (!state.enabled || state.paused || state.emergencyStopped) {
      return {
        checked: false,
        skipped: true,
        reason: state.emergencyStopped ? "emergency_stop_active" : state.paused ? "paused" : "disabled"
      };
    }
    await store.ensure();
    const recentInvestigations = (await store.read("investigations")).slice(-300);
    const investigation = investigateRuntimeEvent({
      event: eventRow,
      recentInvestigations,
      config
    });
    if (!investigation.checked) return investigation;
    await store.append("investigations", investigation);
    await store.writeLatestInvestigation(investigation);
    const toolOutcome = await runToolCapabilityCheck({ eventRow, investigation });
    if (investigation.keyParameters?.marketplaceResearch || investigation.randomAuditSelected) {
      await runMarketResearchCheck({
        topic: investigation.eventExcerpt || investigation.component,
        reason: investigation.keyParameters?.marketplaceResearch
          ? "investigator-agent-marketplace-research-signal"
          : "investigator-agent-random-audit"
      });
    }
    if (!investigation.shouldTrigger && toolOutcome.toolPlan?.shouldTriggerImprovement && toolOutcome.toolPlan?.status === "ready_for_candidate") {
      const correlationId = createId("si_tool");
      const signals = observeToolCapabilityFinding(toolOutcome.toolPlan, { correlationId });
      const cycle = await runCycle({
        reason: "tool-capability-agent-finding",
        manual: false,
        extraSignals: signals,
        investigation: {
          id: toolOutcome.toolPlan.id,
          problemStatement: toolOutcome.toolPlan.problemStatement,
          severity: toolOutcome.toolPlan.severity || "medium",
          affectedComponents: toolOutcome.toolPlan.affectedComponents || [toolOutcome.toolPlan.component || "plutonix-runtime"],
          component: toolOutcome.toolPlan.component || "plutonix-runtime",
          qualityScore: 0.8
        }
      });
      return {
        ...investigation,
        toolPlanId: toolOutcome.toolPlan.id,
        generatedToolId: toolOutcome.generatedTool?.id || "",
        toolRunId: toolOutcome.toolRun?.id || "",
        cycleId: cycle.id,
        cycleStatus: cycle.status
      };
    }
    if (!investigation.shouldTrigger) {
      return {
        ...investigation,
        toolPlanId: toolOutcome.toolPlan?.id || "",
        generatedToolId: toolOutcome.generatedTool?.id || "",
        toolRunId: toolOutcome.toolRun?.id || "",
        monetaryApprovalId: toolOutcome.approval?.id || ""
      };
    }
    const correlationId = createId("si_investigation");
    const signals = observeInvestigatorFinding(investigation, { correlationId });
    const cycle = await runCycle({
      reason: "investigator-agent-finding",
      manual: false,
      extraSignals: signals,
      investigation
    });
    return {
      ...investigation,
      toolPlanId: toolOutcome.toolPlan?.id || "",
      generatedToolId: toolOutcome.generatedTool?.id || "",
      toolRunId: toolOutcome.toolRun?.id || "",
      monetaryApprovalId: toolOutcome.approval?.id || "",
      cycleId: cycle.id,
      cycleStatus: cycle.status
    };
  };

  const handleMonetaryDecision = async ({ approvalId = "", decision = "cheaper_solution", user = {}, note = "" } = {}) => {
    await store.ensure();
    const approvals = await store.read("monetaryApprovals");
    const approval = [...approvals].reverse().find((row) => row.id === approvalId);
    if (!approval) throw new Error("Monetary approval request not found.");
    const decisionRecord = applyMonetaryDecision({ approval, decision, user, note });
    await store.append("monetaryApprovals", decisionRecord);
    await store.writeLatestMonetaryApproval(decisionRecord);

    let cheaperToolPlan = null;
    let generatedTool = null;
    let toolRun = null;
    if (decisionRecord.decision === "cheaper_solution") {
      const sourceToolPlan = [...(await store.read("toolPlans"))].reverse().find((row) => row.id === approval.toolPlanId);
      if (sourceToolPlan) {
        cheaperToolPlan = {
          ...sourceToolPlan,
          id: createId("si_tool_plan"),
          timestamp: nowIso(),
          status: "ready_for_candidate",
          solutionKind: "internal_tool",
          parentToolPlanId: sourceToolPlan.id,
          problemStatement: `Cheaper internal alternative requested for paid tool plan. ${sourceToolPlan.problemStatement || ""}`,
          costEstimate: {
            requiresMonetaryValue: false,
            estimatedUsd: 0,
            billingPeriod: "none",
            paidResource: "",
            approvalRequired: false,
            approvalStatus: "not_required"
          },
          monetaryApprovalRequired: false,
          approvalPrompt: "",
          proposedTool: {
            ...(sourceToolPlan.proposedTool || {}),
            name: "PlutoniX Cheaper Internal Alternative Tool",
            slug: "plutonix-cheaper-internal-alternative-tool",
            capability: "Replace a paid capability request with a local bounded analysis or automation tool."
          },
          shouldTriggerImprovement: true
        };
        await store.append("toolPlans", cheaperToolPlan);
        await store.writeLatestToolPlan(cheaperToolPlan);
        if (configProvider().toolBuildEnabled) {
          generatedTool = await buildGeneratedTool({ toolPlan: cheaperToolPlan, store });
          await store.append("generatedTools", generatedTool);
          toolRun = runGeneratedTool({ generatedTool, toolPlan: cheaperToolPlan });
          await store.append("toolRuns", toolRun);
        }
      }
    }

    emit(`self-improvement-monetary-${decisionRecord.status}`, decisionRecord.approvalPrompt, {
      source: "self-improvement-monetary-approval-gate",
      approvalId: decisionRecord.id,
      originalApprovalId: approvalId,
      toolPlanId: approval.toolPlanId,
      decision: decisionRecord.decision,
      cheaperToolPlanId: cheaperToolPlan?.id || ""
    });
    return { approval: decisionRecord, cheaperToolPlan, generatedTool, toolRun };
  };

  return {
    store,
    async start() {
      await store.ensure();
      const state = await loadState();
      const config = configProvider();
      nextRunAt = "";
      activeRunIndicator = runIndicatorFor({
        state: state.enabled && config.enabled ? "adhoc_ready" : "disabled",
        phase: state.enabled && config.enabled ? "waiting_for_event" : "disabled",
        mode: state.mode || config.mode,
        message: state.enabled && config.enabled
          ? "Self-improvement is event-driven and will run only when logged evidence requires it."
          : "Self-improvement is disabled."
      });
      await store.writeLatestStatus({
        status: state.enabled ? "enabled" : "disabled",
        mode: state.mode || config.mode,
        updatedAt: nowIso(),
        durability: "file_backed_jsonl_with_lock",
        runIndicator: activeRunIndicator
      });
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    runCycle,
    async recordHealthReport(report) {
      const correlationId = createId("si_health");
      const signals = observeHealthReport(report, { correlationId });
      if (!signals.length) return { status: "skipped", reason: "no_health_signals" };
      return runCycle({ reason: "orchestrator-health-report", extraSignals: signals });
    },
    async handleSystemInstruction({ instruction, taskType = "Medium", user = {} } = {}) {
      const correlationId = createId("si_system");
      const signals = observeSystemInstruction({ instruction, taskType, user, correlationId });
      // Research is a conditional adviser.  Planner/self-improvement questions
      // receive a budgeted research record; ordinary platform changes do not
      // consume that budget merely because they reached BrainX.
      const needsResearch = /\b(research|paper|self[- ]?improv|planner|approach|alternative)\b/i.test(String(instruction || ""));
      const research = needsResearch
        ? await runMarketResearchCheck({
            topic: instruction,
            reason: "brainx-self-improvement-planner-task"
          })
        : null;
      const cycle = await runCycle({
        reason: "gotham-system-target",
        manual: true,
        extraSignals: signals,
        systemInstruction: { instruction, taskType, user }
      });
      return { ...cycle, research };
    },
    async listProposals({ limit = 50 } = {}) {
      return consolidateBrainXRecords(await store.read("proposals"), (row) =>
        row.proposalId || `${row.title || ""}:${row.category || ""}:${row.problem || ""}`)
        .slice(0, limit);
    },
    async listSignals({ limit = 100 } = {}) {
      return (await store.read("signals"))
        .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0))
        .slice(0, limit);
    },
    async listPatterns({ limit = 100 } = {}) {
      return consolidateBrainXRecords(await store.read("patterns"), (row) => row.patternKey || row.id)
        .slice(0, limit);
    },
    async listRunLogs({ limit = 100 } = {}) {
      return (await store.read("runLogs"))
        .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0))
        .slice(0, limit);
    },
    async listInvestigations({ limit = 100 } = {}) {
      return consolidateBrainXRecords(await store.read("investigations"), (row) => row.fingerprint || row.id)
        .slice(0, limit);
    },
    async listResearchLogs({ limit = 100 } = {}) {
      return (await store.read("researchLogs"))
        .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0))
        .slice(0, limit);
    },
    async listToolPlans({ limit = 100 } = {}) {
      return (await store.read("toolPlans"))
        .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0))
        .slice(0, limit);
    },
    async listGeneratedTools({ limit = 100 } = {}) {
      return (await store.read("generatedTools"))
        .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0))
        .slice(0, limit);
    },
    async listToolRuns({ limit = 100 } = {}) {
      return (await store.read("toolRuns"))
        .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0))
        .slice(0, limit);
    },
    async listMonetaryApprovals({ limit = 100 } = {}) {
      return (await store.read("monetaryApprovals"))
        .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0))
        .slice(0, limit);
    },
    recordRuntimeEvent,
    runMarketResearchCheck,
    handleMonetaryDecision,
    async control(action, patch = {}) {
      if (action === "pause") return writeState({ paused: true });
      if (action === "resume") return writeState({ paused: false, emergencyStopped: false });
      if (action === "emergency_stop") return writeState({ emergencyStopped: true, paused: true });
      if (action === "configure") {
        const next = {};
        if (AUTONOMY_MODES.includes(patch.mode)) next.mode = patch.mode;
        if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
        return writeState(next);
      }
      return writeState({});
    },
    status
  };
}
