const TASK_TYPES = new Set(["Simple", "Medium", "Hard"]);

const actionPatterns = [
  /\b(add|create|build|implement|introduce)\b/gi,
  /\b(update|change|modify|rename|adjust)\b/gi,
  /\b(fix|debug|repair|resolve)\b/gi,
  /\b(remove|delete|drop|migrate|deploy|refactor)\b/gi
];

const boundaryRules = [
  ["frontend", /\b(frontend|ui|component|page|css|react|view)\b/i],
  ["backend", /\b(backend|server|service|controller)\b/i],
  ["api", /\b(api|endpoint|route|openapi|swagger)\b/i],
  ["database", /\b(database|schema|migration|table|query|repository)\b/i],
  ["worker", /\b(worker|queue|background job|scheduler)\b/i],
  ["infrastructure", /\b(docker|container|deployment|infrastructure|ci\/?cd|kubernetes)\b/i]
];

const mandatoryEscalations = [
  ["security_sensitive", /\b(authentication|authorization|auth|rbac|permission|security)\b/i],
  ["credential_sensitive", /\b(secret|credential|api key|private key|token rotation)\b/i],
  ["financial_sensitive", /\b(payment|billing|invoice|subscription)\b/i],
  ["destructive_data_change", /\b(delete data|data deletion|drop table|destructive migration)\b/i],
  ["production_change", /\b(production deploy|deploy to production|release to production)\b/i]
];

function normalizeOverride(value) {
  const normalized = String(value || "Auto").trim().toLowerCase();
  if (!normalized || normalized === "auto") return "Auto";
  if (["simple", "small", "tiny"].includes(normalized)) return "Simple";
  if (["hard", "large", "complex"].includes(normalized)) return "Hard";
  if (normalized === "medium") return "Medium";
  return "Auto";
}

function actionCount(instruction) {
  const matches = actionPatterns.flatMap((pattern) => String(instruction || "").match(pattern) || []);
  return Math.max(1, new Set(matches.map((item) => item.toLowerCase())).size);
}

function inferredArtifactType(instruction, productDecision) {
  if (productDecision?.artifactType) return productDecision.artifactType;
  const text = String(instruction || "").toLowerCase();
  if (/\b(pdf|document|docx)\b/.test(text)) return /\bpdf\b/.test(text) ? "pdf" : "document";
  if (/\b(spreadsheet|workbook|xlsx|csv)\b/.test(text)) return "spreadsheet";
  if (/\b(mobile|ios|android|react native|flutter)\b/.test(text)) return "mobile";
  if (/\b(api|endpoint|service)\b/.test(text)) return "api_service";
  if (/\b(image|flyer|poster|banner|audio|video)\b/.test(text)) return "image_media";
  if (/\b(model|machine learning|rag|vector|embedding)\b/.test(text)) return "ml_ai";
  return "web_application";
}

export function classifyGothamTask({
  instruction = "",
  requestedTaskType = "Auto",
  project = null,
  workflowMode = "executor",
  productDecision = null,
  inputSources = []
} = {}) {
  const override = normalizeOverride(requestedTaskType);
  const text = String(instruction || "");
  const actions = actionCount(text);
  const affectedBoundaries = boundaryRules.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
  const escalationReasons = mandatoryEscalations.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
  const architectureChange = /\b(architecture|new subsystem|major refactor|cross[- ]service|platform[- ]wide)\b/i.test(text);
  const lifecycle = project && !project.isDefault ? "runtime-development" : "project-init";
  const suppliedInputBreadth = Array.isArray(inputSources) ? inputSources.length : 0;
  let score = 0;
  const reasonCodes = [];

  if (actions >= 2) { score += 1; reasonCodes.push("multiple_requested_actions"); }
  if (actions >= 4) { score += 1; reasonCodes.push("many_requested_actions"); }
  if (affectedBoundaries.length >= 2) { score += 2; reasonCodes.push("cross_boundary_change"); }
  if (affectedBoundaries.length >= 4) { score += 1; reasonCodes.push("broad_boundary_change"); }
  if (architectureChange) { score += 3; reasonCodes.push("architecture_change"); }
  if (escalationReasons.length) { score += 4; reasonCodes.push(...escalationReasons); }
  if (suppliedInputBreadth >= 3) { score += 1; reasonCodes.push("multiple_supplied_inputs"); }
  if (productDecision?.review?.semanticRequired) { score += 2; reasonCodes.push("semantic_review_required"); }
  if (lifecycle === "project-init") { score += 2; reasonCodes.push("project_initiation"); }
  if (workflowMode === "planner") reasonCodes.push("planner_mode");

  let resolvedTaskType = score >= 5 ? "Hard" : score >= 2 ? "Medium" : "Simple";
  let overrideStatus = override === "Auto" ? "auto_classified" : "respected";
  if (TASK_TYPES.has(override)) {
    const rank = { Simple: 1, Medium: 2, Hard: 3 };
    if (escalationReasons.length && rank[override] < rank.Hard) {
      resolvedTaskType = "Hard";
      overrideStatus = "safety_escalated";
      reasonCodes.push("explicit_override_safety_escalated");
    } else {
      resolvedTaskType = override;
      reasonCodes.push("explicit_override_respected");
    }
  }

  const riskLevel = escalationReasons.length ? "high" : architectureChange || affectedBoundaries.length >= 3 ? "medium" : "low";
  const plannedReviewCalls = resolvedTaskType === "Hard" && workflowMode !== "planner" ? 1 : 0;
  const plannedExecutionCalls = workflowMode === "planner" ? 0 : 1;
  return {
    schemaVersion: "plutomix-gotham-task-classification/v1",
    requestedTaskType: override,
    resolvedTaskType,
    overrideStatus,
    classificationScore: score,
    reasonCodes: [...new Set(reasonCodes)],
    riskLevel,
    affectedBoundaries,
    actionCount: actions,
    artifactType: inferredArtifactType(text, productDecision),
    projectLifecycle: lifecycle,
    plannedExecutionCalls,
    plannedReviewCalls,
    infrastructureReplayLimit: 1,
    repairCallLimit: 1,
    maximumModelCallBudget: plannedExecutionCalls + plannedReviewCalls
  };
}

export function normalizeGothamTaskType(value) {
  return normalizeOverride(value);
}
