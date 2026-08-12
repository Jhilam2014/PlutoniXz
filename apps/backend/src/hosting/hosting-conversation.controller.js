import { z } from "zod";
import { listProjects, getProject } from "../projectManager.js";
import { getProvider, listProviders } from "./provider-catalog.service.js";
import { recommendStack } from "./stack-recommendation.service.js";
import { buildPermissionPreview } from "./permission-preview.service.js";
import { revokeCredential } from "./secret-vault.service.js";
import {
  approveSession,
  cancelSession,
  deploySession,
  getSession,
  onboardCredentials,
  previewPlan,
  rollbackSession,
  selectCredentialMethod,
  selectRegion,
  selectProject,
  selectProvider,
  selectStack,
  sendMessage,
  startSession
} from "./hosting-conversation.service.js";
import { appendCredentialAudit } from "./deployment-audit.service.js";
import { userFromRequest } from "../auth.js";

const MessageSchema = z.object({ message: z.string().min(1).max(1000) });
const ProjectSchema = z.object({ projectId: z.string().min(1) });
const ProviderSchema = z.object({ providerId: z.string().min(1) });
const StackSchema = z.object({ stack: z.object({}).passthrough().optional() });
const RegionSchema = z.object({ region: z.string().min(1).max(80) });
const CredentialMethodSchema = z.object({ credentialMethod: z.enum(["oidc", "oauth", "workload_identity", "manual_vault_reference"]) });
const CredentialSchema = z.object({ metadata: z.object({}).passthrough().optional(), credentialPayload: z.object({}).passthrough().optional() });

function requireSession(req, res) {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ status: "failed", error: "Hosting session not found." });
    return null;
  }
  return session;
}

export function registerHostingRoutes(app) {
  app.get("/api/hosting/projects", async (_req, res) => {
    const projects = await listProjects({ user: userFromRequest(_req) });
    res.json({ status: "ok", projects: projects.filter((project) => !project.isDefault) });
  });

  app.get("/api/hosting/providers", (_req, res) => {
    res.json({ status: "ok", providers: listProviders() });
  });

  app.post("/api/hosting/sessions", (_req, res) => {
    res.json({ status: "ok", session: startSession(), providers: listProviders() });
  });

  app.get("/api/hosting/sessions/:sessionId", (req, res) => {
    const session = requireSession(req, res);
    if (session) res.json({ status: "ok", session });
  });

  app.post("/api/hosting/sessions/:sessionId/message", (req, res) => {
    const parsed = MessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ status: "failed", error: "Message is required." });
    try {
      res.json({ status: "ok", session: sendMessage(req.params.sessionId, parsed.data.message) });
    } catch (error) {
      res.status(404).json({ status: "failed", error: error.message });
    }
  });

  app.post("/api/hosting/sessions/:sessionId/select-project", async (req, res) => {
    const parsed = ProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ status: "failed", error: "Project ID is required." });
    try {
      const project = await getProject(parsed.data.projectId, { user: userFromRequest(req) });
      if (!project) return res.status(404).json({ status: "failed", error: "Project not found." });
      res.json({ status: "ok", session: selectProject(req.params.sessionId, project) });
    } catch (error) {
      res.status(404).json({ status: "failed", error: error.message });
    }
  });

  app.post("/api/hosting/sessions/:sessionId/select-provider", (req, res) => {
    const parsed = ProviderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ status: "failed", error: "Provider ID is required." });
    res.json({ status: "ok", session: selectProvider(req.params.sessionId, getProvider(parsed.data.providerId).id) });
  });

  app.post("/api/hosting/sessions/:sessionId/select-stack", async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    const parsed = StackSchema.safeParse(req.body || {});
    const project = session.project_id ? await getProject(session.project_id, { user: userFromRequest(req) }) : {};
    res.json({ status: "ok", session: selectStack(req.params.sessionId, parsed.success ? parsed.data.stack : recommendStack(project, session.selected_provider), project) });
  });

  app.post("/api/hosting/sessions/:sessionId/select-region", (req, res) => {
    const parsed = RegionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ status: "failed", error: "Region is required." });
    res.json({ status: "ok", session: selectRegion(req.params.sessionId, parsed.data.region) });
  });

  app.post("/api/hosting/sessions/:sessionId/credential-method", (req, res) => {
    const parsed = CredentialMethodSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ status: "failed", error: "Supported credential method is required." });
    res.json({ status: "ok", session: selectCredentialMethod(req.params.sessionId, parsed.data.credentialMethod) });
  });

  app.post("/api/hosting/sessions/:sessionId/credentials", (req, res) => {
    const parsed = CredentialSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ status: "failed", error: "Credential metadata is invalid." });
    res.json({ status: "ok", session: onboardCredentials(req.params.sessionId, parsed.data.credentialPayload || parsed.data.metadata || {}) });
  });

  app.post("/api/hosting/sessions/:sessionId/preview", async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    const project = await getProject(session.project_id, { user: userFromRequest(req) });
    if (!project) return res.status(404).json({ status: "failed", error: "Project not found." });
    res.json({ status: "ok", session: previewPlan(req.params.sessionId, project) });
  });

  app.post("/api/hosting/sessions/:sessionId/approve", (req, res) => {
    res.json({ status: "ok", session: approveSession(req.params.sessionId) });
  });

  app.post("/api/hosting/sessions/:sessionId/deploy", async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    try {
      const project = await getProject(session.project_id, { user: userFromRequest(req) });
      if (!project) return res.status(404).json({ status: "failed", error: "Project not found." });
      res.json({ status: "ok", session: await deploySession(req.params.sessionId, project) });
    } catch (error) {
      res.status(400).json({ status: "failed", error: error.message });
    }
  });

  app.get("/api/hosting/sessions/:sessionId/events", (req, res) => {
    const session = requireSession(req, res);
    if (session) res.json({ status: "ok", events: session.events || [] });
  });

  app.get("/api/hosting/sessions/:sessionId/logs", (req, res) => {
    const session = requireSession(req, res);
    if (session) res.json({ status: "ok", logs: session.logs || [] });
  });

  app.post("/api/hosting/sessions/:sessionId/rollback", (req, res) => {
    try {
      res.json({ status: "ok", session: rollbackSession(req.params.sessionId) });
    } catch (error) {
      res.status(400).json({ status: "failed", error: error.message });
    }
  });

  app.post("/api/hosting/sessions/:sessionId/cancel", (req, res) => {
    res.json({ status: "ok", session: cancelSession(req.params.sessionId) });
  });

  app.delete("/api/hosting/credentials/:credentialId", (req, res) => {
    const result = revokeCredential(req.params.credentialId);
    appendCredentialAudit({ type: "credential_deleted", credential_id: req.params.credentialId, created_at: new Date().toISOString() });
    res.json({ status: "ok", credential: result });
  });
}
