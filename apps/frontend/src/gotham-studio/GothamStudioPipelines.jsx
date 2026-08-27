import { GitBranch, Plus, X } from "lucide-react";
import { useState } from "react";
import { providerLabel } from "./lib/normalizeStudioState.js";

const initialForm = {
  name: "",
  objective: "",
  providerPreference: "databricks",
  functionalityId: "",
  stages: ""
};

export default function GothamStudioPipelines({ pipelines, providers, action, actions }) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");

  async function createPipeline(event) {
    event.preventDefault();
    setError("");
    try {
      const stages = JSON.parse(form.stages);
      if (!Array.isArray(stages) || !stages.length) throw new Error("Stages must be a non-empty JSON array.");
      await actions.createPipeline({ ...form, stages, providerConfiguration: {} });
      setForm(initialForm);
      setShowCreate(false);
    } catch (createError) {
      setError(createError instanceof SyntaxError ? "Stages must be valid JSON." : createError.message);
    }
  }

  return (
    <section className="studio-resource-page">
      <header className="studio-section-toolbar">
        <div><span>Declarative pipeline definitions</span><h2>Versioned ML workflows</h2></div>
        <button type="button" className="primary" onClick={() => setShowCreate(true)}><Plus size={15} />New pipeline</button>
      </header>
      {pipelines.length ? <div className="studio-table-wrap"><table className="studio-table"><thead><tr><th>Pipeline</th><th>Provider</th><th>Stages</th><th>Functionality</th><th>Updated</th></tr></thead><tbody>{pipelines.map((pipeline) => <tr key={pipeline.id}><td><strong>{pipeline.name}</strong><small>{pipeline.id} · v{pipeline.version}</small><p>{pipeline.objective}</p></td><td>{providerLabel(pipeline.providerPreference)}</td><td><ol className="studio-stage-list">{pipeline.stages.map((stage) => <li key={stage.id || stage.name || stage.type}><i />{stage.name || stage.type}<small>{stage.type}</small></li>)}</ol></td><td>{pipeline.functionalityId || "Not linked"}</td><td>{new Date(pipeline.updatedAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="gotham-studio-empty primary"><GitBranch size={25} /><h3>No pipelines defined</h3><p>Create a declarative, versioned pipeline. It remains a logical definition until an authorized Executor submits a job.</p></div>}

      {showCreate ? <div className="studio-dialog-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}><form className="studio-dialog narrow" onSubmit={createPipeline} onMouseDown={(event) => event.stopPropagation()} aria-label="Create Gotham Studio pipeline"><header><div><span>Logical workflow</span><h2>New pipeline definition</h2></div><button type="button" onClick={() => setShowCreate(false)} aria-label="Close pipeline form"><X size={17} /></button></header><div className="studio-form-grid"><label><span>Name</span><input required minLength="2" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label><label><span>Preferred provider</span><select value={form.providerPreference} onChange={(event) => setForm((current) => ({ ...current, providerPreference: event.target.value }))}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label><label className="wide"><span>Objective</span><textarea required minLength="4" value={form.objective} onChange={(event) => setForm((current) => ({ ...current, objective: event.target.value }))} /></label><label className="wide"><span>Stages JSON</span><textarea required className="code" value={form.stages} onChange={(event) => setForm((current) => ({ ...current, stages: event.target.value }))} placeholder={'[{"id":"prepare","type":"data-preparation","name":"Prepare data"},{"id":"train","type":"training","name":"Train model"},{"id":"evaluate","type":"evaluation","name":"Evaluate"}]'} /></label><label className="wide"><span>Functionality ID</span><input value={form.functionalityId} onChange={(event) => setForm((current) => ({ ...current, functionalityId: event.target.value }))} /></label></div><p className="studio-policy-note">The pipeline is stored in project scope. Provider credentials and deployment actions are not accepted here.</p>{error ? <p className="studio-form-error">{error}</p> : null}<footer><button type="button" onClick={() => setShowCreate(false)}>Cancel</button><button type="submit" className="primary" disabled={action === "create-pipeline"}>{action === "create-pipeline" ? "Saving…" : "Save pipeline"}</button></footer></form></div> : null}
    </section>
  );
}
