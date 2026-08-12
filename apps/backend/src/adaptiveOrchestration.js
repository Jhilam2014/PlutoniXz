const taskWeights = {
  simple: 1,
  small: 1,
  medium: 2,
  large: 3,
  hard: 3,
  complex: 3
};

const highRiskPatterns = [
  /\bauth(?:entication|orization)?\b/i,
  /\bcredential|secret|api key\b/i,
  /\bpayment|billing|invoice\b/i,
  /\bdatabase migration|schema migration|data deletion\b/i,
  /\bdeploy(?:ment)?|production\b/i,
  /\bsecurity|permission|rbac\b/i
];

const boundaryPatterns = [
  /\bfrontend\b/i,
  /\bbackend\b/i,
  /\bapi\b/i,
  /\bdatabase\b/i,
  /\bworker|queue\b/i,
  /\bdocker|infrastructure\b/i
];

function normalizedTaskType(value = "Medium") {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "tiny" || normalized === "small") return "Simple";
  if (normalized === "large" || normalized === "hard" || normalized === "complex") return "Hard";
  if (normalized === "simple") return "Simple";
  return "Medium";
}

export function selectAdaptiveRoute({ instruction = "", taskType = "Medium", project = null, maxModelCalls, productDecision = null } = {}) {
  const normalizedType = normalizedTaskType(taskType);
  const baseScore = taskWeights[normalizedType.toLowerCase()] || 2;
  const highRiskMatches = highRiskPatterns.filter((pattern) => pattern.test(instruction)).map((pattern) => pattern.source);
  const boundaryMatches = boundaryPatterns.filter((pattern) => pattern.test(instruction)).map((pattern) => pattern.source);
  const managedProject = Boolean(project && !project.isDefault);
  const riskScore = highRiskMatches.length ? 2 : 0;
  const boundaryScore = boundaryMatches.length >= 2 ? 1 : 0;
  const routeScore = baseScore + riskScore + boundaryScore;
  const callBudget = Math.max(1, Number(maxModelCalls ?? process.env.PLUTONIX_ADAPTIVE_MAX_MODEL_CALLS ?? 2));
  const productReviewRequired = Boolean(productDecision?.review?.semanticRequired);

  let mode = managedProject && baseScore >= 2 ? "delegated" : "single";
  if (routeScore >= 4 && managedProject && callBudget >= 2) mode = "delegated_reviewed";

  const requiresIndependentReview = callBudget >= 2 && (mode === "delegated_reviewed" || productReviewRequired);
  const modelCalls = requiresIndependentReview ? 2 : 1;
  return {
    version: "1.0",
    mode,
    taskType: normalizedType,
    routeScore,
    riskLevel: highRiskMatches.length ? "high" : productReviewRequired || routeScore >= 3 ? "medium" : "low",
    managedProject,
    executionAgent: managedProject && mode !== "single" ? "project-orchestrator" : "plutonix-fullstack-agent",
    requiresIndependentReview,
    reviewerAgentId: requiresIndependentReview ? "plutonix-independent-reviewer" : null,
    modelCallBudget: callBudget,
    plannedModelCalls: modelCalls,
    highRiskMatches,
    boundaryMatches,
    productReviewRequired,
    reasons: [
      `Task type ${normalizedType} produced base score ${baseScore}.`,
      managedProject ? "A managed project can receive bounded delegated execution." : "The default workspace remains on the canonical single-call path.",
      highRiskMatches.length ? "High-risk language requires independent review." : "No high-risk language required review.",
      boundaryScore ? "Multiple system boundaries increased route complexity." : "No cross-boundary escalation was required.",
      productReviewRequired
        ? "The Product Shape Contract requires semantic review for complexity, governance, or risk."
        : "The Product Shape Contract does not require a semantic-review escalation.",
      requiresIndependentReview ? "Call budget permits one execution and one independent review." : `Selected ${mode} within a ${callBudget}-call budget.`
    ]
  };
}

export function isTransientWorkflowError(error) {
  const message = String(error?.message || error || "");
  return /produced no output|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EAGAIN|temporar(?:y|ily) unavailable|(?:codex|gotham)_models_manager::(?:manager|cache).*missing field `supports_reasoning_summaries`/i.test(message);
}
