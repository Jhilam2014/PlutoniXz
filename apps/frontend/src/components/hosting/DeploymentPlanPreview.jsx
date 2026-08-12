export default function DeploymentPlanPreview({ plan, onPreview, onApprove, approved }) {
  if (!plan) {
    return <section className="hosting-side-card muted"><h3>Deployment plan</h3><p>Generate a plan after project, provider, stack, and credentials are selected.</p><button type="button" onClick={onPreview}>Generate plan</button></section>;
  }
  return (
    <section className="hosting-side-card">
      <h3>Deployment plan</h3>
      <dl>
        <div><dt>Provider</dt><dd>{plan.provider}</dd></div>
        <div><dt>Region</dt><dd>{plan.region}</dd></div>
        <div><dt>Registry</dt><dd>{plan.image_registry}</dd></div>
        <div><dt>Health check</dt><dd>{plan.health_check}</dd></div>
        <div><dt>Cost posture</dt><dd>{plan.estimated_cost_posture}</dd></div>
      </dl>
      <button type="button" onClick={onApprove} disabled={approved}>{approved ? "Approved" : "Approve deployment"}</button>
    </section>
  );
}
