import { AlertTriangle, ExternalLink, FileArchive, Gauge, Loader2, MessageSquareText, RefreshCcw, RotateCcw, Square } from "lucide-react";
import { useState } from "react";
import { canCancelStudioJob, canRetryStudioJob, canSubmitStudioJob, costLabel, elapsedLabel, providerCapabilities, providerLabel, studioStateTone } from "./lib/normalizeStudioState.js";

function timestamp(value) {
  return value ? new Date(value).toLocaleString() : "Unavailable";
}

export default function GothamStudioJobDetail({ detail, providers, workflowMode, action, actions, onAskGotham, onOpenFunctionality }) {
  const job = detail?.job;
  const [evidence, setEvidence] = useState({ kind: "", value: null, error: "" });
  if (!job) return <section className="gotham-studio-empty"><Gauge size={22} /><h3>Select a logical job</h3><p>Job state, provider references, evidence, and controls appear here.</p></section>;
  const capabilities = providerCapabilities(providers, job.provider);
  const busy = action.includes(job.id);

  async function inspect(kind) {
    try {
      const value = await actions[{ logs: "loadLogs", metrics: "loadMetrics", artifacts: "loadArtifacts" }[kind]](job.id);
      setEvidence({ kind, value, error: "" });
    } catch (error) {
      setEvidence({ kind, value: null, error: error.message });
    }
  }

  return (
    <article className="studio-job-detail">
      <header className="studio-job-detail-header">
        <div><span>{job.id}</span><h2>{job.name}</h2><p>{job.objective}</p></div>
        <span className={`studio-state-badge large ${studioStateTone(job.logicalState)}`}>{job.logicalState}</span>
      </header>

      {job.logicalState === "FAILED" ? <div className="studio-failure-banner"><AlertTriangle size={18} /><div><strong>{job.error?.summary || "Provider execution failed."}</strong><span>{job.error?.code || job.providerState || "Failure details unavailable"}</span></div></div> : null}

      <div className="studio-job-facts">
        <dl>
          <div><dt>Provider</dt><dd>{providerLabel(job.provider)}</dd></div>
          <div><dt>Pipeline</dt><dd>{job.pipelineId || "Not linked"}</dd></div>
          <div><dt>Current stage</dt><dd>{job.currentStage || "Not reported"}</dd></div>
          <div><dt>Duration</dt><dd>{elapsedLabel(job)}</dd></div>
          <div><dt>Compute</dt><dd>{job.resourceType || "Not reported"}</dd></div>
          <div><dt>Cost</dt><dd>{costLabel(job)}</dd></div>
          <div><dt>Triggered by</dt><dd>{job.triggerSource || "studio"}</dd></div>
          <div><dt>Functionality</dt><dd>{job.functionalityId || "Not linked"}</dd></div>
        </dl>
        <section>
          <span>Provider references</span>
          <dl>
            <div><dt>Job ID</dt><dd>{job.providerJobId || "Not assigned"}</dd></div>
            <div><dt>Run ID</dt><dd>{job.providerRunId || "Not assigned"}</dd></div>
            <div><dt>Raw state</dt><dd>{job.providerState || "Not reported"}</dd></div>
          </dl>
        </section>
      </div>

      {Number.isFinite(job.progress) ? <div className="studio-job-progress"><span><b>Provider progress</b><strong>{job.progress}%</strong></span><progress max="100" value={job.progress} /></div> : <p className="studio-unavailable-note">This provider has not reported a trustworthy progress percentage.</p>}

      <div className="studio-job-actions" aria-label="Job controls">
        <button type="button" onClick={() => actions.refreshJob(job.id)} disabled={busy || !job.providerRunId}><RefreshCcw size={14} />Refresh state</button>
        {canSubmitStudioJob(job, providers, workflowMode) ? <button type="button" className="primary" onClick={() => actions.submitJob(job.id, workflowMode)} disabled={busy}><Gauge size={14} />Submit</button> : null}
        {canCancelStudioJob(job, providers) ? <button type="button" className="danger" onClick={() => actions.cancelJob(job.id)} disabled={busy}><Square size={13} />Cancel</button> : null}
        {canRetryStudioJob(job) ? <button type="button" onClick={() => actions.retryJob(job.id, workflowMode)} disabled={busy || workflowMode !== "executor"}><RotateCcw size={14} />Retry</button> : null}
        {capabilities.pollLogs ? <button type="button" onClick={() => inspect("logs")} disabled={busy}><MessageSquareText size={14} />Logs</button> : null}
        {capabilities.metrics ? <button type="button" onClick={() => inspect("metrics")} disabled={busy}><Gauge size={14} />Metrics</button> : null}
        {capabilities.artifacts ? <button type="button" onClick={() => inspect("artifacts")} disabled={busy}><FileArchive size={14} />Artifacts</button> : null}
        {job.providerUrl && capabilities.openProvider ? <a href={job.providerUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open provider</a> : null}
        <button type="button" onClick={() => onAskGotham(`Why did ${job.id} ${job.logicalState === "FAILED" ? "fail" : "reach its current state"}?`, { selectedJobId: job.id, selectedPipelineId: job.pipelineId || "", selectedFunctionalityId: job.functionalityId || "" })}><MessageSquareText size={14} />Ask Gotham</button>
        {job.functionalityId ? <button type="button" onClick={() => onOpenFunctionality(job.functionalityId)}>Functionality graph</button> : null}
        {busy ? <Loader2 className="spin" size={15} /> : null}
      </div>

      {evidence.kind ? <section className="studio-job-evidence"><header><div><span>Provider evidence</span><h3>{evidence.kind}</h3></div><button type="button" onClick={() => setEvidence({ kind: "", value: null, error: "" })}>Close</button></header>{evidence.error ? <p className="error">{evidence.error}</p> : <pre>{JSON.stringify(evidence.value, null, 2)}</pre>}</section> : null}

      <section className="studio-timeline">
        <header><span>Execution timeline</span><h3>Normalized control-plane events</h3></header>
        {detail.timeline?.length ? <ol>{[...detail.timeline].reverse().map((item) => <li key={item.id}><i className={studioStateTone(item.logicalState)} /><div><strong>{item.message}</strong><span>{item.type} · {timestamp(item.createdAt)}</span></div></li>)}</ol> : <p>No lifecycle events are recorded for this job.</p>}
      </section>
    </article>
  );
}
