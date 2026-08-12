export default function DeploymentResultCard({ session }) {
  return (
    <section className="hosting-side-card">
      <h3>Result</h3>
      <p>{session?.deployment_status || "Not started"}</p>
      {session?.deployment_url ? <a href={session.deployment_url} target="_blank" rel="noreferrer">{session.deployment_url}</a> : null}
    </section>
  );
}
