export default function DeploymentLogsViewer({ logs }) {
  return (
    <section className="hosting-side-card hosting-logs">
      <h3>Logs</h3>
      {logs?.length ? logs.map((log) => <p key={log.id}>{log.message}</p>) : <p>No deployment logs yet.</p>}
    </section>
  );
}
