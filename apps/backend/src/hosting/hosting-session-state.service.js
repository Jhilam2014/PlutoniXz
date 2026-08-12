import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeLatestSession } from "./deployment-audit.service.js";

const statePath = process.env.HOSTING_SESSION_STATE_PATH || "/workspace/project/runtime/hosting-sessions.json";

function readSessions() {
  if (!fs.existsSync(statePath)) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(sessions, null, 2));
}

export function createSession() {
  const session = {
    session_id: `host_${crypto.randomUUID()}`,
    user_id: null,
    project_id: null,
    current_stage: "project_selection",
    selected_provider: null,
    selected_stack: null,
    selected_region: null,
    credential_method: null,
    credential_status: "missing",
    credential_metadata: null,
    permission_preview: null,
    deployment_plan: null,
    approval_status: "pending",
    deployment_status: "not_started",
    deployment_url: null,
    rollback_available: false,
    messages: [
      {
        id: `msg_${Date.now()}`,
        role: "assistant",
        stage: "project_selection",
        content: "Hi. I can guide this deployment step by step. Select a generated project first, then we will choose the safest hosting path.",
        created_at: new Date().toISOString()
      }
    ],
    logs: [],
    events: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const sessions = readSessions();
  sessions.unshift(session);
  writeSessions(sessions);
  writeLatestSession(session);
  return session;
}

export function getSession(sessionId) {
  return readSessions().find((session) => session.session_id === sessionId) || null;
}

export function updateSession(sessionId, updater) {
  const sessions = readSessions();
  const index = sessions.findIndex((session) => session.session_id === sessionId);
  if (index === -1) return null;
  const next = { ...sessions[index], ...updater(sessions[index]) };
  next.updated_at = new Date().toISOString();
  sessions[index] = next;
  writeSessions(sessions);
  writeLatestSession(next);
  return next;
}

export function addMessage(sessionId, role, content, stage) {
  return updateSession(sessionId, (session) => ({
    messages: [
      ...(session.messages || []),
      { id: `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`, role, stage: stage || session.current_stage, content, created_at: new Date().toISOString() }
    ]
  }));
}

export function addLog(sessionId, message, extra = {}) {
  return updateSession(sessionId, (session) => ({
    logs: [...(session.logs || []), { id: `log_${Date.now()}`, message, stage: session.current_stage, created_at: new Date().toISOString(), ...extra }]
  }));
}
