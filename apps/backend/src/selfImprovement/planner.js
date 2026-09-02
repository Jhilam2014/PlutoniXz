import { SELF_IMPROVEMENT_SCHEMA_VERSION } from "./constants.js";
import { ImprovementProposalSchema } from "./contracts.js";
import { classifyRisk, proposalRejectionReasons } from "./policy.js";
import { createId, nowIso } from "./store.js";

function featureIdsFromEvidence(evidence = {}) {
  return [...new Set((evidence.featureDependencies || [])
    .filter((item) => /^[a-z0-9-]+$/.test(item))
    .filter((item) => !/^(GET|POST|DELETE|PUT|PATCH)$/i.test(item))
    .slice(0, 12))];
}

function instructionImpacts(affectedFiles = []) {
  return affectedFiles.filter((file) => /AGENTS\.md|\.codex\/prompts|\.claude\/prompts|\.github\/prompts|agents\/generated/i.test(file));
}

// A BrainX task is deliberately broader than a one-file change.  This is a
// planning contract, not permission to make speculative changes: each domain
// still has to produce evidence and pass the normal candidate/review gates.
function brainXAssessmentPlan(instruction = "") {
  const text = String(instruction || "").toLowerCase();
  const requestsResearch = /research|paper|novel|self.?improv|planner|approach/.test(text);
  return {
    proposedSolution: [
      "Analyze the reported problem before selecting a change.",
      "UI/UX: capture representative desktop and narrow-viewport snapshots, inspect accessibility and navigation paths, and cluster repeated return/edit/submit behavior as friction evidence.",
      "Backend: audit the affected API contract, runtime logs, and health evidence; reproduce and repair only a verified unhealthy endpoint.",
      "Economy: compare token, model-call, latency, and paid-tool cost against a bounded local or lower-cost alternative before choosing implementation.",
      requestsResearch
        ? "R&D: conduct bounded research-paper/technical evidence review only when the task has an unresolved self-improvement or planning question; record sources, alternatives, and why the selected approach fits PlutoMix."
        : "R&D: do not spend research budget unless an unresolved self-improvement or planning question requires external evidence."
    ].join(" "),
    testPlan: [
      "Capture and review representative UI snapshots at desktop and narrow viewport sizes; verify keyboard access, contrast, and the intended user path.",
      "Check the affected backend endpoint's response contract and health/runtime evidence; add a focused regression test for a verified failure.",
      "Compare the selected execution path with at least one lower-cost feasible alternative using model-call/token/cost estimates.",
      requestsResearch
        ? "When research is needed, record the problem statement, sources, alternatives, selected approach, expected benefit, and validation criteria within the configured research budget."
        : "Record why research was not required for this bounded task."
    ]
  };
}

