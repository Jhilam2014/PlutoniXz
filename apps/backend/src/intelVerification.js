import { runCodexReviewWorkflow, runModelRepairWorkflow } from "./codexWorkflow.js";
import { validateIntelProfileOutput } from "./intelArtifactValidation.js";
import { beginIntelRepair, recordIntelRepair } from "./intelOrchestration.js";

function actionableVerificationFailure(error) {
  const message = String(error?.message || error || "");
  return !/cancelled|stopped by the user|timeout|network|unavailable|enoent|not found|produced no output/i.test(message);
}

function uniqueFiles(...groups) {
  return [...new Set(groups.flat().map((file) => String(file || "")).filter(Boolean))];
}

export async function verifyIntelWithBoundedRepair({
  runtime,
  orchestratedRequest,
  result,
  profile,
  workspaceDir,
  projectId = "",
  projectName = "",
  taskType = "",
  signal,
  emit = () => {}
} = {}) {
  const reviewOptions = {
    generatedSiteDir: workspaceDir,
    projectId,
    projectName,
    taskType,
    signal,
    reviewerAgentId: "intel-verification-agent"
  };
  emit("intel-verification-started", "Intel is starting independent read-only verification.", {
    parentWorkflowId: orchestratedRequest?.orchestrationEnvelope?.parentWorkflowId || runtime?.workflowId || "",
    reviewerAgentId: reviewOptions.reviewerAgentId
  });
  try {
    return { result, review: await runCodexReviewWorkflow(orchestratedRequest, result, reviewOptions), repaired: false };
  } catch (error) {
    if (signal?.aborted || runtime?.repairCycles >= 1 || !actionableVerificationFailure(error)) throw error;
    beginIntelRepair(runtime, error);
    emit("intel-verification-failed", error.message, {
      parentWorkflowId: orchestratedRequest?.orchestrationEnvelope?.parentWorkflowId || runtime?.workflowId || "",
      retryable: false
    });
    emit("intel-repair-started", "Intel is applying one bounded repair from the independent verification failure.", {
      parentWorkflowId: orchestratedRequest?.orchestrationEnvelope?.parentWorkflowId || runtime?.workflowId || "",
      profile: runtime.profile,
      repairCycle: runtime.repairCycles
    });
    const repair = await runModelRepairWorkflow(orchestratedRequest, error, {
      emit,
      generatedSiteDir: workspaceDir,
      projectId,
      projectName,
      taskType,
      changedFiles: result?.files || [],
      runtimeLogTail: error.message,
      signal,
      intelProfile: profile
    });
    recordIntelRepair(runtime, repair);
    const files = uniqueFiles(result?.files || [], repair.files || []);
    const validation = await validateIntelProfileOutput({ profile, workspaceDir, changedFiles: files });
    runtime.validationResults.push(...validation.checks);
    const failed = validation.checks.filter((check) => check.status === "failed");
    if (failed.length) throw new Error(`Intel repair validation failed: ${failed.map((check) => check.detail).join(" ")}`);
    emit("intel-validation-started", "Intel is validating the bounded repair against the selected profile.", {
      parentWorkflowId: orchestratedRequest?.orchestrationEnvelope?.parentWorkflowId || runtime?.workflowId || "",
      validationResults: validation.checks
    });
    emit("intel-verification-started", "Intel is independently verifying the bounded repair.", {
      parentWorkflowId: orchestratedRequest?.orchestrationEnvelope?.parentWorkflowId || runtime?.workflowId || "",
      reviewerAgentId: reviewOptions.reviewerAgentId
    });
    const repairedResult = { ...result, buildId: repair.repairId, files, repair };
    return { result: repairedResult, review: await runCodexReviewWorkflow(orchestratedRequest, repairedResult, reviewOptions), repaired: true };
  }
}
