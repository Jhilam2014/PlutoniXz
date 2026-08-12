import { listProviders, getProvider } from "./provider-catalog.service.js";
import { recommendStack } from "./stack-recommendation.service.js";
import { buildPermissionPreview } from "./permission-preview.service.js";
import { buildDeploymentPlan } from "./deployment-plan.service.js";
import { storeCredentialMetadata } from "./secret-vault.service.js";
import { addLog, addMessage, createSession, getSession, updateSession } from "./hosting-session-state.service.js";
import { appendCredentialAudit, appendDeploymentAudit } from "./deployment-audit.service.js";
import { runMockDeployment, rollbackMockDeployment } from "./deployment-pipeline.service.js";

export function startSession() {
  return createSession();
}

export function sendMessage(sessionId, content) {
  const session = addMessage(sessionId, "user", String(content || "").slice(0, 1000));
  if (!session) throw new Error("Hosting session not found.");
  return addMessage(sessionId, "assistant", assistantPromptForStage(session.current_stage), session.current_stage);
}

export function assistantPromptForStage(stage) {
  const prompts = {
    project_selection: "Select the generated project you want to deploy. I will only use project metadata and never copy secrets into memory.",
    deployment_goal: "Tell me the deployment goal: preview, MVP launch, production handoff, or custom infrastructure.",
    provider_selection: "Choose a cloud provider. For simple MVP web/API apps, Google Cloud Run is the default recommendation.",
    stack_selection: "Confirm the stack. I recommend a containerized Node.js web/API deployment for generated PlutoniX projects.",
    region_selection: "Choose the closest compliant region for your users.",
    credential_method_selection: "Choose OIDC/workload identity if possible. Manual keys should be a last resort.",
    permission_preview: "Review the least-privilege permissions before connecting credentials.",
    secure_credential_onboarding: "Use the secure credential panel only. Do not paste secrets into chat.",
    deployment_plan_preview: "Review the generated plan. No deployment happens until you approve.",
    user_approval: "Approve only if the provider, region, permissions, and cost posture look right.",
    rollback_or_finalize: "Deployment is complete. You can rollback while the prior revision is available."
  };
  return prompts[stage] || "I am ready for the next deployment step.";
}

export function selectProject(sessionId, project) {
  const session = updateSession(sessionId, () => ({ project_id: project.id, current_stage: "deployment_goal" }));
  addMessage(sessionId, "assistant", `Selected ${project.name}. What is the deployment goal: preview, MVP launch, production handoff, or custom?`, "deployment_goal");
  return session;
}

export function selectProvider(sessionId, providerId) {
  const provider = getProvider(providerId);
  const session = updateSession(sessionId, () => ({
    selected_provider: provider.id,
    selected_region: provider.regions[0],
    current_stage: "stack_selection"
  }));
  addMessage(sessionId, "assistant", `${provider.name} selected. Next we will confirm the stack and deployment runtime.`, "stack_selection");
  return session;
}

export function selectStack(sessionId, stack, project) {
  const session = updateSession(sessionId, (current) => ({
    selected_stack: stack || recommendStack(project, current.selected_provider),
    current_stage: "region_selection"
  }));
  addMessage(sessionId, "assistant", "Stack confirmed. Choose a deployment region close to your users.", "region_selection");
  return session;
}

export function selectRegion(sessionId, region) {
  const session = updateSession(sessionId, () => ({
    selected_region: region,
    current_stage: "credential_method_selection"
  }));
  addMessage(sessionId, "assistant", `Region ${region} selected. Next, choose the safest credential method.`, "credential_method_selection");
  return session;
}

export function selectCredentialMethod(sessionId, credentialMethod) {
  const session = updateSession(sessionId, (current) => ({
    credential_method: credentialMethod,
    permission_preview: buildPermissionPreview(current.selected_provider, credentialMethod),
    current_stage: "permission_preview"
  }));
  addMessage(sessionId, "assistant", "Review the permission preview. We will reject broad root/admin style credentials.", "permission_preview");
  return session;
}

export function onboardCredentials(sessionId, credentialPayload) {
  const session = getSession(sessionId);
  if (!session) throw new Error("Hosting session not found.");
  const metadata = storeCredentialMetadata({
    sessionId,
    providerId: session.selected_provider,
    credentialMethod: session.credential_method,
    credentialPayload
  });
  appendCredentialAudit({
    type: "credential_created",
    session_id: sessionId,
    credential_id: metadata.credential_id,
    provider: session.selected_provider,
    method: session.credential_method,
    created_at: new Date().toISOString()
  });
  addMessage(sessionId, "assistant", "Credential reference connected. I stored only sanitized metadata and an encrypted-reference placeholder.", "deployment_plan_preview");
  return updateSession(sessionId, () => ({
    credential_status: "connected",
    credential_metadata: metadata,
    current_stage: "deployment_plan_preview"
  }));
}

export function previewPlan(sessionId, project) {
  const session = getSession(sessionId);
  if (!session) throw new Error("Hosting session not found.");
  const plan = buildDeploymentPlan(session, project);
  addMessage(sessionId, "assistant", "Deployment plan generated. Please review it before approval.", "user_approval");
  return updateSession(sessionId, () => ({ deployment_plan: plan, current_stage: "user_approval" }));
}

export function approveSession(sessionId) {
  appendDeploymentAudit({ type: "deployment_approved", session_id: sessionId, created_at: new Date().toISOString() });
  addMessage(sessionId, "assistant", "Approval recorded. You can now start deployment execution.", "user_approval");
  return updateSession(sessionId, () => ({ approval_status: "approved" }));
}

export async function deploySession(sessionId, project) {
  const session = getSession(sessionId);
  if (!session) throw new Error("Hosting session not found.");
  return runMockDeployment(session, project);
}

export function cancelSession(sessionId) {
  addLog(sessionId, "Deployment session canceled by user.", { level: "warning" });
  return updateSession(sessionId, () => ({ deployment_status: "canceled", current_stage: "deployment_result" }));
}

export function rollbackSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) throw new Error("Hosting session not found.");
  return rollbackMockDeployment(session);
}

export { getSession, listProviders };
