export const STUDIO_WORKSPACES = Object.freeze(["studio", "builder", "gotham-studio", "agentic-system", "agents", "hosting"]);
export const PROTECTED_STUDIO_WORKSPACES = Object.freeze(["builder", "gotham-studio", "agentic-system", "agents", "hosting"]);

const STUDIO_WORKSPACE_SET = new Set(STUDIO_WORKSPACES);
const PROTECTED_WORKSPACE_SET = new Set(PROTECTED_STUDIO_WORKSPACES);

export function normalizedStudioWorkspace(value = "studio") {
  const workspace = String(value || "").trim();
  return STUDIO_WORKSPACE_SET.has(workspace) ? workspace : "studio";
}

export function isProtectedStudioWorkspace(value = "") {
  return PROTECTED_WORKSPACE_SET.has(normalizedStudioWorkspace(value));
}

export function authorizedStudioWorkspace(value = "studio", currentUser = null) {
  const workspace = normalizedStudioWorkspace(value);
  return isProtectedStudioWorkspace(workspace) && !currentUser?.id ? "studio" : workspace;
}
