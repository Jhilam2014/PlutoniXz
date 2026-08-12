export default function RollbackPanel({ session, onRollback, onCancel }) {
  return (
    <section className="hosting-side-card">
      <h3>Rollback</h3>
      <p>{session?.rollback_available ? "Rollback is available for the latest mock deployment." : "Rollback becomes available after deployment."}</p>
      <button type="button" onClick={onRollback} disabled={!session?.rollback_available}>Rollback</button>
      <button type="button" className="secondary" onClick={onCancel}>Cancel session</button>
    </section>
  );
}
