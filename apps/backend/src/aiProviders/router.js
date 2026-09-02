import { z } from "zod";
import { AUTH_METHODS, PROVIDER_IDS } from "./metadata.js";
import { ProviderAdapterError } from "./adapters.js";
import { ProviderProfileError } from "./service.js";

const ProviderId = z.enum(PROVIDER_IDS);
const LoginBody = z.object({
  workspaceId: z.string().min(1).max(160).optional(),
  authMethod: z.enum(AUTH_METHODS),
  displayName: z.string().min(2).max(80).optional(),
  secret: z.string().min(1).max(16_384).optional()
}).strict();
const LoginAuthorizationBody = z.object({
  workspaceId: z.string().min(1).max(160).optional(),
  authorizationCode: z.string().trim().min(4).max(4096).regex(/^[^\s\u0000-\u001f\u007f]+$/)
}).strict();
const ActivationBody = z.object({ workspaceId: z.string().min(1).max(160).optional(), scope: z.enum(["global", "workspace"]).default("global") }).strict();
const WorkspaceBody = z.object({ workspaceId: z.string().min(1).max(160).optional() }).strict();
const RenameBody = z.object({ workspaceId: z.string().min(1).max(160).optional(), displayName: z.string().min(2).max(80) }).strict();

class FixedWindowRateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  take(key, { limit, windowMs }) {
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    if (bucket.count > limit) throw new ProviderProfileError("Too many provider operations. Wait briefly, then retry.", { code: "provider_rate_limited", status: 429, category: "provider_rate_limited", recovery: ["Retry"] });
  }
}

function providerError(res, rawError) {
  const authorizationError = ["AuthenticationError", "AuthorizationError"].includes(rawError?.name);
  const known = rawError instanceof ProviderProfileError || rawError instanceof ProviderAdapterError || rawError instanceof z.ZodError || authorizationError;
  const status = rawError instanceof z.ZodError ? 400 : known ? rawError.status || 400 : 500;
  return res.status(status).json({
    status: "failed",
    code: rawError instanceof z.ZodError ? "invalid_request" : known ? rawError.code : "provider_operation_failed",
    error: rawError instanceof z.ZodError ? "The provider request is invalid." : authorizationError ? "The requested provider resource is unavailable." : known ? rawError.message : "The provider operation could not be completed.",
    failureCategory: known && !(rawError instanceof z.ZodError) ? rawError.category : "provider_error",
    recovery: known && !(rawError instanceof z.ZodError) ? rawError.recovery || [] : ["Retry"]
  });
}

function assertMutationOrigin(req, env) {
  const fetchSite = String(req.get("sec-fetch-site") || "").toLowerCase();
  const origin = String(req.get("origin") || "").trim();
  if (!origin) {
    if (fetchSite === "cross-site") throw new ProviderProfileError("Cross-site provider mutations are not allowed.", { code: "csrf_rejected", status: 403, category: "authorization_denied" });
    return;
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new ProviderProfileError("The request origin is invalid.", { code: "csrf_rejected", status: 403, category: "authorization_denied" });
  }
  const configured = new Set(String(env.PLUTOMIX_CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean));
  const developmentLocal = String(env.NODE_ENV || "").toLowerCase() !== "production" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (!configured.has(parsed.origin) && !developmentLocal) throw new ProviderProfileError("The request origin is not authorized.", { code: "csrf_rejected", status: 403, category: "authorization_denied" });
}

function requestScope(authorization, req) {
  return {
    tenantId: authorization.tenantId,
    principalId: authorization.principal.id,
    workspaceId: String(req.body?.workspaceId || req.query?.workspaceId || authorization.workspaceId || "*")
  };
}

