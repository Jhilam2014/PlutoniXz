import { CheckCircle2, CloudCog, Loader2, RefreshCcw, ShieldAlert } from "lucide-react";

function statusLabel(provider) {
  if (provider.lastVerification?.connected) return "Verified";
  if (provider.lastVerification?.status === "error") return "Verification failed";
  if (provider.configured) return "Configured, not verified";
  return "Not configured";
}

export default function GothamStudioProviders({ providers, action, actions }) {
  return (
    <section className="studio-resource-page">
      <header className="studio-section-toolbar"><div><span>Backend-only provider configuration</span><h2>Providers / Setup</h2></div></header>
      <p className="studio-provider-intro">Credentials are read from the backend environment or its managed identity. They are never accepted by this UI, stored in job records, or returned by these APIs.</p>
      <div className="studio-provider-grid">
        {providers.map((provider) => {
          const checking = action === `verify:${provider.id}`;
          const verified = provider.lastVerification?.connected;
          return <article key={provider.id} className={`studio-provider-card ${provider.configured ? "configured" : "unconfigured"}`}><header><span>{verified ? <CheckCircle2 size={19} /> : provider.configured ? <CloudCog size={19} /> : <ShieldAlert size={19} />}</span><div><h3>{provider.label}</h3><p>{statusLabel(provider)}</p></div></header><dl>{Object.entries(provider.metadata || {}).map(([key, value]) => <div key={key}><dt>{key.replaceAll(/([A-Z])/g, " $1")}</dt><dd>{String(value || "Unavailable")}</dd></div>)}</dl><section><strong>Adapter capabilities</strong><div className="studio-capabilities">{Object.entries(provider.capabilities || {}).map(([key, value]) => <span className={value ? "yes" : "no"} key={key}>{key.replaceAll(/([A-Z])/g, " $1")}</span>)}</div></section>{provider.lastVerification?.error?.summary ? <p className="studio-provider-error">{provider.lastVerification.error.summary}</p> : null}<footer><small>{provider.lastVerification?.checkedAt ? `Checked ${new Date(provider.lastVerification.checkedAt).toLocaleString()}` : "No connection check recorded"}</small><button type="button" onClick={() => actions.verifyProvider(provider.id)} disabled={!provider.configured || checking}>{checking ? <Loader2 className="spin" size={14} /> : <RefreshCcw size={14} />}Verify</button></footer></article>;
        })}
      </div>
    </section>
  );
}
