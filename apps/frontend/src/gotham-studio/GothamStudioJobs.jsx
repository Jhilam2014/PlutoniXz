import { Filter, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import GothamStudioJobDetail from "./GothamStudioJobDetail.jsx";
import { providerConfigured, providerLabel, studioStateTone } from "./lib/normalizeStudioState.js";

const emptyForm = { name: "", objective: "", provider: "databricks", pipelineId: "", functionalityId: "", savedJobId: "", tasks: "", mlflowRunIds: "", azureDefinition: "", maxRuns: "1", maxRuntimeMinutes: "60", maxEstimatedCost: "", currency: "USD", budgetPolicyId: "", computeClass: "", allowGpu: false, submit: false };

export default function GothamStudioJobs({ jobs, pipelines, providers, selectedJobId, setSelectedJobId, jobDetail, workflowMode, action, actions, onAskGotham, onOpenFunctionality }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const filtered = useMemo(() => jobs.filter((job) => (state === "all" || job.logicalState === state) && (!query || `${job.id} ${job.name} ${job.objective} ${job.provider}`.toLowerCase().includes(query.toLowerCase()))), [jobs, query, state]);
  const selectedProvider = providers.find((provider) => provider.id === form.provider);

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }

  async function create(event) {
    event.preventDefault();
    setFormError("");
    try {
      let providerConfiguration = { ...(form.computeClass ? { computeClass: form.computeClass } : {}), ...(form.budgetPolicyId ? { budgetPolicyId: form.budgetPolicyId } : {}) };
      if (form.provider === "databricks") {
        if (form.savedJobId) providerConfiguration.jobId = form.savedJobId;
        else if (form.tasks.trim()) providerConfiguration.tasks = JSON.parse(form.tasks);
        if (form.mlflowRunIds.trim()) providerConfiguration.mlflowRunIds = form.mlflowRunIds.split(",").map((value) => value.trim()).filter(Boolean);
      } else if (form.provider === "azure-ml" && form.azureDefinition.trim()) {
        providerConfiguration.definition = JSON.parse(form.azureDefinition);
      }
      const job = await actions.createJob({
        name: form.name,
        objective: form.objective,
        provider: form.provider,
        pipelineId: form.pipelineId || undefined,
        functionalityId: form.functionalityId || undefined,
        parameters: {},
        providerConfiguration,
        constraints: {
          maxRuns: Number(form.maxRuns),
          maxRuntimeMinutes: Number(form.maxRuntimeMinutes),
          ...(form.maxEstimatedCost !== "" ? { maxEstimatedCost: Number(form.maxEstimatedCost) } : {}),
          currency: form.currency.toUpperCase(),
          allowedProviders: [form.provider],
          allowedComputeClasses: form.computeClass ? [form.computeClass] : [],
          allowGpu: form.allowGpu,
          allowDeployment: false
        },
        workflowMode,
        submit: form.submit && workflowMode === "executor",
        triggerSource: "studio"
      });
      setSelectedJobId(job.id);
      setForm(emptyForm);
      setShowCreate(false);
    } catch (error) {
      setFormError(error instanceof SyntaxError ? "Provider specification must be valid JSON." : error.message);
    }
  }

  return (
    <div className="studio-jobs-layout">
      <section className="studio-job-index">
        <header className="studio-section-toolbar"><div><span>Logical jobs</span><h2>Project execution ledger</h2></div><button type="button" className="primary" onClick={() => setShowCreate(true)}><Plus size={15} />New job</button></header>
        <div className="studio-list-filters"><label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search jobs" /></label><label><Filter size={14} /><select value={state} onChange={(event) => setState(event.target.value)}><option value="all">All states</option>{["DRAFT", "QUEUED", "SUBMITTED", "STARTING", "RUNNING", "PAUSED", "SUCCEEDED", "FAILED", "CANCELLING", "CANCELLED", "UNKNOWN"].map((value) => <option value={value} key={value}>{value}</option>)}</select></label></div>
        {filtered.length ? <ol className="studio-job-list">{filtered.map((job) => <li key={job.id}><button type="button" className={selectedJobId === job.id ? "active" : ""} onClick={() => setSelectedJobId(job.id)}><span className={`studio-state-dot ${studioStateTone(job.logicalState)}`} /><span><strong>{job.name}</strong><small>{job.id} · {providerLabel(job.provider)}</small></span><span className={`studio-state-badge ${studioStateTone(job.logicalState)}`}>{job.logicalState}</span></button></li>)}</ol> : <div className="gotham-studio-empty compact"><h3>No jobs match this view</h3><p>{jobs.length ? "Change the filters to see other logical jobs." : "Create a logical job or ask Gotham to design an ML pipeline."}</p></div>}
      </section>
      <GothamStudioJobDetail detail={jobDetail} providers={providers} workflowMode={workflowMode} action={action} actions={actions} onAskGotham={onAskGotham} onOpenFunctionality={onOpenFunctionality} />

      {showCreate ? <div className="studio-dialog-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}><form className="studio-dialog" onSubmit={create} onMouseDown={(event) => event.stopPropagation()} aria-label="Create Gotham Studio job"><header><div><span>Logical execution request</span><h2>New Gotham Studio job</h2></div><button type="button" onClick={() => setShowCreate(false)} aria-label="Close job form"><X size={17} /></button></header><div className="studio-form-grid"><label><span>Name</span><input required minLength="2" value={form.name} onChange={(event) => update("name", event.target.value)} /></label><label><span>Provider</span><select value={form.provider} onChange={(event) => update("provider", event.target.value)}>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.label} · {provider.status.replaceAll("_", " ")}</option>)}</select></label><label className="wide"><span>Objective</span><textarea required minLength="4" value={form.objective} onChange={(event) => update("objective", event.target.value)} /></label><label><span>Pipeline</span><select value={form.pipelineId} onChange={(event) => update("pipelineId", event.target.value)}><option value="">Not linked</option>{pipelines.map((pipeline) => <option value={pipeline.id} key={pipeline.id}>{pipeline.name} · v{pipeline.version}</option>)}</select></label><label><span>Functionality ID</span><input value={form.functionalityId} onChange={(event) => update("functionalityId", event.target.value)} /></label>{form.provider === "databricks" ? <><label><span>Saved Databricks job ID</span><input value={form.savedJobId} onChange={(event) => update("savedJobId", event.target.value)} /></label><label className="wide"><span>Or one-time tasks JSON</span><textarea value={form.tasks} onChange={(event) => update("tasks", event.target.value)} placeholder='[{"task_key":"train", ...}]' /></label><label className="wide"><span>MLflow run IDs for metrics/artifacts (comma-separated)</span><input value={form.mlflowRunIds} onChange={(event) => update("mlflowRunIds", event.target.value)} placeholder="Only use provider run IDs that already exist" /></label></> : <label className="wide"><span>Azure ML ARM job definition</span><textarea value={form.azureDefinition} onChange={(event) => update("azureDefinition", event.target.value)} placeholder='{"properties":{"jobType":"Command", ...}}' /></label>}<label><span>Maximum runs</span><input type="number" min="1" max="50" value={form.maxRuns} onChange={(event) => update("maxRuns", event.target.value)} /></label><label><span>Maximum runtime (minutes)</span><input type="number" min="1" value={form.maxRuntimeMinutes} onChange={(event) => update("maxRuntimeMinutes", event.target.value)} /></label><label><span>Maximum estimated cost</span><input type="number" min="0" step="0.01" value={form.maxEstimatedCost} onChange={(event) => update("maxEstimatedCost", event.target.value)} placeholder="Optional" /></label><label><span>Currency</span><input maxLength="3" value={form.currency} onChange={(event) => update("currency", event.target.value)} /></label><label><span>Provider budget policy ID</span><input value={form.budgetPolicyId} onChange={(event) => update("budgetPolicyId", event.target.value)} placeholder="Required when provider cannot estimate cost" /></label><label><span>Compute class</span><input value={form.computeClass} onChange={(event) => update("computeClass", event.target.value)} /></label><label className="check"><input type="checkbox" checked={form.allowGpu} onChange={(event) => update("allowGpu", event.target.checked)} /><span>Allow GPU compute</span></label><label className="check"><input type="checkbox" checked={form.submit} onChange={(event) => update("submit", event.target.checked)} disabled={workflowMode !== "executor" || !providerConfigured(selectedProvider)} /><span>Submit physical execution now</span></label></div><p className="studio-policy-note">Deployment remains disabled. Planner mode can define work but cannot submit it. Provider credentials are read only by the backend.</p>{formError ? <p className="studio-form-error">{formError}</p> : null}<footer><button type="button" onClick={() => setShowCreate(false)}>Cancel</button><button type="submit" className="primary" disabled={action === "create-job"}>{action === "create-job" ? "Creating…" : form.submit ? `Create and submit to ${providerLabel(form.provider)}` : "Create draft"}</button></footer></form></div> : null}
    </div>
  );
}
