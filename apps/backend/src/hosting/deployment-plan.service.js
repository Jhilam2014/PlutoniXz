import { getProvider } from "./provider-catalog.service.js";
import { recommendStack } from "./stack-recommendation.service.js";

export function buildDeploymentPlan(session, project) {
  const provider = getProvider(session.selected_provider);
  const stack = session.selected_stack || recommendStack(project, provider.id);
  return {
    plan_id: `plan_${Date.now()}`,
    project_id: project.id,
    project_name: project.name,
    provider: provider.name,
    provider_id: provider.id,
    region: session.selected_region || provider.regions[0],
    stack,
    image_registry: stack.registry,
    runtime: stack.runtime,
    database: "No managed database changes planned by default.",
    secrets: "Deployment secrets are referenced through vault metadata only; plaintext is never returned.",
    build_command: stack.buildCommand,
    deploy_command: `Mock-safe deploy to ${provider.name}`,
    health_check: stack.healthCheckPath,
    rollback_strategy: provider.rollbackSupported ? "Keep prior revision/image reference and switch traffic back on rollback." : "Manual rollback required.",
    estimated_cost_posture: provider.id === "google-cloud-run" ? "Low for MVP traffic with scale-to-zero." : "Depends on always-on runtime and regional resources.",
    permission_summary: session.permission_preview?.least_privilege_roles || provider.permissions,
    created_at: new Date().toISOString()
  };
}
