export default function DeploymentProgress({ session, onDeploy, disabled }) {
  return (
    <section className="hosting-side-card">
      <h3>Progress</h3>
      <p>{session?.deployment_status || "not_started"} · {session?.current_stage?.replaceAll("_", " ")}</p>
      <button type="button" onClick={onDeploy} disabled={disabled}>Deploy</button>
    </section>
  );
}
