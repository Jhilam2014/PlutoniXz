import { Beaker } from "lucide-react";
import { providerLabel } from "./lib/normalizeStudioState.js";

export default function GothamStudioExperiments({ experiments }) {
  return (
    <section className="studio-resource-page">
      <header className="studio-section-toolbar"><div><span>Provider-backed evidence</span><h2>Experiments</h2></div></header>
      {experiments.length ? <div className="studio-table-wrap"><table className="studio-table"><thead><tr><th>Experiment</th><th>Provider</th><th>Run</th><th>Metric</th><th>Status</th></tr></thead><tbody>{experiments.map((experiment) => <tr key={experiment.id}><td><strong>{experiment.name}</strong><small>{experiment.id}</small></td><td>{providerLabel(experiment.provider)}</td><td>{experiment.providerRunId || "Unavailable"}</td><td>{experiment.primaryMetric?.name ? `${experiment.primaryMetric.name}: ${experiment.primaryMetric.value}` : "Not reported"}</td><td>{experiment.isBest ? <span className="studio-state-badge success">Selected best</span> : experiment.status || "Recorded"}</td></tr>)}</tbody></table></div> : <div className="gotham-studio-empty primary"><Beaker size={25} /><h3>No experiment evidence yet</h3><p>Experiments appear only after a configured provider reports real run or tracking data. Gotham Studio does not synthesize metrics.</p></div>}
    </section>
  );
}
