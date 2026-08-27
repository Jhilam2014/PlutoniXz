import { ArrowLeft, Beaker, Boxes, BriefcaseBusiness, CloudCog, Gauge, GitBranch, Loader2, MessageSquareText, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import GothamStudioExperiments from "./GothamStudioExperiments.jsx";
import GothamStudioJobs from "./GothamStudioJobs.jsx";
import GothamStudioModels from "./GothamStudioModels.jsx";
import GothamStudioOverview from "./GothamStudioOverview.jsx";
import GothamStudioPipelines from "./GothamStudioPipelines.jsx";
import GothamStudioProviders from "./GothamStudioProviders.jsx";
import { useGothamStudio } from "./hooks/useGothamStudio.js";
import "./GothamStudio.css";

const tabs = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "jobs", label: "Jobs", icon: BriefcaseBusiness },
  { id: "pipelines", label: "Pipelines", icon: GitBranch },
  { id: "experiments", label: "Experiments", icon: Beaker },
  { id: "models", label: "Models", icon: Boxes },
  { id: "providers", label: "Providers / Setup", icon: CloudCog }
];

export default function GothamStudio({ project, workflowMode, initialJobId = "", initialTab = "", onBack, onAskGotham, onOpenFunctionality }) {
  const [activeTab, setActiveTab] = useState(initialJobId ? "jobs" : initialTab || "overview");
  const [command, setCommand] = useState("");
  const studio = useGothamStudio({ project, initialJobId });

  useEffect(() => {
    if (!initialJobId) return;
    studio.setSelectedJobId(initialJobId);
    setActiveTab("jobs");
  }, [initialJobId]);

  useEffect(() => {
    if (initialJobId || !tabs.some((tab) => tab.id === initialTab)) return;
    setActiveTab(initialTab);
  }, [initialJobId, initialTab]);

  function ask(event) {
    event.preventDefault();
    const prompt = command.trim();
    if (!prompt) return;
    onAskGotham(prompt, {
      selectedJobId: studio.selectedJobId,
      selectedPipelineId: studio.jobDetail?.job?.pipelineId || "",
      selectedFunctionalityId: studio.jobDetail?.job?.functionalityId || ""
    });
    setCommand("");
  }

  function selectJob(jobId) {
    studio.setSelectedJobId(jobId);
    setActiveTab("jobs");
  }

  return (
    <main className="gotham-studio-workspace">
      <header className="gotham-studio-header">
        <div className="gotham-studio-heading"><button type="button" onClick={onBack} aria-label="Back to Gotham Chat"><ArrowLeft size={17} /><span>Gotham Chat</span></button><span className="gotham-studio-mark"><Beaker size={18} /></span><div><span>Gotham Builder · active workspace</span><h1>Gotham Studio</h1><p>{project?.name || "Select a project"} · governed AI/ML execution control plane</p></div></div>
        <div className="gotham-studio-header-actions"><span className={`studio-mode-chip ${workflowMode}`}>{workflowMode === "executor" ? "Executor can submit" : `${workflowMode} proposal-only`}</span><button type="button" onClick={() => studio.refresh()} disabled={studio.loading}><RefreshCcw size={14} />Refresh</button></div>
      </header>
      <nav className="gotham-studio-tabs" aria-label="Gotham Studio views">{tabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)} aria-selected={activeTab === tab.id}><Icon size={15} />{tab.label}</button>; })}</nav>
      <form className="gotham-studio-command" onSubmit={ask}><MessageSquareText size={17} /><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Ask Gotham about this ML workspace…" aria-label="Ask Gotham about this ML workspace" /><button type="submit" disabled={!command.trim()}>Ask in Builder</button></form>
      {studio.error ? <div className="gotham-studio-error" role="alert"><strong>Studio request failed</strong><span>{studio.error}</span><button type="button" onClick={() => studio.refresh()}>Retry read</button></div> : null}
      {!project?.id ? <section className="gotham-studio-empty primary"><BriefcaseBusiness size={26} /><h3>Select a project</h3><p>Gotham Studio data is isolated to a project workspace.</p><button type="button" onClick={onBack}>Return to Builder</button></section> : studio.loading && !studio.overview ? <section className="gotham-studio-empty"><Loader2 className="spin" size={22} /><h3>Loading Studio control plane</h3></section> : <div className="gotham-studio-body">
        {activeTab === "overview" ? <GothamStudioOverview overview={studio.overview} onSelectJob={selectJob} onOpenTab={setActiveTab} /> : null}
        {activeTab === "jobs" ? <GothamStudioJobs jobs={studio.jobs} pipelines={studio.pipelines} providers={studio.providers} selectedJobId={studio.selectedJobId} setSelectedJobId={studio.setSelectedJobId} jobDetail={studio.jobDetail} workflowMode={workflowMode} action={studio.action} actions={studio.actions} onAskGotham={onAskGotham} onOpenFunctionality={onOpenFunctionality} /> : null}
        {activeTab === "pipelines" ? <GothamStudioPipelines pipelines={studio.pipelines} providers={studio.providers} action={studio.action} actions={studio.actions} /> : null}
        {activeTab === "experiments" ? <GothamStudioExperiments experiments={studio.experiments} /> : null}
        {activeTab === "models" ? <GothamStudioModels models={studio.models} /> : null}
        {activeTab === "providers" ? <GothamStudioProviders providers={studio.providers} action={studio.action} actions={studio.actions} /> : null}
      </div>}
    </main>
  );
}