export function registerAiProviderRoutes(app, {
  service,
  authorize,
  env = process.env,
  readPermission,
  operatePermission
} = {}) {
  if (!service || typeof authorize !== "function") throw new Error("AI provider routes require a service and authorization callback.");
  const limiter = new FixedWindowRateLimiter();
  const handler = (operation, work, { mutation = false, login = false } = {}) => async (req, res) => {
    try {
      if (mutation) assertMutationOrigin(req, env);
      const authorization = await authorize(req, mutation ? operatePermission : readPermission, `ai_provider.${operation}`);
      const key = `${authorization.tenantId}:${authorization.principal.id}:${operation}`;
      limiter.take(key, login ? { limit: 5, windowMs: 10 * 60 * 1000 } : mutation ? { limit: 30, windowMs: 60 * 1000 } : { limit: 120, windowMs: 60 * 1000 });
      const providerId = req.params.providerId ? ProviderId.parse(req.params.providerId) : null;
      return await work(req, res, requestScope(authorization, req), providerId);
    } catch (error) {
      return providerError(res, error);
    }
  };

  app.get("/api/ai-providers", handler("list", async (req, res, scope) => {
    const providers = await service.overview(scope, { refresh: req.query.refresh === "true" });
    res.json({ status: "ok", workspaceId: scope.workspaceId, providers });
  }));

  app.get("/api/ai-providers/:providerId/profiles", handler("profiles.list", async (req, res, scope, providerId) => {
    res.json({ status: "ok", providerId, profiles: await service.listProfiles(scope, providerId) });
  }));

  app.post("/api/ai-providers/:providerId/login", handler("login.start", async (req, res, scope, providerId) => {
    const input = LoginBody.parse(req.body || {});
    try {
      const session = await service.beginLogin(scope, providerId, input);
      // The secret is intentionally absent from both this response and every
      // persisted profile/session representation.
      res.status(202).json({ status: "accepted", session });
    } finally {
      input.secret = undefined;
      if (req.body && Object.hasOwn(req.body, "secret")) req.body.secret = undefined;
    }
  }, { mutation: true, login: true }));

  app.get("/api/ai-providers/:providerId/login/:sessionId", handler("login.status", async (req, res, scope, providerId) => {
    res.json({ status: "ok", session: service.getLoginStatus(scope, providerId, req.params.sessionId) });
  }));

  app.post("/api/ai-providers/:providerId/login/:sessionId/authorize", handler("login.authorize", async (req, res, scope, providerId) => {
    const input = LoginAuthorizationBody.parse(req.body || {});
    try {
      res.json({ status: "ok", session: await service.submitLoginAuthorization(scope, providerId, req.params.sessionId, input.authorizationCode) });
    } finally {
      input.authorizationCode = undefined;
      if (req.body && Object.hasOwn(req.body, "authorizationCode")) req.body.authorizationCode = undefined;
    }
  }, { mutation: true, login: true }));

  app.post("/api/ai-providers/:providerId/login/:sessionId/cancel", handler("login.cancel", async (req, res, scope, providerId) => {
    WorkspaceBody.parse(req.body || {});
    res.json({ status: "ok", session: await service.cancelLogin(scope, providerId, req.params.sessionId) });
  }, { mutation: true }));

  app.post("/api/ai-providers/:providerId/profiles/:profileId/verify", handler("profile.verify", async (req, res, scope, providerId) => {
    WorkspaceBody.parse(req.body || {});
    res.json({ status: "ok", profile: await service.verifyProfile(scope, providerId, req.params.profileId) });
  }, { mutation: true }));

  app.post("/api/ai-providers/:providerId/profiles/:profileId/activate", handler("profile.activate", async (req, res, scope, providerId) => {
    const input = ActivationBody.parse(req.body || {});
    res.json({ status: "ok", activation: await service.activateProfile(scope, providerId, req.params.profileId, input) });
  }, { mutation: true }));

  app.patch("/api/ai-providers/:providerId/profiles/:profileId", handler("profile.rename", async (req, res, scope, providerId) => {
    const input = RenameBody.parse(req.body || {});
    res.json({ status: "ok", profile: await service.renameProfile(scope, providerId, req.params.profileId, input.displayName) });
  }, { mutation: true }));

  app.post("/api/ai-providers/:providerId/profiles/:profileId/logout", handler("profile.logout", async (req, res, scope, providerId) => {
    WorkspaceBody.parse(req.body || {});
    res.json({ status: "ok", ...(await service.logoutProfile(scope, providerId, req.params.profileId)) });
  }, { mutation: true }));

  app.delete("/api/ai-providers/:providerId/profiles/:profileId", handler("profile.remove", async (req, res, scope, providerId) => {
    WorkspaceBody.parse(req.body || {});
    res.json({ status: "ok", ...(await service.removeProfile(scope, providerId, req.params.profileId)) });
  }, { mutation: true }));
}

export { assertMutationOrigin, FixedWindowRateLimiter, providerError };