export function createProposalFromAnalysis({ analysis, evidencePackage, existingProposals = [] } = {}) {
  const improvement = analysis.proposedImprovements[0];
  const now = nowIso();
  const affectedFiles = improvement?.affectedFiles || [];
  const affectedInstructions = instructionImpacts(affectedFiles);
  const riskLevel = classifyRisk({
    affectedFiles,
    affectedInstructions,
    apiSchemaImpact: "none",
    databaseImpact: "none",
    securityImpact: analysis.riskLevel === "high" || analysis.riskLevel === "critical" ? "review_required" : "none",
    proposedSolution: improvement?.title || evidencePackage.problemStatement
  });
  const proposalDraft = {
    id: createId("si_event"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    correlationId: evidencePackage.correlationId,
    source: "self-improvement-planner",
    timestamp: now,
    status: analysis.shouldProceed ? "proposed" : "rejected",
    evidenceRefs: [analysis.id, evidencePackage.id, ...(evidencePackage.evidenceRefs || [])],
    actor: "self-improvement-planner",
    modelProfile: analysis.modelProfile || "",
    proposalId: createId("si_prop"),
    title: improvement?.title || "Observe PlutoMix issue until evidence is sufficient",
    category: improvement?.category || "observability",
    problem: evidencePackage.problemStatement,
    evidence: evidencePackage.boundedLogExcerpts.map((item) => item.evidenceRef),
    rootCause: analysis.rootCauseHypotheses[0]?.hypothesis || "Root cause unknown; more evidence required.",
    proposedSolution: analysis.shouldProceed
      ? "Create an isolated candidate that addresses the detected root cause, preserves all baseline features/API routes, and adds or updates tests before promotion."
      : "Continue observing until the pattern has enough evidence.",
    measurableObjective: analysis.shouldProceed
      ? "Reduce recurrence of the detected pattern without reducing feature inventory, API inventory, provider compatibility, or critical workflow availability."
      : "",
    expectedBenefit: improvement?.expectedBenefit || analysis.expectedBenefit || "Improve PlutoMix reliability.",
    riskLevel,
    affectedFeatures: featureIdsFromEvidence(evidencePackage),
    affectedFiles,
    affectedAgents: affectedFiles.some((file) => /projectAgents|plutomixAuthority|agents\//i.test(file))
      ? ["plutomix-fullstack-agent", "project-execution-agent"]
      : [],
    affectedInstructions,
    apiSchemaImpact: affectedFiles.some((file) => /server\.js|controller/i.test(file)) ? "possible_route_behavior_impact" : "none",
    databaseImpact: affectedFiles.some((file) => /database|migration/i.test(file)) ? "possible_database_impact" : "none",
    securityImpact: riskLevel === "high" || riskLevel === "critical" ? "manual_review_required_for_sensitive_component" : "none",
    compatibilityImpact: "preserve_existing_contracts; no feature removal permitted without replacement and rollback proof",
    testPlan: analysis.validationPlan || [],
    benchmarkPlan: [
      "Compare pattern recurrence count before and after candidate.",
      "Compare runtime error rate, test pass rate, and tokens per successful task where data exists."
    ],
    rollbackPlan: analysis.rollbackPlan || [],
    costEstimate: {
      modelCalls: evidencePackage.tokenAndCostBudget.maxModelCalls,
      maxTokens: evidencePackage.tokenAndCostBudget.maxTokens,
      estimatedUsd: evidencePackage.tokenAndCostBudget.maxEstimatedUsd
    },
    tokenBudget: evidencePackage.tokenAndCostBudget.maxTokens,
    parentProposalId: "",
    rejectionReasons: [],
    timestamps: {
      createdAt: now,
      updatedAt: now
    }
  };
  const rejectionReasons = proposalRejectionReasons(proposalDraft, existingProposals);
  return ImprovementProposalSchema.parse({
    ...proposalDraft,
    status: rejectionReasons.length ? "rejected" : proposalDraft.status,
    rejectionReasons
  });
}

export function createSystemInstructionProposal({ instruction = "", taskType = "Medium", evidencePackage, existingProposals = [] } = {}) {
  const now = nowIso();
  const normalizedTaskType = String(taskType || "Medium").toLowerCase();
  const riskLevel = /auth|credential|secret|deploy|database|migration|AGENTS\.md|remove|delete/i.test(instruction)
    ? "high"
    : /large|hard|complex/.test(normalizedTaskType)
      ? "medium"
      : "low";
  const assessment = brainXAssessmentPlan(instruction);
  const proposalDraft = {
    id: createId("si_event"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    correlationId: evidencePackage.correlationId,
    source: "gotham-system-target-planner",
    timestamp: now,
    status: "proposed",
    evidenceRefs: [evidencePackage.id, ...(evidencePackage.evidenceRefs || [])],
    actor: "self-improvement-planner",
    modelProfile: "",
    proposalId: createId("si_prop"),
    title: `System improvement proposal: ${instruction.replace(/\s+/g, " ").slice(0, 90)}`,
    category: "developer_experience",
    problem: instruction,
    evidence: evidencePackage.evidenceRefs || [],
    rootCause: "Manual Gotham system-target request requires platform improvement investigation before implementation.",
    proposedSolution: `${assessment.proposedSolution} Implement only a selected, evidence-backed change in an isolated candidate workspace; validate it, require independent review, then apply promotion policy.`,
    measurableObjective: "Complete the requested platform improvement without modifying generated project workspaces and without regressing inventoried PlutoMix features.",
    expectedBenefit: "Allows direct platform improvement conversations while preserving project-target isolation.",
    riskLevel,
    affectedFeatures: ["gotham-chat-project-generation"],
    affectedFiles: ["apps/backend/src/server.js", "apps/frontend/src/App.jsx"],
    affectedAgents: ["plutomix-fullstack-agent"],
    affectedInstructions: [],
    apiSchemaImpact: "additive_system_target_payload",
    databaseImpact: "none",
    securityImpact: riskLevel === "high" ? "manual_review_required_for_sensitive_instruction" : "none",
    compatibilityImpact: "preserve_existing_project_target_behavior; no generated project workspace writes from system target",
    testPlan: [
      "Verify Gotham project target payload still sends projectId and not system target.",
      "Verify Gotham system target payload sends target.type=system and no projectId.",
      "Verify backend creates proposal before candidate work.",
      "Verify feature inventory preservation gate blocks removal.",
      ...assessment.testPlan
    ],
    benchmarkPlan: ["Compare project target success behavior before and after system target addition."],
    rollbackPlan: ["Disable system target with SELF_IMPROVEMENT_ENABLED=0 or revert additive UI/API changes.", "Keep generated project registry untouched."],
    costEstimate: {
      modelCalls: 0,
      maxTokens: 3000,
      estimatedUsd: 0
    },
    tokenBudget: 3000,
    parentProposalId: "",
    rejectionReasons: [],
    timestamps: {
      createdAt: now,
      updatedAt: now
    }
  };
  const rejectionReasons = proposalRejectionReasons(proposalDraft, existingProposals);
  return ImprovementProposalSchema.parse({
    ...proposalDraft,
    status: rejectionReasons.length ? "rejected" : "proposed",
    rejectionReasons
  });
}
