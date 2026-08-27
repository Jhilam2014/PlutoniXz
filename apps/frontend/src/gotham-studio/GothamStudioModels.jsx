import { Boxes } from "lucide-react";
import { providerLabel } from "./lib/normalizeStudioState.js";

export default function GothamStudioModels({ models }) {
  return (
    <section className="studio-resource-page">
      <header className="studio-section-toolbar"><div><span>Registered provider assets</span><h2>Models</h2></div></header>
      {models.length ? <div className="studio-table-wrap"><table className="studio-table"><thead><tr><th>Model</th><th>Provider</th><th>Version</th><th>Stage</th><th>Source job</th></tr></thead><tbody>{models.map((model) => <tr key={model.id}><td><strong>{model.name}</strong><small>{model.id}</small></td><td>{providerLabel(model.provider)}</td><td>{model.version || "Unavailable"}</td><td>{model.stage || "Unassigned"}</td><td>{model.jobId || "Unavailable"}</td></tr>)}</tbody></table></div> : <div className="gotham-studio-empty primary"><Boxes size={25} /><h3>No registered models</h3><p>Models appear when a provider-backed run returns registry evidence. Deployment is intentionally disabled by default.</p></div>}
    </section>
  );
}
