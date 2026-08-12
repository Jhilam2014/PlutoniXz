export default function PermissionPreview({ preview }) {
  if (!preview) return <section className="hosting-side-card muted"><h3>Permissions</h3><p>Select credentials method to preview permissions.</p></section>;
  return (
    <section className="hosting-side-card">
      <h3>Permission preview</h3>
      <ul>
        {preview.least_privilege_roles?.map((role) => <li key={role}>{role}</li>)}
      </ul>
      <p>{preview.warnings?.[0]}</p>
    </section>
  );
}
