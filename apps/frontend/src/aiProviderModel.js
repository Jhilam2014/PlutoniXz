export const TERMINAL_PROVIDER_LOGIN_STATES = new Set(["connected", "failed", "expired", "cancelled"]);

export const PROVIDER_LOGO_SOURCES = Object.freeze({
  codex: "/provider-logos/openai.svg",
  claude: "/provider-logos/anthropic.svg",
  copilot: "/provider-logos/github-copilot.svg",
  cursor: "/provider-logos/cursor.svg",
  emergent: "/provider-logos/emergent.svg"
});

export const providerLogoSource = (providerId) => PROVIDER_LOGO_SOURCES[String(providerId || "").toLowerCase()] || "";

export const providerStatusLabel = (status) => ({
  not_installed: "Not installed",
  disconnected: "Disconnected",
  starting: "Connecting",
  connecting: "Connecting",
  authorization_required: "Waiting for authorization",
  waiting_for_provider: "Waiting for authorization",
  connected: "Connected",
  expired: "Expired",
  invalid: "Verification failed",
  unsupported: "Unsupported",
  error: "Error"
}[status] || "Disconnected");

export const authMethodLabel = (method) => ({
  browser_oauth: "Browser sign-in",
  device_code: "Device authorization",
  api_token: "API token",
  existing_session: "Existing CLI session",
  enterprise_login: "Organization / SSO",
  unsupported: "Unsupported"
}[method] || method);

export function providerActions(provider, { loginSession = null } = {}) {
  if (loginSession && !TERMINAL_PROVIDER_LOGIN_STATES.has(loginSession.state)) return ["cancel_login"];
  if (!provider?.installation?.installed || !provider?.installation?.supportedVersion) return [];
  const capabilities = new Set(provider.capabilities || []);
  const actions = [];
  if (capabilities.has("login") && (provider.profiles?.length || 0) === 0) actions.push("connect");
  if (capabilities.has("login") && capabilities.has("multiple_profiles") && (provider.profiles?.length || 0) > 0) actions.push("add_profile");
  if (capabilities.has("login") && provider.activeProfile && provider.activeProfile.status !== "connected") actions.push("reconnect");
  if (provider.profiles?.length) actions.push("verify", "rename");
  if (capabilities.has("profile_switch") && (provider.profiles?.length || 0) > 1) actions.push("switch_profile");
  if (capabilities.has("token_refresh") && provider.activeProfile) actions.push("refresh");
  if (capabilities.has("logout") && provider.profiles?.some((profile) => profile.status === "connected" && profile.authMethod !== "existing_session")) actions.push("disconnect");
  if (provider.profiles?.some((profile) => profile.status !== "connected")) actions.push("remove");
  return [...new Set(actions)];
}

export function safeLoginBody({ workspaceId, authMethod, displayName, secret }) {
  const body = { workspaceId, authMethod, displayName };
  if (authMethod === "api_token") body.secret = String(secret || "");
  return body;
}

export function consumeEphemeralSecret(value, clear) {
  const ephemeral = String(value || "");
  clear("");
  return ephemeral;
}

export function defaultProviderAuthMethod(provider) {
  const selectable = (provider?.authMethods || []).filter((method) => !["existing_session", "unsupported"].includes(method));
  if (selectable.includes(provider?.preferredAuthMethod)) return provider.preferredAuthMethod;
  if (provider?.providerId === "codex" && selectable.includes("device_code")) return "device_code";
  return selectable[0] || "";
}

export function activeProviderSummary(providers, preferredProviderId = "codex") {
  const executableProviders = (providers || []).filter((item) => item.gothamExecutionSupported);
  const provider = executableProviders.find((item) => item.providerId === preferredProviderId) || executableProviders.find((item) => item.activeProfile?.status === "connected") || executableProviders[0] || null;
  return {
    providerId: provider?.providerId || preferredProviderId,
    providerName: provider?.name || "AI provider",
    profileId: provider?.activeProfile?.id || "",
    profileName: provider?.activeProfile?.displayName || "No active profile",
    valid: provider?.activeProfile?.status === "connected"
  };
}
