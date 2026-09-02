export default function CredentialSecurityExplainer() {
  return (
    <section className="hosting-security-note">
      <strong>Credential security</strong>
      <p>Prefer OAuth/OIDC or workload identity. Manual secrets are accepted only through the secure panel, never normal chat. PlutoMix stores sanitized metadata and vault references only.</p>
    </section>
  );
}
