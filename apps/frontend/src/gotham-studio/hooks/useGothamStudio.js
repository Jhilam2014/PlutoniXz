import { useCallback, useEffect, useMemo, useState } from "react";
import { gothamStudioApi } from "../lib/gothamStudioApi.js";
import { STUDIO_ACTIVE_STATES } from "../lib/normalizeStudioState.js";

export function useGothamStudio({ project, active = true, initialJobId = "" } = {}) {
  const [data, setData] = useState({ overview: null, providers: [], jobs: [], pipelines: [], experiments: [], models: [] });
  const [selectedJobId, setSelectedJobId] = useState(initialJobId);
  const [jobDetail, setJobDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!project?.id || !active) return;
    if (!quiet) setLoading(true);
    try {
      const [overview, providers, jobs, pipelines, experiments, models] = await Promise.all([
        gothamStudioApi.overview(project),
        gothamStudioApi.providers(project),
        gothamStudioApi.jobs(project),
        gothamStudioApi.pipelines(project),
        gothamStudioApi.experiments(project),
        gothamStudioApi.models(project)
      ]);
      setData({ overview, providers, jobs, pipelines, experiments, models });
      setSelectedJobId((current) => jobs.some((job) => job.id === current) ? current : initialJobId && jobs.some((job) => job.id === initialJobId) ? initialJobId : jobs[0]?.id || "");
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [active, initialJobId, project?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!active || !data.jobs.some((job) => STUDIO_ACTIVE_STATES.has(job.logicalState))) return undefined;
    const timer = window.setInterval(() => load({ quiet: true }), 15_000);
    return () => window.clearInterval(timer);
  }, [active, data.jobs, load]);

  useEffect(() => {
    if (!selectedJobId || !project?.id) { setJobDetail(null); return undefined; }
    let cancelled = false;
    gothamStudioApi.job(project, selectedJobId)
      .then((result) => { if (!cancelled) setJobDetail(result); })
      .catch((detailError) => { if (!cancelled) setError(detailError.message); });
    return () => { cancelled = true; };
  }, [project?.id, selectedJobId, data.jobs]);

  const runAction = useCallback(async (label, operation) => {
    setAction(label);
    try {
      const result = await operation();
      await load({ quiet: true });
      setError("");
      return result;
    } catch (actionError) {
      // Submission can fail after the durable logical job is created. Reload so
      // Studio shows that persisted failure instead of leaving a stale draft.
      await load({ quiet: true });
      setError(actionError.message);
      throw actionError;
    } finally {
      setAction("");
    }
  }, [load]);

  const actions = useMemo(() => ({
    createJob: (input) => runAction("create-job", () => gothamStudioApi.createJob(project, input)),
    submitJob: (jobId, workflowMode) => runAction(`submit:${jobId}`, () => gothamStudioApi.submitJob(project, jobId, workflowMode)),
    refreshJob: (jobId) => runAction(`refresh:${jobId}`, () => gothamStudioApi.refreshJob(project, jobId)),
    cancelJob: (jobId) => runAction(`cancel:${jobId}`, () => gothamStudioApi.cancelJob(project, jobId)),
    retryJob: (jobId, workflowMode) => runAction(`retry:${jobId}`, () => gothamStudioApi.retryJob(project, jobId, workflowMode)),
    createPipeline: (input) => runAction("create-pipeline", () => gothamStudioApi.createPipeline(project, input)),
    verifyProvider: (providerId) => runAction(`verify:${providerId}`, () => gothamStudioApi.verifyProvider(project, providerId)),
    loadLogs: (jobId) => runAction(`logs:${jobId}`, () => gothamStudioApi.logs(project, jobId)),
    loadMetrics: (jobId) => runAction(`metrics:${jobId}`, () => gothamStudioApi.metrics(project, jobId)),
    loadArtifacts: (jobId) => runAction(`artifacts:${jobId}`, () => gothamStudioApi.artifacts(project, jobId))
  }), [project, runAction]);

  return { ...data, selectedJobId, setSelectedJobId, jobDetail, loading, error, action, refresh: load, actions };
}
