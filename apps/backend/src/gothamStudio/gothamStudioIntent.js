import { studioConstraintsSchema, studioJobProposalSchema } from "./domain.js";

const executionTerms = /\b(train|training|fine[- ]?tune|experiment|hyperparameter|evaluate|compare|register(?: the)? model|run (?:the )?(?:pipeline|job|experiment)|execute (?:the )?(?:pipeline|job|experiment))\b/i;
const mlContextTerms = /\b(model|dataset|feature engineering|mlflow|databricks|azure ml|azure machine learning|xgboost|lightgbm|neural network|classification|regression|embedding)\b/i;
const implementationTerms = /\b(build|implement|add|create|refactor|code|api|interface|adapter|component|page|gotham studio)\b.{0,80}\b(provider|studio|control plane|source|code|api|interface|adapter|component|page)\b/i;

export function detectMlExecutionIntent(instruction = "", studioContext = null) {
  const text = String(instruction || "").trim();
  if (studioContext && typeof studioContext === "object" && Object.values(studioContext).some((value) => String(value || "").trim())) {
    return { detected: true, confidence: 100, reason: "explicit_studio_context" };
  }
  if (implementationTerms.test(text)) return { detected: false, confidence: 0, reason: "software_implementation_instruction" };
  const detected = executionTerms.test(text) && mlContextTerms.test(text);
  return {
    detected,
    confidence: detected ? (/\b(databricks|azure ml|azure machine learning)\b/i.test(text) ? 94 : 84) : 0,
    reason: detected ? "ml_execution_objective" : "no_explicit_ml_execution_objective"
  };
}

function providerFromInstruction(text) {
  if (/\bazure (?:ml|machine learning)\b/i.test(text)) return "azure-ml";
  if (/\bdatabricks\b/i.test(text)) return "databricks";
  return undefined;
}

function constraintsFromInstruction(text) {
  const currency = text.includes("₹") || /\bINR\b/i.test(text) ? "INR" : text.includes("€") || /\bEUR\b/i.test(text) ? "EUR" : "USD";
  const budgetMatch = text.match(/(?:budget|spend|cost|maximum|max|under|more than)\D{0,20}(?:₹|\$|€|INR\s*|USD\s*|EUR\s*)?([\d,]+(?:\.\d+)?)/i);
  const runtimeMatch = text.match(/(?:max(?:imum)?\s+)?runtime\D{0,12}(\d+)\s*(minutes?|mins?|hours?|hrs?)/i);
  const maxRuntimeMinutes = runtimeMatch
    ? Number(runtimeMatch[1]) * (/hours?|hrs?/i.test(runtimeMatch[2]) ? 60 : 1)
    : 60;
  return studioConstraintsSchema.parse({
    maxRuns: 1,
    maxEstimatedCost: budgetMatch ? Number(budgetMatch[1].replaceAll(",", "")) : undefined,
    currency,
    maxRuntimeMinutes,
    allowedProviders: providerFromInstruction(text) ? [providerFromInstruction(text)] : [],
    allowGpu: /\ballow gpu\b/i.test(text),
    allowDeployment: false
  });
}

function experimentStages(text) {
  const stages = [
    { id: "validate", type: "data_validation" },
    { id: "features", type: "feature_engineering" },
    { id: "train", type: "training" },
    { id: "evaluate", type: "evaluation" }
  ];
  if (/\bregister\b/i.test(text)) stages.push({ id: "register", type: "model_registration" });
  return stages;
}

export function deriveMlExecutionProposal(instruction = "") {
  const text = String(instruction || "").trim();
  const provider = providerFromInstruction(text);
  const requiredInputs = [];
  if (/\b(?:this|latest|the) dataset\b/i.test(text) && !/\b(?:s3|abfss|dbfs|https?):\/\//i.test(text)) {
    requiredInputs.push("A provider-accessible dataset reference is required before submission.");
  }
  requiredInputs.push(provider
    ? `A complete ${provider === "databricks" ? "Databricks saved job ID or tasks specification" : "Azure ML ARM job definition"} is required before submission.`
    : "Select and configure an execution provider before submission.");
  return studioJobProposalSchema.parse({
    objective: text,
    provider,
    pipeline: {
      name: text.split(/[.!?\n]/)[0].slice(0, 120) || "ML execution proposal",
      stages: experimentStages(text)
    },
    constraints: constraintsFromInstruction(text),
    deploymentPolicy: "do_not_deploy",
    estimatedResources: null,
    estimatedCost: null,
    requiredInputs
  });
}
