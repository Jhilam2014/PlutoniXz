import { addLog, updateSession } from "./hosting-session-state.service.js";
import { appendDeploymentAudit } from "./deployment-audit.service.js";

const deployStages = ["build_image", "push_image", "provision_runtime", "inject_secrets", "deploy_service", "health_check", "deployment_result"];

export async function runMockDeployment(session, project) {
  if (session.approval_status !== "approved") {
    throw new Error("Deployment requires explicit approval before execution.");
  }
  let next = updateSession(session.session_id, () => ({ deployment_status: "running", current_stage: "build_image" }));
  for (const stage of deployStages) {
    next = updateSession(session.session_id, () => ({ current_stage: stage }));
    addLog(session.session_id, `${stage.replaceAll("_", " ")} completed in mock-safe mode.`, { level: "info" });
  }
  const deploymentUrl = `https://example.invalid/${project.id}`;
  next = updateSession(session.session_id, () => ({
    current_stage: "rollback_or_finalize",
    deployment_status: "succeeded",
    deployment_url: deploymentUrl,
    rollback_available: true
  }));
  appendDeploymentAudit({
    type: "deployment_succeeded",
    session_id: session.session_id,
    project_id: project.id,
    provider: session.selected_provider,
    deployment_url: deploymentUrl,
    created_at: new Date().toISOString()
  });
  return next;
}

export function rollbackMockDeployment(session) {
  if (!session.rollback_available) throw new Error("Rollback is not available for this session.");
  addLog(session.session_id, "Rollback completed in mock-safe mode. Prior revision would receive traffic in a real provider.", { level: "warning" });
  appendDeploymentAudit({
    type: "rollback_completed",
    session_id: session.session_id,
    project_id: session.project_id,
    provider: session.selected_provider,
    created_at: new Date().toISOString()
  });
  return updateSession(session.session_id, () => ({ deployment_status: "rolled_back", current_stage: "deployment_result" }));
}
