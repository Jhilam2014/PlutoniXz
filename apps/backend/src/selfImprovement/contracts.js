import { z } from "zod";
import { AUTONOMY_MODES, IMPROVEMENT_CATEGORIES, SELF_IMPROVEMENT_SCHEMA_VERSION } from "./constants.js";

const severitySchema = z.enum(["info", "low", "medium", "high", "critical"]);
const statusSchema = z.enum(["new", "observed", "aggregated", "triggered", "analyzed", "proposed", "candidate", "validated", "reviewed", "promoted", "rolled_back", "rejected", "skipped", "failed"]);
const riskSchema = z.enum(["none", "low", "medium", "high", "critical"]);
const categorySchema = z.enum(IMPROVEMENT_CATEGORIES);

const eventBase = z.object({
  id: z.string().min(6),
  schemaVersion: z.literal(SELF_IMPROVEMENT_SCHEMA_VERSION),
  correlationId: z.string().min(4),
  source: z.string().min(1),
  timestamp: z.string().min(10),
  status: statusSchema,
  evidenceRefs: z.array(z.string()).default([]),
  actor: z.string().default("plutonix-self-improvement"),
  modelProfile: z.string().default("")
}).strict();

export const ImprovementSignalSchema = eventBase.extend({
  kind: z.string().min(1),
  severity: severitySchema,
  component: z.string().min(1),
  target: z.object({
    type: z.enum(["system", "project", "agent", "instruction", "api", "ui", "runtime", "unknown"]),
    id: z.string().default("")
  }).strict(),
  message: z.string().default(""),
  fingerprint: z.string().min(8),
  metadata: z.record(z.any()).default({})
}).strict();

export const SignalPatternSchema = eventBase.extend({
  patternKey: z.string().min(8),
  kind: z.string().min(1),
  severity: severitySchema,
  components: z.array(z.string()).default([]),
  signalIds: z.array(z.string()).default([]),
  signalCount: z.number().int().nonnegative(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  confidence: z.number().min(0).max(1),
  duplicateOf: z.string().default(""),
  trend: z.enum(["new", "stable", "increasing", "decreasing", "regression"]).default("new"),
  summary: z.string().default("")
}).strict();

export const ImprovementTriggerSchema = eventBase.extend({
  patternKey: z.string().default(""),
  triggerReason: z.string().min(1),
  severity: severitySchema,
  affectedComponents: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  expectedImpact: z.string().default(""),
  estimatedInvestigationCost: z.object({
    modelCalls: z.number().int().nonnegative(),
    maxTokens: z.number().int().nonnegative(),
    estimatedUsd: z.number().nonnegative()
  }).strict(),
  manual: z.boolean().default(false)
}).strict();

export const EvidencePackageSchema = eventBase.extend({
  triggerId: z.string().min(1),
  problemStatement: z.string().min(1),
  boundedLogExcerpts: z.array(z.object({
    source: z.string(),
    excerpt: z.string(),
    timestamp: z.string().default(""),
    evidenceRef: z.string()
  }).strict()).default([]),
  aggregatedMetrics: z.record(z.any()).default({}),
  reproductionInfo: z.string().default(""),
  currentImplementationSummary: z.string().default(""),
  applicableInstructions: z.array(z.string()).default([]),
  featureDependencies: z.array(z.string()).default([]),
  recentRelatedChanges: z.array(z.string()).default([]),
  previousAttemptedImprovements: z.array(z.string()).default([]),
  rollbackHistory: z.array(z.string()).default([]),
  securityConstraints: z.array(z.string()).default([]),
  compatibilityRequirements: z.array(z.string()).default([]),
  tokenAndCostBudget: z.object({
    maxModelCalls: z.number().int().nonnegative(),
    maxTokens: z.number().int().nonnegative(),
    maxEstimatedUsd: z.number().nonnegative()
  }).strict(),
  evidenceHash: z.string().min(12)
}).strict();

export const ImprovementAnalysisSchema = eventBase.extend({
  evidencePackageId: z.string().min(1),
  rootCauseHypotheses: z.array(z.object({
    hypothesis: z.string(),
    supportingEvidence: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1)
  }).strict()).default([]),
  missingEvidence: z.array(z.string()).default([]),
  proposedImprovements: z.array(z.object({
    title: z.string(),
    category: categorySchema,
    affectedFiles: z.array(z.string()).default([]),
    expectedBenefit: z.string(),
    riskLevel: riskSchema
  }).strict()).default([]),
  riskLevel: riskSchema,
  expectedBenefit: z.string().default(""),
  validationPlan: z.array(z.string()).default([]),
  rollbackPlan: z.array(z.string()).default([]),
  shouldProceed: z.boolean(),
  confidenceScore: z.number().min(0).max(1),
  alternativeStrategies: z.array(z.string()).default([]),
  modelCall: z.object({
    status: z.enum(["not_required", "skipped", "completed", "failed"]),
    reason: z.string().default(""),
    profile: z.string().default("")
  }).strict()
}).strict();

