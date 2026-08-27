import { authFetch } from "../../authClient.js";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";

function scope(project) {
  const projectId = String(project?.id || "").trim();
  if (!projectId) throw new Error("Select a project before opening Gotham Studio.");
  return { workspaceId: projectId, projectId };
}

function query(project, extra = {}) {
  return new URLSearchParams({ ...scope(project), ...extra }).toString();
}

async function request(path, options = {}) {
  const response = await authFetch(`${BACKEND_URL}${path}`, options);
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || "Gotham Studio request failed.");
    error.code = data.code || "gotham_studio_request_failed";
    error.status = response.status;
    error.retryable = Boolean(data.retryable);
    throw error;
  }
  return data;
}

function jsonOptions(method, body, headers = {}) {
  return { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}

export const gothamStudioApi = {
  overview: (project) => request(`/api/gotham-studio/overview?${query(project)}`).then((data) => data.overview),
  providers: (project) => request(`/api/gotham-studio/providers?${query(project)}`).then((data) => data.providers || []),
  verifyProvider: (project, providerId) => request(`/api/gotham-studio/providers/${encodeURIComponent(providerId)}/verify`, jsonOptions("POST", scope(project))).then((data) => data.provider),
  jobs: (project) => request(`/api/gotham-studio/jobs?${query(project)}`).then((data) => data.jobs || []),
  job: (project, jobId) => request(`/api/gotham-studio/jobs/${encodeURIComponent(jobId)}?${query(project)}`),
  createJob: (project, input) => request("/api/gotham-studio/jobs", jsonOptions("POST", { ...scope(project), ...input }, { "Idempotency-Key": crypto.randomUUID() })).then((data) => data.job),
  submitJob: (project, jobId, workflowMode) => request(`/api/gotham-studio/jobs/${encodeURIComponent(jobId)}/submit`, jsonOptions("POST", { ...scope(project), workflowMode })).then((data) => data.job),
  refreshJob: (project, jobId) => request(`/api/gotham-studio/jobs/${encodeURIComponent(jobId)}/refresh`, jsonOptions("POST", scope(project))).then((data) => data.job),
  cancelJob: (project, jobId) => request(`/api/gotham-studio/jobs/${encodeURIComponent(jobId)}/cancel`, jsonOptions("POST", scope(project))).then((data) => data.job),
  retryJob: (project, jobId, workflowMode) => request(`/api/gotham-studio/jobs/${encodeURIComponent(jobId)}/retry`, jsonOptions("POST", { ...scope(project), workflowMode, submit: true }, { "Idempotency-Key": crypto.randomUUID() })).then((data) => data.job),
  logs: (project, jobId) => request(`/api/gotham-studio/jobs/${encodeURIComponent(jobId)}/logs?${query(project)}`).then((data) => data.logs),
  metrics: (project, jobId) => request(`/api/gotham-studio/jobs/${encodeURIComponent(jobId)}/metrics?${query(project)}`).then((data) => data.metrics || []),
  artifacts: (project, jobId) => request(`/api/gotham-studio/jobs/${encodeURIComponent(jobId)}/artifacts?${query(project)}`).then((data) => data.artifacts || []),
  pipelines: (project) => request(`/api/gotham-studio/pipelines?${query(project)}`).then((data) => data.pipelines || []),
  createPipeline: (project, input) => request("/api/gotham-studio/pipelines", jsonOptions("POST", { ...scope(project), ...input })).then((data) => data.pipeline),
  experiments: (project) => request(`/api/gotham-studio/experiments?${query(project)}`).then((data) => data.experiments || []),
  models: (project) => request(`/api/gotham-studio/models?${query(project)}`).then((data) => data.models || [])
};
