export const PROVIDER_IDS = Object.freeze(["codex", "claude", "copilot", "cursor", "emergent"]);

export const PROVIDER_CAPABILITIES = Object.freeze([
  "login",
  "logout",
  "multiple_profiles",
  "profile_switch",
  "token_refresh",
  "usage",
  "model_discovery"
]);

export const AUTH_METHODS = Object.freeze([
  "browser_oauth",
  "device_code",
  "api_token",
  "existing_session",
  "enterprise_login",
  "unsupported"
]);

// This is the canonical compatibility definition used by the adapters, API,
// Gotham Chat, tests, and the generated documentation matrix. Every command is
// a fixed argv array; client input is never interpolated into an executable or
// argument list.
export const PROVIDER_DEFINITIONS = Object.freeze({
  codex: Object.freeze({
    providerId: "codex",
    name: "OpenAI Codex",
    icon: "openai",
    executableNames: Object.freeze(["codex"]),
    configuredExecutableEnv: "CODEX_BIN",
    versionArgs: Object.freeze(["--version"]),
    minimumVersion: "0.1.0",
    authDomains: Object.freeze(["auth.openai.com", "chatgpt.com", "platform.openai.com"]),
    isolationEnv: "CODEX_HOME",
    commands: Object.freeze({
      status: Object.freeze(["login", "status"]),
      browser_oauth: Object.freeze(["login"]),
      device_code: Object.freeze(["login", "--device-auth"]),
      api_token: Object.freeze(["login", "--with-api-key"]),
      logout: Object.freeze(["logout"])
    }),
    authMethods: Object.freeze(["device_code", "browser_oauth", "api_token", "existing_session"]),
    capabilities: Object.freeze(["login", "logout", "multiple_profiles", "profile_switch"]),
    supportsIsolatedProfiles: true,
    gothamExecutionSupported: true,
    verification: "status_command",
    authMode: "secure_chatgpt",
    notes: "ChatGPT device authorization is preferred for container or headless runtimes; browser OAuth requires a reachable localhost:1455 callback. API-key login is also supported."
  }),
  claude: Object.freeze({
    providerId: "claude",
    name: "Anthropic Claude Code",
    icon: "anthropic",
    executableNames: Object.freeze(["claude"]),
    configuredExecutableEnv: "CLAUDE_BIN",
    versionArgs: Object.freeze(["--version"]),
    minimumVersion: "2.1.248",
    authDomains: Object.freeze(["claude.com", "claude.ai", "console.anthropic.com", "anthropic.com"]),
    isolationEnv: "CLAUDE_CONFIG_DIR",
    commands: Object.freeze({
      status: Object.freeze(["auth", "status"]),
      browser_oauth: Object.freeze(["auth", "login"]),
      enterprise_login: Object.freeze(["auth", "login", "--sso"]),
      logout: Object.freeze(["auth", "logout"])
    }),
    authMethods: Object.freeze(["browser_oauth", "enterprise_login", "existing_session"]),
    capabilities: Object.freeze(["login", "logout", "multiple_profiles", "profile_switch"]),
    supportsIsolatedProfiles: true,
    gothamExecutionSupported: true,
    verification: "status_command",
    authMode: "browser_oauth",
    notes: "CLAUDE_CONFIG_DIR is the documented isolation mechanism for side-by-side accounts."
  }),
  copilot: Object.freeze({
    providerId: "copilot",
    name: "GitHub Copilot",
    icon: "github",
    executableNames: Object.freeze(["copilot"]),
    configuredExecutableEnv: "COPILOT_BIN",
    versionArgs: Object.freeze(["--version"]),
    minimumVersion: "0.0.300",
    authDomains: Object.freeze(["github.com"]),
    isolationEnv: "COPILOT_HOME",
    commands: Object.freeze({
      browser_oauth: Object.freeze(["login", "--web-flow"]),
      device_code: Object.freeze(["login", "--device-code"]),
      api_token: Object.freeze(["login", "--with-token"])
    }),
    authMethods: Object.freeze(["browser_oauth", "device_code", "api_token"]),
    capabilities: Object.freeze(["login", "multiple_profiles", "profile_switch"]),
    supportsIsolatedProfiles: true,
    gothamExecutionSupported: false,
    verification: "login_process",
    authMode: "github_oauth",
    notes: "COPILOT_HOME isolates local profiles. The public CLI has no documented non-interactive logout/status command."
  }),
  cursor: Object.freeze({
    providerId: "cursor",
    name: "Cursor CLI",
    icon: "cursor",
    executableNames: Object.freeze(["cursor-agent", "agent"]),
    configuredExecutableEnv: "CURSOR_AGENT_BIN",
    versionArgs: Object.freeze(["--version"]),
    minimumVersion: "2025.08.01",
    authDomains: Object.freeze(["cursor.com", "cursor.sh"]),
    isolationEnv: "",
    commands: Object.freeze({
      status: Object.freeze(["status"]),
      browser_oauth: Object.freeze(["login"]),
      logout: Object.freeze(["logout"])
    }),
    authMethods: Object.freeze(["browser_oauth", "existing_session"]),
    capabilities: Object.freeze(["login", "logout"]),
    supportsIsolatedProfiles: false,
    gothamExecutionSupported: false,
    verification: "status_command",
    authMode: "browser_oauth",
    notes: "Cursor documents login/status/logout, but no stable profile-home or profile-switch contract."
  }),
  emergent: Object.freeze({
    providerId: "emergent",
    name: "Emergent CLI",
    icon: "emergent",
    executableNames: Object.freeze(["emergent"]),
    configuredExecutableEnv: "EMERGENT_BIN",
    versionArgs: Object.freeze(["--version"]),
    minimumVersion: "",
    authDomains: Object.freeze([]),
    isolationEnv: "",
    commands: Object.freeze({}),
    authMethods: Object.freeze(["unsupported"]),
    capabilities: Object.freeze([]),
    supportsIsolatedProfiles: false,
    gothamExecutionSupported: false,
    verification: "unsupported",
    authMode: "unsupported",
    notes: "No stable official Emergent AI CLI authentication/profile contract is currently documented."
  })
});

export function providerDefinition(providerId) {
  return PROVIDER_DEFINITIONS[String(providerId || "").toLowerCase()] || null;
}

export function publicProviderDefinition(definition) {
  return {
    providerId: definition.providerId,
    name: definition.name,
    icon: definition.icon,
    minimumVersion: definition.minimumVersion,
    authMethods: [...definition.authMethods],
    capabilities: [...definition.capabilities],
    supportsIsolatedProfiles: definition.supportsIsolatedProfiles,
    gothamExecutionSupported: definition.gothamExecutionSupported,
    notes: definition.notes
  };
}

export function capabilityMatrix() {
  return PROVIDER_IDS.map((providerId) => publicProviderDefinition(PROVIDER_DEFINITIONS[providerId]));
}
