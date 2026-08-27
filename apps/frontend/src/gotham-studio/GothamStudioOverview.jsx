import { AlertTriangle, CheckCircle2, Clock3, Cpu, PlayCircle } from "lucide-react";
import { costLabel, providerLabel, studioStateTone } from "./lib/normalizeStudioState.js";

export default function GothamStudioOverview({ overview, onSelectJob, onOpenTab }) {
  if (!overview) return <section className="gotham-studio-empty"><Clock3 size={22} /><h3>Studio state is loading</h3><p>The control plane is reading this project's persisted ML execution records.</p></section>;
  const totals = overview.totals || {};
  const hasRecords = (overview.activeJobs?.length || 0) + (overview.attentionJobs?.length || 0) + (overview.recentCompleted?.length || 0) > 0;
  return (
    <div className="gotham-studio-overview">
      <section className="studio-status-strip" aria-label="ML execution totals">
        <span><PlayCircle size={15} /><b>{totals.running || 0}</b> Running</span>
        <span><CheckCircle2 size={15} /><b>{totals.succeeded || 0}</b> Completed</span>
        <span className={totals.failed ? "danger" : ""}><AlertTriangle size={15} /><b>{totals.failed || 0}</b> Failed</span>
        <span><Clock3 size={15} /><b>{totals.queued || 0}</b> Queued</span>
        <span><Cpu size={15} /><b>{Math.round((overview.consumed?.computeDurationSeconds || 0) / 60).toLocaleString()}</b> Compute min</span>
      </section>

      {!hasRecords ? (
        <section className="gotham-studio-empty primary">
          <Cpu size={28} />
          <h3>No ML jobs yet</h3>
          <p>Connect Databricks or Azure ML, or ask Gotham to design a bounded ML pipeline for this project.</p>
          <div><button type="button" onClick={() => onOpenTab("providers")}>Review providers</button><button type="button" onClick={() => onOpenTab("jobs")}>Create logical job</button></div>
        </section>
      ) : null}

      {overview.activeJobs?.length ? (
        <section className="studio-work-section">
          <header><div><span>Active executions</span><h3>Running and provider-bound work</h3></div><button type="button" onClick={() => onOpenTab("jobs")}>View all jobs</button></header>
          <div className="studio-execution-list">
            {overview.activeJobs.map((job) => (
              <button type="button" className="studio-execution-row" key={job.id} onClick={() => onSelectJob(job.id)}>
                <span className={`studio-state-dot ${studioStateTone(job.logicalState)}`} />
                <span><strong>{job.id}</strong><small>{job.name}</small></span>
                <span><strong>{providerLabel(job.provider)}</strong><small>{job.currentStage || job.providerState || "Awaiting provider state"}</small></span>
                <span className={`studio-state-badge ${studioStateTone(job.logicalState)}`}>{job.logicalState}</span>
                <span><strong>{Number.isFinite(job.progress) ? `${job.progress}%` : "Progress unavailable"}</strong><small>{costLabel(job)}</small></span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {overview.attentionJobs?.length ? (
        <section className="studio-work-section attention">
          <header><div><span>Attention</span><h3>Failures and unknown provider states</h3></div></header>
          <div className="studio-execution-list">
            {overview.attentionJobs.map((job) => (
              <button type="button" className="studio-execution-row" key={job.id} onClick={() => onSelectJob(job.id)}>
                <AlertTriangle size={16} />
                <span><strong>{job.id}</strong><small>{job.name}</small></span>
                <span><strong>{providerLabel(job.provider)}</strong><small>{job.error?.summary || job.providerStatusMessage || "Inspect provider state"}</small></span>
                <span className={`studio-state-badge ${studioStateTone(job.logicalState)}`}>{job.logicalState}</span>
                <span><strong>Inspect</strong><small>Logs and timeline</small></span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="studio-overview-columns">
        <section className="studio-work-section compact">
          <header><div><span>Project pipelines</span><h3>{overview.pipelines?.length || 0} logical definitions</h3></div><button type="button" onClick={() => onOpenTab("pipelines")}>Open</button></header>
          {overview.pipelines?.length ? <ol>{overview.pipelines.slice(0, 5).map((pipeline) => <li key={pipeline.id}><strong>{pipeline.name}</strong><span>v{pipeline.version} · {providerLabel(pipeline.providerPreference)}</span></li>)}</ol> : <p>No pipelines are defined for this project.</p>}
        </section>
        <section className="studio-work-section compact">
          <header><div><span>Best evidence</span><h3>Experiment and model selection</h3></div></header>
          {overview.bestModel || overview.bestExperiment ? (
            <dl>
              <div><dt>Model</dt><dd>{overview.bestModel?.name || "No selected model"}</dd></div>
              <div><dt>Experiment</dt><dd>{overview.bestExperiment?.name || "No selected experiment"}</dd></div>
            </dl>
          ) : <p>No provider-backed experiment or model has been selected yet.</p>}
        </section>
      </div>
    </div>
  );
}
