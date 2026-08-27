import { z } from "zod";
import { GothamStudioError, STUDIO_JOB_STATES } from "./domain.js";
import { publicGothamStudioError } from "./gothamStudioService.js";

const scopeSchema = z.object({
  workspaceId: z.string().trim().min(1).max(180),
  projectId: z.string().trim().min(1).max(180)
});

function requestScopeInput(req) {
  return scopeSchema.parse({
    workspaceId: req.query?.workspaceId ?? req.body?.workspaceId,
    projectId: req.query?.projectId ?? req.body?.projectId
  });
}

function statusFor(error) {
  return Number(error?.status || (error instanceof z.ZodError ? 400 : 500));
}

export function registerGothamStudioRoutes(app, { service, authorize, resolveProject } = {}) {
  if (!app || !service || !authorize || !resolveProject) throw new Error("Gotham Studio routes require app, service, authorization, and project resolution.");

  const route = (method, path, permission, handler) => {
    app[method](path, async (req, res) => {
      try {
        const scopeInput = requestScopeInput(req);
        const authorization = await authorize(req, res, permission);
        if (!authorization) return;
        if (authorization.workspaceId !== "*" && authorization.workspaceId !== scopeInput.workspaceId) {
          throw new GothamStudioError("The requested Studio workspace is unavailable.", { code: "studio_scope_not_found", status: 404 });
        }
        await resolveProject(req, authorization, scopeInput);
        const scope = { tenantId: authorization.tenantId, ...scopeInput };
        const result = await handler(req, scope, authorization);
        if (!res.headersSent) res.json({ status: "ok", ...result });
      } catch (error) {
        if (!res.headersSent) res.status(statusFor(error)).json(publicGothamStudioError(error));
      }
    });
  };

  route("get", "/api/gotham-studio/overview", "read", async (_req, scope) => ({ overview: await service.overview(scope) }));
  route("get", "/api/gotham-studio/providers", "read", async (_req, scope) => ({ providers: await service.providers(scope) }));
  route("post", "/api/gotham-studio/providers/:provider/verify", "operate", async (_req, scope) => ({ provider: await service.verifyProvider(_req.params.provider, scope) }));

  route("get", "/api/gotham-studio/jobs", "read", async (req, scope) => {
    const states = String(req.query.states || "").split(",").map((item) => item.trim().toUpperCase()).filter((item) => STUDIO_JOB_STATES.includes(item));
    return { jobs: await service.repository.listJobs(scope, { states, limit: req.query.limit }) };
  });
  route("post", "/api/gotham-studio/jobs", "operate", async (req, scope, authorization) => {
    const key = String(req.get("idempotency-key") || "").trim();
    if (!key || key.length > 240) throw new GothamStudioError("A valid Idempotency-Key is required to create a Studio job.", { code: "idempotency_key_required", status: 400 });
    const job = await service.createJob(req.body || {}, scope, { idempotencyKey: key, actor: authorization.actor });
    return { job };
  });
  route("get", "/api/gotham-studio/jobs/:id", "read", async (req, scope) => ({
    job: await service.repository.getJob(req.params.id, scope),
    timeline: await service.repository.listEvents(scope, { jobId: req.params.id })
  }));
  route("post", "/api/gotham-studio/jobs/:id/submit", "operate", async (req, scope) => ({ job: await service.submitJob(req.params.id, scope, { workflowMode: req.body?.workflowMode }) }));
  route("post", "/api/gotham-studio/jobs/:id/refresh", "operate", async (req, scope) => ({ job: await service.reconcileJob(req.params.id, scope) }));
  route("post", "/api/gotham-studio/jobs/:id/cancel", "operate", async (req, scope) => ({ job: await service.cancelJob(req.params.id, scope) }));
  route("post", "/api/gotham-studio/jobs/:id/retry", "operate", async (req, scope, authorization) => {
    const key = String(req.get("idempotency-key") || "").trim();
    if (!key || key.length > 240) throw new GothamStudioError("A valid Idempotency-Key is required to retry a Studio job.", { code: "idempotency_key_required", status: 400 });
    return { job: await service.retryJob(req.params.id, scope, { workflowMode: req.body?.workflowMode, submit: req.body?.submit !== false, idempotencyKey: key, actor: authorization.actor }) };
  });
  route("get", "/api/gotham-studio/jobs/:id/logs", "read", async (req, scope) => ({ logs: await service.providerData(req.params.id, scope, "logs") }));
  route("get", "/api/gotham-studio/jobs/:id/metrics", "read", async (req, scope) => ({ metrics: await service.providerData(req.params.id, scope, "metrics") }));
  route("get", "/api/gotham-studio/jobs/:id/artifacts", "read", async (req, scope) => ({ artifacts: await service.providerData(req.params.id, scope, "artifacts") }));

  route("get", "/api/gotham-studio/pipelines", "read", async (_req, scope) => ({ pipelines: await service.repository.listPipelines(scope) }));
  route("post", "/api/gotham-studio/pipelines", "operate", async (req, scope) => ({ pipeline: await service.createPipeline(req.body || {}, scope) }));
  route("get", "/api/gotham-studio/pipelines/:id", "read", async (req, scope) => ({ pipeline: await service.repository.getPipeline(req.params.id, scope) }));
  route("get", "/api/gotham-studio/experiments", "read", async (_req, scope) => ({ experiments: await service.repository.listExperiments(scope) }));
  route("get", "/api/gotham-studio/models", "read", async (_req, scope) => ({ models: await service.repository.listModels(scope) }));
}
