const stages = [
  "project_selection",
  "deployment_goal",
  "provider_selection",
  "stack_selection",
  "region_selection",
  "credential_method_selection",
  "permission_preview",
  "secure_credential_onboarding",
  "deployment_plan_preview",
  "user_approval",
  "build_image",
  "push_image",
  "provision_runtime",
  "inject_secrets",
  "deploy_service",
  "health_check",
  "deployment_result",
  "rollback_or_finalize"
];

export default function DeploymentStageTimeline({ currentStage }) {
  const currentIndex = Math.max(0, stages.indexOf(currentStage));
  return (
    <ol className="hosting-stage-timeline">
      {stages.map((stage, index) => (
        <li key={stage} className={`${index < currentIndex ? "done" : ""} ${index === currentIndex ? "active" : ""}`}>
          <span>{index + 1}</span>
          <strong>{stage.replaceAll("_", " ")}</strong>
        </li>
      ))}
    </ol>
  );
}
