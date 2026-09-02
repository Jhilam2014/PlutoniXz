import path from "node:path";
import fs from "fs-extra";
import { DEFAULT_SELF_IMPROVEMENT_CONFIG, SELF_IMPROVEMENT_SCHEMA_VERSION } from "./constants.js";
import { stableHashIdentifierSchema } from "./contracts.js";
import { fingerprintText, neutralizeLogInstruction } from "./redaction.js";
import { createId, nowIso, stableHash } from "./store.js";

const TOOL_CAPABILITY_AGENT_ID = "plutomix-tool-capability-agent";
const TOOL_BUILDER_AGENT_ID = "plutomix-autonomous-tool-builder-agent";

function textFor({ event = {}, investigation = {} } = {}) {
  return [
    event.type,
    event.status,
    event.message,
    investigation.problemStatement,
    investigation.eventExcerpt
  ].filter(Boolean).join(" ").toLowerCase();
}

function slug(value = "plutomix-tool") {
  return String(value || "plutomix-tool")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "plutomix-tool";
}

function dailyCount(rows = []) {
  const today = new Date().toISOString().slice(0, 10);
  return rows.filter((row) => String(row.timestamp || "").startsWith(today) && row.status !== "duplicate_suppressed").length;
}

function recentlyPlanned(rows = [], key = "", cooldownMs = DEFAULT_SELF_IMPROVEMENT_CONFIG.toolPlanCooldownMs) {
  const now = Date.now();
  return rows.some((row) => {
    if (row.normalizedKey !== key) return false;
    const timestamp = new Date(row.timestamp || 0).getTime();
    return Number.isFinite(timestamp) && now - timestamp <= cooldownMs;
  });
}

function classifyNeed(text = "", investigation = {}) {
  const toolGap = /missing tool|need(?:s)? (?:an? )?(?:new )?tool|requires? (?:an? )?(?:new )?tool|no tool|cannot inspect|cannot parse|unsupported|manual work|automate|instrument/.test(text);
  const sluggishness = /slow|sluggish|lag|timeout|taking too long|took too long|duration|stuck|heavy|resource|memory|cpu|high latency|low efficiency/.test(text) ||
    Boolean(investigation.keyParameters?.efficiency);
  const complexity = /complex|too many clicks|too many steps|confusing|friction|hard to use|abandon|restart|repeated correction|simplify|workflow simplicity/.test(text) ||
    Boolean(investigation.keyParameters?.uiFriction);
  const paid = /paid|billing|subscription|license|marketplace|external api|third[- ]party|cloud api|gpu|managed service|saas|vendor/.test(text);
  return { toolGap, sluggishness, complexity, paid };
}

function chooseSolutionKind(need = {}) {
  if (need.paid) return "external_paid_tool";
  if (need.toolGap) return "internal_tool";
  if (need.sluggishness) return "platform_optimization";
  if (need.complexity) return "agent_or_ui_simplification";
  return "none";
}

function toolNameFor(solutionKind, component = "plutomix-runtime") {
  if (solutionKind === "internal_tool") return "PlutoMix Capability Gap Tool";
  if (solutionKind === "platform_optimization") return "PlutoMix Sluggishness Profiler";
  if (solutionKind === "agent_or_ui_simplification") return "PlutoMix Workflow Simplifier";
  if (solutionKind === "external_paid_tool") return "PlutoMix Paid Tool Evaluation Adapter";
  return `PlutoMix ${component} Helper`;
}

function estimatedCostFor(solutionKind, need = {}, config = DEFAULT_SELF_IMPROVEMENT_CONFIG) {
  if (solutionKind !== "external_paid_tool") {
    return {
      requiresMonetaryValue: false,
      estimatedUsd: 0,
      billingPeriod: "none",
      paidResource: "",
      approvalRequired: false,
      approvalStatus: "not_required"
    };
  }
  const estimatedUsd = Math.max(Number(config.monetaryApprovalThresholdUsd || 0), need.paid ? 25 : 1);
  return {
    requiresMonetaryValue: true,
    estimatedUsd,
    billingPeriod: "monthly_or_usage_based",
    paidResource: "external marketplace, SaaS, cloud, GPU, or paid API tool",
    approvalRequired: Boolean(config.monetaryApprovalRequired),
    approvalStatus: config.monetaryApprovalRequired ? "pending_user_approval" : "not_required"
  };
}

