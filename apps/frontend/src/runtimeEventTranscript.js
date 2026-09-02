function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

const PROVIDER_EVENT_KIND = Object.freeze({
  "provider-start": "start",
  "provider-runtime-verified": "verified",
  "provider-progress": "progress",
  "provider-command": "command",
  "provider-file-change": "file-change",
  "provider-complete": "completion",
  "provider-failure": "failure",
  "codex-start": "start",
  "codex-thread-started": "start",
  "codex-running": "progress",
  "codex-message": "progress",
  "codex-progress": "progress",
  "codex-command": "command",
  "codex-file-change": "file-change",
  "codex-turn-completed": "progress",
  "codex-complete": "completion",
  "codex-failed": "failure",
  "claude-started": "start",
  "claude-progress": "progress",
  "claude-retry": "progress",
  "claude-response": "progress",
  "claude-tool": "command",
  "claude-tool-result": "command",
  "claude-completed": "completion",
  "claude-failed": "failure",
  "gotham-runtime-verified": "verified"
});

export function runtimeEventPresentation(event = {}) {
  const type = String(event.type || "");
  const providerId = String(event.providerId || (type.startsWith("claude-") ? "claude" : type.startsWith("codex-") ? "codex" : "")).toLowerCase();
  const kind = PROVIDER_EVENT_KIND[type] || (type.endsWith("malformed-event") ? "progress" : "");
  return {
    providerId,
    providerLabel: providerId === "claude" ? "Claude Code" : providerId === "codex" ? "OpenAI Codex" : providerId ? "Gotham provider" : "",
    kind,
    isProviderRuntime: Boolean(kind)
  };
}

export const isProviderRuntimeEvent = (event) => runtimeEventPresentation(event).isProviderRuntime;

// Runtime status events are not model turns. Keeping their message separate
// prevents a failure reason from being displayed as both a request and reply.
export function runtimeEventTranscript(event = {}) {
  const inputLog = firstText(event.agentInput, event.instruction, event.sourceInstruction);
  const responseLog = firstText(event.agentResponse, event.outputTail, event.result?.message);
  const message = firstText(event.message);
  const statusLog = message && message !== inputLog && message !== responseLog ? message : "";
  return { inputLog, responseLog, statusLog };
}
