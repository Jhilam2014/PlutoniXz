import { z } from "zod";

export const INTEL_PROFILE_SCHEMA_VERSION = "1.0";
export const DEFAULT_INTEL_SCORE_THRESHOLD = 72;

const roleSchema = z.string().regex(/^[a-z][a-z0-9-]{2,80}$/);
const scoringDimensionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{2,80}$/),
  label: z.string().min(3).max(120),
  weight: z.number().int().min(1).max(100)
});

export const ProjectTypeProfileSchema = z.object({
  schemaVersion: z.literal(INTEL_PROFILE_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z][a-z0-9-]{2,80}$/),
  displayName: z.string().min(3).max(120),
  status: z.enum(["supported", "experimental", "unsupported"]),
  detection: z.object({
    artifactTypes: z.array(z.string().min(1)).min(1),
    filePatterns: z.array(z.string()),
    manifestPatterns: z.array(z.string()),
    instructionSignals: z.array(z.string()),
    confidenceThreshold: z.number().int().min(1).max(100)
  }),
  capabilities: z.object({
    canCreate: z.boolean(),
    canModify: z.boolean(),
    canPreview: z.boolean(),
    canValidate: z.boolean(),
    canDeploy: z.boolean()
  }),
  availableRoles: z.array(roleSchema).min(4),
  defaultRoles: z.array(roleSchema).min(4),
  scoringDimensions: z.array(scoringDimensionSchema).min(1),
  requiredEvidence: z.array(z.string().min(3)).min(1),
  validationPipeline: z.array(z.object({ id: z.string().min(3), label: z.string().min(3), required: z.boolean() })).min(1),
  completionCriteria: z.array(z.string().min(3)).min(1),
  executionAdapter: z.string().min(3),
  previewAdapter: z.enum(["browser", "api-contract", "artifact", "none"]),
  artifactAdapter: z.string().min(3).optional(),
  limits: z.object({
    maximumAgents: z.number().int().min(1).max(12),
    maximumParallelReaders: z.number().int().min(1).max(3),
    maximumWriters: z.literal(1),
    maximumRepairCycles: z.literal(1),
    workflowTimeoutMs: z.number().int().min(10_000),
    agentTimeoutMs: z.number().int().min(5_000)
  })
}).superRefine((profile, context) => {
  const total = profile.scoringDimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (total !== 100) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Profile scoring dimensions must total 100." });
  }
  for (const role of profile.defaultRoles) {
    if (!profile.availableRoles.includes(role)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Default role ${role} is not available.` });
    }
  }
});

const genericScoring = [
  { id: "objective-fit", label: "User objective fit", weight: 30 },
  { id: "workflow-completeness", label: "Workflow completeness", weight: 20 },
  { id: "user-value", label: "User value", weight: 15 },
  { id: "technical-feasibility", label: "Technical or production feasibility", weight: 15 },
  { id: "evidence-quality", label: "Evidence quality", weight: 10 },
  { id: "scope-risk-fit", label: "Scope and risk fit", weight: 10 }
];

function profile({ id, displayName, status = "unsupported", artifactTypes, signals = [], roles = [], scoringDimensions = genericScoring, previewAdapter = "none", artifactAdapter, validationPipeline = [], requiredEvidence = ["instruction", "profile-selection"], capabilities = {} }) {
  const defaultRoles = ["intel-planner", "project-inspector", "requirements-analyst", ...roles, "implementation-agent", "verification-agent"];
  return {
    schemaVersion: INTEL_PROFILE_SCHEMA_VERSION,
    id,
    displayName,
    status,
    detection: {
      artifactTypes,
      filePatterns: [],
      manifestPatterns: [],
      instructionSignals: signals,
      confidenceThreshold: 72
    },
    capabilities: {
      canCreate: status === "supported",
      canModify: status === "supported",
      canPreview: previewAdapter !== "none",
      canValidate: status === "supported",
      canDeploy: false,
      ...capabilities
    },
    availableRoles: [...new Set([...defaultRoles, "repair-agent"])],
    defaultRoles,
    scoringDimensions,
    requiredEvidence,
    validationPipeline: validationPipeline.length ? validationPipeline : [{ id: "capability-unavailable", label: "Capability is not implemented for this profile", required: true }],
    completionCriteria: status === "supported"
      ? ["A profile-appropriate output changed inside the selected workspace.", "Required validation evidence passed.", "An independent verifier returned a passing verdict."]
      : ["Do not run implementation without a supported profile adapter."],
    executionAdapter: status === "supported" ? "codex-cli" : "unavailable",
    previewAdapter,
    ...(artifactAdapter ? { artifactAdapter } : {}),
    limits: {
      maximumAgents: 8,
      maximumParallelReaders: 3,
      maximumWriters: 1,
      maximumRepairCycles: 1,
      workflowTimeoutMs: 15 * 60 * 1000,
      agentTimeoutMs: 5 * 60 * 1000
    }
  };
}

const supportedProfiles = [
  profile({
    id: "web-application",
    displayName: "Web application",
    status: "supported",
    artifactTypes: ["web_application", "website", "existing_project"],
    signals: ["web app", "web application", "website", "frontend", "dashboard", "react", "ui", "browser"],
    roles: ["ui-ux-explorer", "accessibility-reviewer", "frontend-technical-explorer", "backend-technical-explorer"],
    scoringDimensions: [
      { id: "user-journey-fit", label: "User journey fit", weight: 30 },
      { id: "workflow-completeness", label: "Workflow completeness", weight: 20 },
      { id: "accessibility-responsiveness", label: "Accessibility and responsiveness", weight: 15 },
      { id: "technical-feasibility", label: "Technical feasibility", weight: 15 },
      { id: "evidence-quality", label: "Evidence quality", weight: 10 },
      { id: "scope-risk-fit", label: "Scope and risk fit", weight: 10 }
    ],
    previewAdapter: "browser",
    validationPipeline: [
      { id: "project-commands", label: "Detect and run applicable project lint, test, type-check, and build commands", required: true },
      { id: "ui-contract", label: "Check user journeys, responsive states, and accessible feedback", required: true }
    ],
    requiredEvidence: ["instruction", "product-shape", "workspace-inspection", "user-journey" ]
  }),
  profile({
    id: "api-service",
    displayName: "API service",
    status: "supported",
    artifactTypes: ["api_service"],
    signals: ["api", "openapi", "swagger", "rest", "graphql", "webhook", "backend service"],
    roles: ["api-contract-analyst", "data-model-reviewer", "integration-security-reviewer"],
    scoringDimensions: [
      { id: "contract-correctness", label: "Contract correctness", weight: 30 },
      { id: "security-compatibility", label: "Security and compatibility", weight: 20 },
      { id: "testability", label: "Testability", weight: 15 },
      { id: "technical-feasibility", label: "Technical feasibility", weight: 15 },
      { id: "evidence-quality", label: "Evidence quality", weight: 10 },
      { id: "scope-risk-fit", label: "Scope and risk fit", weight: 10 }
    ],
    previewAdapter: "api-contract",
    validationPipeline: [
      { id: "contract", label: "Validate request and response contract evidence", required: true },
      { id: "service-tests", label: "Run applicable API tests or startup validation", required: true }
    ],
    requiredEvidence: ["instruction", "product-shape", "api-contract", "workspace-inspection"]
  }),
  profile({
    id: "document-pdf",
    displayName: "Document or PDF",
    status: "supported",
    artifactTypes: ["document", "flyer"],
    signals: ["pdf", "document", "report", "invoice", "docx", "brochure"],
    roles: ["content-structure-analyst", "document-layout-specialist", "citation-source-reviewer", "document-render-verifier"],
    scoringDimensions: [
      { id: "content-accuracy", label: "Content accuracy", weight: 30 },
      { id: "structure", label: "Document structure", weight: 20 },
      { id: "rendered-layout", label: "Rendered layout", weight: 15 },
      { id: "citation-evidence", label: "Citation and evidence quality", weight: 15 },
      { id: "scope-risk-fit", label: "Scope and risk fit", weight: 10 },
      { id: "artifact-feasibility", label: "Artifact feasibility", weight: 10 }
    ],
    previewAdapter: "artifact",
    artifactAdapter: "document-artifact",
    validationPipeline: [
      { id: "document-output", label: "Verify a real PDF or DOCX deliverable", required: true },
      { id: "render-inspection", label: "Inspect rendered output for clipping, blank pages, overflow, and unreadable text", required: true }
    ],
    requiredEvidence: ["instruction", "product-shape", "document-outline", "rendered-artifact"]
  }),
  profile({
    id: "spreadsheet",
    displayName: "Spreadsheet",
    status: "supported",
    artifactTypes: ["spreadsheet"],
    signals: ["spreadsheet", "excel", "workbook", "xlsx", "formula", "csv"],
    roles: ["data-quality-analyst", "formula-modeling-specialist", "workbook-layout-specialist", "workbook-calculation-verifier"],
    scoringDimensions: [
      { id: "formula-correctness", label: "Formula correctness", weight: 30 },
      { id: "data-integrity", label: "Data integrity", weight: 20 },
      { id: "auditability", label: "Auditability", weight: 15 },
      { id: "workbook-usability", label: "Workbook usability", weight: 15 },
      { id: "evidence-quality", label: "Evidence quality", weight: 10 },
      { id: "scope-risk-fit", label: "Scope and risk fit", weight: 10 }
    ],
    previewAdapter: "artifact",
    artifactAdapter: "spreadsheet-artifact",
    validationPipeline: [
      { id: "workbook-output", label: "Verify a real XLSX workbook output", required: true },
      { id: "formula-reference-check", label: "Check formulas, ranges, sheet references, data types, and formula errors", required: true },
      { id: "workbook-preview", label: "Inspect the workbook preview", required: true }
    ],
    requiredEvidence: ["instruction", "product-shape", "workbook-model", "formula-validation"]
  })
];

const unsupportedProfiles = [
  ["mobile-application", "Mobile application", ["mobile_application"], ["mobile", "mobile application", "ios", "android", "react native", "flutter"]],
  ["desktop-application", "Desktop application", ["desktop_application"], ["desktop", "electron", "tauri"]],
  ["browser-extension", "Browser extension", ["browser_extension"], ["browser extension", "chrome extension"]],
  ["data-ml-project", "Data and ML project", ["data_workflow", "ml_project"], ["machine learning", "model training", "data pipeline"]],
  ["notebook-project", "Notebook project", ["notebook"], ["notebook", "jupyter", "ipynb"]],
  ["presentation", "Presentation", ["presentation"], ["presentation", "slide deck", "pptx"]],
  ["infrastructure", "Infrastructure", ["infrastructure"], ["terraform", "kubernetes", "infrastructure"]],
  ["game", "Game", ["game"], ["game", "unity", "unreal"]],
  ["audio-project", "Audio project", ["audio"], ["audio", "podcast", "voiceover"]],
  ["video-project", "Video project", ["video"], ["video", "video", "animation"]],
  ["generic-codebase", "Generic codebase", ["automation", "unspecified_digital_output"], ["codebase", "repository", "script"]]
].map(([id, displayName, artifactTypes, signals]) => profile({ id, displayName, artifactTypes, signals, status: "unsupported" }));

export const intelProfileRegistry = Object.freeze([...supportedProfiles, ...unsupportedProfiles].map((entry) => Object.freeze(entry)));

export function validateIntelProfileRegistry(registry = intelProfileRegistry) {
  const ids = new Set();
  const profiles = [];
  for (const candidate of registry) {
    const parsed = ProjectTypeProfileSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(`Invalid Intel profile ${candidate?.id || "unknown"}: ${parsed.error.issues.map((issue) => issue.message).join(" ")}`);
    }
    if (ids.has(parsed.data.id)) throw new Error(`Duplicate Intel profile id: ${parsed.data.id}`);
    ids.add(parsed.data.id);
    profiles.push(parsed.data);
  }
  return profiles;
}

const validProfiles = validateIntelProfileRegistry();

export function getIntelProfile(profileId, registry = validProfiles) {
  return registry.find((profile) => profile.id === profileId) || null;
}

function countSignalMatches(text, signals = []) {
  const lower = String(text || "").toLowerCase();
  return signals.reduce((total, signal) => {
    const normalized = String(signal).toLowerCase();
    const matched = normalized.includes(" ")
      ? lower.includes(normalized)
      : new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower);
    return total + (matched ? 1 : 0);
  }, 0);
}

function profileScore(profile, { instruction = "", productDecision = {}, existingProjectMetadata = {}, explicitProfileId = "" } = {}) {
  if (explicitProfileId === profile.id) return { score: 100, signalMatches: 0, source: "explicit", reasons: ["The user explicitly selected this project type profile."] };
  const artifactType = existingProjectMetadata?.artifactType || existingProjectMetadata?.productDecision?.artifactType || productDecision?.artifactType || "";
  const explicitSignals = countSignalMatches(instruction, profile.detection.instructionSignals);
  const artifactMatch = profile.detection.artifactTypes.includes(artifactType);
  const existingMatch = Boolean(existingProjectMetadata && Object.keys(existingProjectMetadata).length && artifactMatch);
  let score = artifactMatch ? 62 : 0;
  score += Math.min(18, explicitSignals * 6);
  if (existingMatch) score += 16;
  if (profile.id === "web-application" && existingProjectMetadata?.hasBrowserRuntime) score += 8;
  if (profile.id === "api-service" && existingProjectMetadata?.hasBackendInterface) score += 12;
  return {
    score: Math.min(99, score),
    signalMatches: explicitSignals,
    source: existingMatch ? "existing-project" : "detected",
    reasons: [
      artifactMatch ? `Product Shape selected ${artifactType}.` : "",
      explicitSignals ? `Instruction matched ${explicitSignals} profile signal${explicitSignals === 1 ? "" : "s"}.` : "",
      existingMatch ? "Existing project metadata matched this profile." : ""
    ].filter(Boolean)
  };
}

export function selectIntelProfile({ instruction = "", productDecision = {}, existingProjectMetadata = {}, explicitProfileId = "", registry = validProfiles } = {}) {
  if (explicitProfileId && !getIntelProfile(explicitProfileId, registry)) {
    return {
      status: "unsupported",
      profileId: explicitProfileId,
      confidence: 0,
      reasons: ["The requested Intel profile is not registered."],
      alternatives: [],
      source: "explicit",
      requiresUserConfirmation: false,
      failureReason: "unknown_profile"
    };
  }
  const candidates = registry
    .map((profile) => ({ profile, ...profileScore(profile, { instruction, productDecision, existingProjectMetadata, explicitProfileId }) }))
    .sort((left, right) => right.score - left.score || left.profile.id.localeCompare(right.profile.id));
  const explicitNonWeb = candidates.find((candidate) =>
    candidate.profile.id !== "web-application" &&
    candidate.signalMatches >= 2 &&
    ["web_application", "website", "unspecified_digital_output"].includes(productDecision?.artifactType || "")
  );
  const winner = explicitNonWeb || candidates[0];
  const alternatives = candidates.filter((candidate) => candidate.profile.id !== winner.profile.id).slice(0, 3).filter((candidate) => candidate.score > 0).map((candidate) => ({ profileId: candidate.profile.id, confidence: candidate.score }));
  const explicitlyConflictingProfiles = candidates.filter((candidate) => candidate.profile.status === "supported" && candidate.signalMatches >= 2);
  const materialAmbiguity =
    (alternatives[0] && winner.score >= 45 && winner.score - alternatives[0].confidence < 12) ||
    explicitlyConflictingProfiles.length > 1;
  const explicitUnsupportedProfile = Boolean(explicitNonWeb && winner?.profile?.status !== "supported");
  const noReliableMatch = !winner || (!explicitUnsupportedProfile && winner.score < (winner?.profile?.detection?.confidenceThreshold || 72));
  if (materialAmbiguity || noReliableMatch) {
    return {
      status: "needs_clarification",
      profileId: winner?.profile?.id || "",
      confidence: winner?.score || 0,
      reasons: [...(winner?.reasons || []), materialAmbiguity ? "The leading profile is materially ambiguous." : "No profile met its confidence threshold."],
      alternatives,
      source: winner?.source || "detected",
      requiresUserConfirmation: true,
      clarification: "Please confirm the intended output type so Intel can use the correct execution, validation, and Playground adapter."
    };
  }
  const status = winner.profile.status === "supported" ? "selected" : "unsupported";
  return {
    status,
    profileId: winner.profile.id,
    profile: winner.profile,
    confidence: winner.score,
    reasons: winner.reasons,
    alternatives,
    source: winner.source,
    requiresUserConfirmation: false,
    ...(status === "unsupported" ? { failureReason: `${winner.profile.displayName} is ${winner.profile.status}; its execution and validation adapters are not available.` } : {})
  };
}

export function intelProfileSummary(selection = {}) {
  const profile = selection.profile || getIntelProfile(selection.profileId);
  return profile
    ? { id: profile.id, displayName: profile.displayName, status: profile.status, previewAdapter: profile.previewAdapter, executionAdapter: profile.executionAdapter }
    : { id: selection.profileId || "unknown", displayName: "Unknown", status: "unsupported", previewAdapter: "none", executionAdapter: "unavailable" };
}

export function profileArtifactValidation(profile, changedFiles = []) {
  const files = changedFiles.map((file) => String(file || "").replaceAll("\\", "/").toLowerCase());
  const some = (pattern) => files.some((file) => pattern.test(file));
  const checks = {
    "web-application": [{ id: "application-source", passed: some(/(^|\/)(src|app|frontend)(\/|\.|$)/), detail: "Application source changed." }],
    "api-service": [{ id: "service-contract", passed: some(/(^|\/)(api|backend|openapi|server)(\/|\.|$)/), detail: "API, backend, server, or contract evidence changed." }],
    "document-pdf": [{ id: "document-output", passed: some(/\.(pdf|docx)$/), detail: "A PDF or DOCX deliverable changed." }],
    spreadsheet: [{ id: "workbook-output", passed: some(/\.xlsx$/), detail: "A real XLSX workbook changed." }]
  }[profile?.id] || [{ id: "unsupported-profile", passed: false, detail: "No validation adapter exists for this profile." }];
  return {
    status: checks.every((check) => check.passed) ? "passed" : "failed",
    profileId: profile?.id || "",
    checks
  };
}