export function assessToolAndOptimizationNeed({
  event = {},
  investigation = {},
  config = DEFAULT_SELF_IMPROVEMENT_CONFIG,
  recentToolPlans = []
} = {}) {
  const text = textFor({ event, investigation });
  const need = classifyNeed(text, investigation);
  const solutionKind = chooseSolutionKind(need);
  const needed = solutionKind !== "none";
  if (!needed) {
    return {
      checked: true,
      required: false,
      status: "not_required",
      reason: "no_tool_or_optimization_gap_detected",
      eventId: event.id || "",
      investigationId: investigation.id || ""
    };
  }
  const component = investigation.component || event.component || "plutomix-runtime";
  const normalizedKey = stableHashIdentifierSchema.parse(stableHash(fingerprintText(`${solutionKind}:${component}:${event.type || ""}:${event.message || ""}`)).slice(0, 24));
  const duplicate = recentlyPlanned(recentToolPlans, normalizedKey, config.toolPlanCooldownMs);
  const buildLimitReached = dailyCount(recentToolPlans) >= Number(config.maxToolBuildsPerDay || DEFAULT_SELF_IMPROVEMENT_CONFIG.maxToolBuildsPerDay);
  const costEstimate = estimatedCostFor(solutionKind, need, config);
  const status = duplicate
    ? "duplicate_suppressed"
    : costEstimate.approvalRequired && costEstimate.estimatedUsd > Number(config.monetaryApprovalThresholdUsd || 0)
      ? "awaiting_monetary_approval"
      : buildLimitReached
        ? "deferred_daily_tool_build_limit"
        : "ready_for_candidate";
  const title = toolNameFor(solutionKind, component);
  const problemStatement = [
    need.toolGap ? "A capability/tool gap was detected." : "",
    need.sluggishness ? "A sluggishness or resource-efficiency issue was detected." : "",
    need.complexity ? "A workflow complexity issue was detected." : "",
    need.paid ? "The likely solution may require a monetary resource." : "",
    `Affected component: ${component}.`,
    `Evidence: ${neutralizeLogInstruction(event.message || investigation.problemStatement || "", { maxLength: 220 })}`
  ].filter(Boolean).join(" ");

  return {
    id: createId("si_tool_plan"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    timestamp: nowIso(),
    checked: true,
    required: true,
    status,
    normalizedKey,
    source: "self-improvement-tool-capability-agent",
    agentId: TOOL_CAPABILITY_AGENT_ID,
    agentRole: "capability-gap-and-operational-optimization-agent",
    eventId: event.id || "",
    eventType: event.type || "",
    investigationId: investigation.id || "",
    component,
    severity: investigation.severity || (need.paid ? "medium" : "low"),
    solutionKind,
    need,
    problemStatement,
    affectedComponents: [component],
    proposedTool: {
      name: title,
      slug: slug(title),
      capability: solutionKind === "external_paid_tool"
        ? "Evaluate the paid external capability only after user approval."
        : "Analyze bounded PlutoMix evidence and return a deterministic improvement recommendation.",
      interface: "runtime/self-improvement generated-tool manifest",
      inputs: ["bounded runtime event", "investigation summary", "feature inventory references"],
      outputs: ["problem statement", "recommended solution target", "validation plan", "cost posture"]
    },
    buildPlan: [
      "Create an isolated generated-tool manifest under runtime/self-improvement/tools.",
      "Do not modify live source, generated projects, credentials, or deployment configuration.",
      "Run the tool only on bounded, redacted evidence.",
      "Feed tool output back into ImprovementProposal, validation, review, and rollback gates before platform code changes."
    ],
    usePlan: [
      "Use the generated tool to classify whether the solution belongs in the app, agent instruction/routing, or platform runtime.",
      "Prefer no-cost internal automation before paid external tooling.",
      "Require user approval before paid usage, subscription, GPU, cloud service, marketplace tool, or licensed dependency."
    ],
    costEstimate,
    monetaryApprovalRequired: costEstimate.approvalRequired && costEstimate.estimatedUsd > Number(config.monetaryApprovalThresholdUsd || 0),
    approvalPrompt: costEstimate.approvalRequired && costEstimate.estimatedUsd > Number(config.monetaryApprovalThresholdUsd || 0)
      ? `Approve estimated ${costEstimate.billingPeriod} spend of about $${costEstimate.estimatedUsd.toFixed(2)}, or ask PlutoMix to pursue a cheaper internal solution.`
      : "",
    cheaperAlternatives: [
      "Build a local deterministic analysis tool from existing logs and metrics.",
      "Reuse existing PlutoMix agents or route to a smaller model profile.",
      "Add instrumentation and caching before paying for an external service.",
      "Simplify the UI/workflow or split the agent task into smaller bounded steps."
    ],
    shouldTriggerImprovement: status === "ready_for_candidate" && Boolean(config.toolPlanAutoTrigger),
    safetyGates: [
      "Root AGENTS.md remains authoritative.",
      "No paid resource is used without monetary approval.",
      "No live source mutation occurs outside the proposal/candidate/validation/review/promotion pipeline.",
      "Generated-project workspaces are not modified by platform tool planning."
    ]
  };
}

export function createMonetaryApprovalRequest(toolPlan = {}) {
  return {
    id: createId("si_money"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    timestamp: nowIso(),
    status: "pending",
    source: "self-improvement-monetary-approval-gate",
    actor: "self-improvement-orchestrator",
    toolPlanId: toolPlan.id || "",
    eventId: toolPlan.eventId || "",
    component: toolPlan.component || "plutomix-runtime",
    solutionKind: toolPlan.solutionKind || "external_paid_tool",
    problemStatement: toolPlan.problemStatement || "",
    approvalPrompt: toolPlan.approvalPrompt || "Approve paid capability or request cheaper alternative.",
    costEstimate: toolPlan.costEstimate || {},
    cheaperAlternatives: toolPlan.cheaperAlternatives || [],
    decision: "pending",
    decidedAt: "",
    decidedBy: "",
    note: ""
  };
}

export function applyMonetaryDecision({ approval = {}, decision = "cheaper_solution", user = {}, note = "" } = {}) {
  const normalizedDecision = ["approve", "cheaper_solution", "reject"].includes(decision) ? decision : "cheaper_solution";
  return {
    ...approval,
    id: createId("si_money"),
    timestamp: nowIso(),
    status: normalizedDecision === "approve" ? "approved" : normalizedDecision === "reject" ? "rejected" : "cheaper_solution_requested",
    decision: normalizedDecision,
    decidedAt: nowIso(),
    decidedBy: user.email || user.id || "plutomix-admin",
    note: neutralizeLogInstruction(note || "", { maxLength: 280 })
  };
}

export async function buildGeneratedTool({ toolPlan = {}, store } = {}) {
  const toolId = createId("si_tool");
  const toolDir = path.join(store.paths.runtimeRoot, "tools", "generated", toolPlan.proposedTool?.slug || slug(toolPlan.id), toolId);
  const manifest = {
    id: toolId,
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    timestamp: nowIso(),
    status: "available",
    source: "self-improvement-autonomous-tool-builder",
    agentId: TOOL_BUILDER_AGENT_ID,
    toolPlanId: toolPlan.id,
    name: toolPlan.proposedTool?.name || "PlutoMix Generated Tool",
    slug: toolPlan.proposedTool?.slug || slug(toolPlan.proposedTool?.name || toolPlan.id),
    solutionKind: toolPlan.solutionKind,
    component: toolPlan.component,
    costEstimate: toolPlan.costEstimate,
    inputContract: toolPlan.proposedTool?.inputs || [],
    outputContract: toolPlan.proposedTool?.outputs || [],
    safetyGates: toolPlan.safetyGates || [],
    usage: "This generated tool is deterministic and may inspect only bounded runtime evidence."
  };
  const runner = [
    "export function run(input = {}) {",
    "  return {",
    `    toolId: ${JSON.stringify(toolId)},`,
    `    toolPlanId: ${JSON.stringify(toolPlan.id || "")},`,
    `    solutionKind: ${JSON.stringify(toolPlan.solutionKind || "internal_tool")},`,
    "    status: 'ok',",
    "    recommendation: 'Use this bounded tool output as evidence for the self-improvement proposal pipeline.',",
    "    inputSummary: {",
    "      eventType: input.event?.type || '',",
    "      component: input.investigation?.component || input.toolPlan?.component || '',",
    "      severity: input.investigation?.severity || input.toolPlan?.severity || 'low'",
    "    }",
    "  };",
    "}",
    ""
  ].join("\n");
  await fs.ensureDir(toolDir);
  await fs.writeJson(path.join(toolDir, "tool-manifest.json"), manifest, { spaces: 2 });
  await fs.writeFile(path.join(toolDir, "runner.mjs"), runner);
  return {
    ...manifest,
    manifestPath: path.join(toolDir, "tool-manifest.json"),
    runnerPath: path.join(toolDir, "runner.mjs")
  };
}

export function runGeneratedTool({ generatedTool = {}, event = {}, investigation = {}, toolPlan = {} } = {}) {
  return {
    id: createId("si_tool_run"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    timestamp: nowIso(),
    status: "completed",
    source: "self-improvement-generated-tool-runner",
    actor: TOOL_BUILDER_AGENT_ID,
    generatedToolId: generatedTool.id || "",
    toolPlanId: toolPlan.id || generatedTool.toolPlanId || "",
    eventId: event.id || "",
    component: toolPlan.component || investigation.component || "plutomix-runtime",
    output: {
      solutionTarget: toolPlan.solutionKind === "agent_or_ui_simplification" ? "app_or_agent" : toolPlan.solutionKind === "platform_optimization" ? "platform" : "tooling",
      recommendation: toolPlan.monetaryApprovalRequired
        ? "Wait for monetary approval before paid tool use."
        : "Proceed through ImprovementProposal, isolated candidate, validation, independent review, and promotion gates.",
      cheaperPathAvailable: Boolean(toolPlan.cheaperAlternatives?.length),
      evidenceSummary: neutralizeLogInstruction(event.message || investigation.problemStatement || toolPlan.problemStatement || "", { maxLength: 260 })
    }
  };
}