export const ImprovementProposalSchema = eventBase.extend({
  proposalId: z.string().min(6),
  title: z.string().min(4),
  category: categorySchema,
  problem: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  rootCause: z.string().min(1),
  proposedSolution: z.string().min(1),
  measurableObjective: z.string().min(1),
  expectedBenefit: z.string().min(1),
  riskLevel: riskSchema,
  affectedFeatures: z.array(z.string()).default([]),
  affectedFiles: z.array(z.string()).default([]),
  affectedAgents: z.array(z.string()).default([]),
  affectedInstructions: z.array(z.string()).default([]),
  apiSchemaImpact: z.string().default("none"),
  databaseImpact: z.string().default("none"),
  securityImpact: z.string().default("none"),
  compatibilityImpact: z.string().default("preserve_existing_contracts"),
  testPlan: z.array(z.string()).default([]),
  benchmarkPlan: z.array(z.string()).default([]),
  rollbackPlan: z.array(z.string()).default([]),
  costEstimate: z.object({
    modelCalls: z.number().int().nonnegative(),
    maxTokens: z.number().int().nonnegative(),
    estimatedUsd: z.number().nonnegative()
  }).strict(),
  tokenBudget: z.number().int().nonnegative(),
  parentProposalId: z.string().default(""),
  rejectionReasons: z.array(z.string()).default([]),
  timestamps: z.object({
    createdAt: z.string(),
    updatedAt: z.string()
  }).strict()
}).strict();

export const CandidateChangeSetSchema = eventBase.extend({
  proposalId: z.string().min(1),
  candidateId: z.string().min(6),
  isolationType: z.enum(["git_worktree", "git_branch", "temporary_workspace", "patch_plan_only"]),
  workspacePath: z.string().default(""),
  changedFiles: z.array(z.string()).default([]),
  rollbackArtifactPath: z.string().default(""),
  statusReason: z.string().default("")
}).strict();

export const ValidationRunSchema = eventBase.extend({
  proposalId: z.string().min(1),
  candidateId: z.string().default(""),
  checks: z.array(z.object({
    name: z.string(),
    status: z.enum(["passed", "failed", "skipped"]),
    detail: z.string().default("")
  }).strict()).default([]),
  featurePreservation: z.object({
    status: z.enum(["passed", "failed", "skipped"]),
    missingCriticalFeatures: z.array(z.string()).default([]),
    detail: z.string().default("")
  }).strict(),
  benchmarkComparison: z.record(z.any()).default({}),
  overallStatus: z.enum(["passed", "failed", "skipped"])
}).strict();

export const ReviewDecisionSchema = eventBase.extend({
  proposalId: z.string().min(1),
  reviewerAgent: z.string().min(1),
  authorAgent: z.string().min(1),
  reviewerIndependent: z.boolean(),
  decision: z.enum(["approved", "rejected", "needs_revision", "blocked"]),
  reasons: z.array(z.string()).default([]),
  securityNotes: z.array(z.string()).default([]),
  testAdequacy: z.enum(["adequate", "inadequate", "not_applicable"])
}).strict();

export const PromotionDecisionSchema = eventBase.extend({
  proposalId: z.string().min(1),
  decision: z.enum(["promote", "stage", "reject"]),
  reasons: z.array(z.string()).default([]),
  autonomyMode: z.enum(AUTONOMY_MODES),
  rollbackArtifactPath: z.string().default("")
}).strict();

export const RollbackEventSchema = eventBase.extend({
  proposalId: z.string().min(1),
  rollbackReason: z.string().min(1),
  rollbackArtifactPath: z.string().default(""),
  statusDetail: z.string().default("")
}).strict();

export const InstructionChangeSetSchema = eventBase.extend({
  proposalId: z.string().min(1),
  instructionPath: z.string().min(1),
  previousVersionRef: z.string().min(1),
  candidateVersionRef: z.string().min(1),
  semanticDiff: z.array(z.string()).default([]),
  capabilitiesAdded: z.array(z.string()).default([]),
  capabilitiesChanged: z.array(z.string()).default([]),
  capabilitiesRemoved: z.array(z.string()).default([]),
  removalReasons: z.array(z.string()).default([]),
  evaluationResults: z.record(z.any()).default({}),
  reviewerDecision: z.string().default("pending"),
  rollbackVersionRef: z.string().min(1)
}).strict();

export function validateContract(schema, value) {
  return schema.parse(value);
}
