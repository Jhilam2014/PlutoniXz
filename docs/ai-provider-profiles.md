# Gotham Chat AI provider profiles

> Generated from `apps/backend/src/aiProviders/metadata.js` by `npm run ai-providers:docs`. Do not edit the capability matrix by hand.

Gotham Chat's **AI Accounts** panel detects the installed OpenAI Codex, Anthropic Claude Code, GitHub Copilot, Cursor, and Emergent command-line tools. Authentication and profile actions appear only when the installed adapter/version declares them. The panel never asks for a provider password.

## Capability matrix

| Provider | Minimum compatible version | Authentication methods | Login | Logout | Multiple profiles | Profile switch | Refresh | Usage | Models | Gotham execution |
|---|---:|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| OpenAI Codex | 0.1.0 | device code, browser oauth, api token, existing session | Yes | Yes | Yes | Yes | — | — | — | Yes |
| Anthropic Claude Code | 2.1.248 | browser oauth, enterprise login, existing session | Yes | Yes | Yes | Yes | — | — | — | Yes |
| GitHub Copilot | 0.0.300 | browser oauth, device code, api token | Yes | — | Yes | Yes | — | — | — | — |
| Cursor CLI | 2025.08.01 | browser oauth, existing session | Yes | Yes | — | — | — | — | — | — |
| Emergent CLI | Detect only | unsupported | — | — | — | — | — | — | — | — |

The minimum versions are compatibility-policy floors, not a promise that an untested future CLI remains compatible. Installation/version detection is always available. Emergent remains detection-only because no stable official Emergent AI CLI authentication/profile contract has been identified. Cursor login/status/logout are supported, but multiple profiles are not: Cursor's public CLI documentation does not define a safe profile-home or switching contract. GitHub Copilot's documented non-interactive login methods are available, but the adapter does not invent a logout/status command that the CLI reference does not expose.

OpenAI Codex and Anthropic Claude Code advertise hardened Gotham workspace execution contracts. Other connected accounts can be managed in the central panel but cannot be selected for a Gotham job until their execution, sandbox, and event contracts are separately approved.

## Installation and login

The backend image installs the pinned `@openai/codex` version selected by `CODEX_VERSION` and `@anthropic-ai/claude-code@2.1.251` by default through `CLAUDE_VERSION`. The image build fails unless both `codex --version` and `claude --version` succeed. A host deployment may install the same CLIs itself and optionally set an approved executable variable: `CODEX_BIN`, `CLAUDE_BIN`, `COPILOT_BIN`, `CURSOR_AGENT_BIN`, or `EMERGENT_BIN`. A configured path is accepted only when its basename matches the adapter's executable allowlist; browser input cannot choose an executable or add arguments.

Open Gotham Builder → **AI Accounts**. Existing documented CLI sessions are discovered with the provider's status command. Choose **Connect** or **Add profile** for an advertised method. Browser/device flows show only a validated HTTPS destination on the provider domain. Device codes and authorization URLs live only in the expiring in-memory login session and disappear on completion, cancellation, or expiry.

Claude Code sign-in uses its documented browser flow or organization SSO flow from **AI Accounts**. The backend owns the CLI process; neither execution nor authentication depends on VS Code or the Claude Code VS Code extension. No real provider account is used by automated tests.

For a Docker or headless backend, keep `AI_PROVIDER_CODEX_BROWSER_CALLBACK_AVAILABLE=false`. The standard Codex browser flow redirects to `localhost:1455`; that address belongs to the user's browser host and cannot reach a loopback listener inside the backend container. Gotham therefore advertises device-code authorization as the preferred Codex method and does not offer browser OAuth in that topology. Set the option to `true` only when an operator has explicitly routed that callback to the Codex process. Device-code login may first need to be enabled in the user's ChatGPT security settings or by a workspace administrator.

API-token login is shown only for adapters with an official stdin-based command. The browser clears the input before waiting for the request. The backend writes it once to the CLI's stdin, drops the reference, and never includes it in a response, log, database row, audit event, prompt, analytics event, or frontend storage.

## Isolation, selection, and running jobs

Codex uses profile-specific `CODEX_HOME`, Claude Code uses `CLAUDE_CONFIG_DIR`, and GitHub Copilot uses `COPILOT_HOME`. Directories live under `AI_PROVIDER_RUNTIME_ROOT`, are derived from hashed tenant/principal IDs plus a stable internal profile ID, and are created mode `0700`. The application process's `HOME` is never reassigned. Cursor remains a single provider-owned session because isolation is not documented. Docker persists `AI_PROVIDER_RUNTIME_ROOT` through the existing narrow `runtime` mount; it does not mount the host's full home or `~/.claude`.

Every provider may have an explicit global default and an optional workspace override. Activation verifies the target before the repository commits the atomic switch. A failed verification preserves the prior profile. Each Gotham job freezes a safe runtime selection at creation; switching later affects future jobs only.

Claude runs headlessly with `--restricted`, a backend-owned settings document, a fixed allowlist of Read/Glob/Grep/Edit/Write/Bash tools for write mode, and no session persistence. Read-only review omits Edit/Write and denies workspace writes. The settings require the sandbox, fail closed if it is unavailable, disallow unsandboxed commands, protect the selected `CLAUDE_CONFIG_DIR`, and remove credential environment variables from Bash subprocesses. The Linux runtime requires both Bubblewrap and `socat`; the backend image installs both while retaining Codex's existing Bubblewrap setup. PlutoMix does not use `--dangerously-skip-permissions` or `bypassPermissions`.

## Persistence and secrets

Production requires PostgreSQL through `AI_PROVIDER_DATABASE_URL` (or the existing Decision Continuity/database URL) and migration `013_ai_provider_profiles.sql`. Development may use the mode-`0600` atomic JSON metadata file configured by `AI_PROVIDER_PROFILE_STORE`. Both stores contain only display metadata and opaque `provider-runtime://…` references. Provider-owned CLI storage or an OS keychain holds credentials; PlutoMix never reads or mutates undocumented credential files.

The CLI subprocess receives a least-privilege environment. App database passwords and unrelated service tokens are removed. Existing-session imports may retain only that provider's documented environment credential variable. Sanitized audit events record user, workspace, provider, internal profile, fingerprint, result, time, and failure category—never command output, device codes, credential paths, or authorization URLs.

## Workspace authorization and API behavior

All `/api/ai-providers` endpoints require an authenticated human PlutoMix principal, active tenant/workspace membership, and the existing read/operate permissions. Mutations enforce the configured origin allowlist, per-principal rate limits, ownership by tenant/principal scope, and bounded request schemas. Activation/cancellation are idempotent. Login mutation sessions expire after ten minutes by default and terminate their CLI child with TERM followed by KILL if needed.

## Troubleshooting

- **Not installed:** install the CLI in the backend execution environment or configure its approved `*_BIN` path, then use Refresh.
- **Unsupported version:** upgrade to the matrix floor or later and refresh detection.
- **Claude authentication required:** open **AI Accounts**, reconnect the isolated profile with browser sign-in or organization SSO, and open the approved verification page. When Claude displays a one-time authorization code, paste it only into the protected **Authorization code** field; PlutoMix sends it directly to the waiting CLI without saving it. Then run **Verify profile**. Do not paste authorization material into logs or tickets.
- **Claude sandbox unavailable:** rebuild the backend image and verify both `bwrap --version` (or the bundled Codex Bubblewrap help check) and `socat -V` inside it. Keep the Compose sandbox security boundary intact; do not disable restricted mode.
- **Claude timeout:** inspect the sanitized activity timeline, reduce the task scope, or adjust the bounded `CLAUDE_WORKFLOW_TIMEOUT_MS` and `CLAUDE_WORKFLOW_MAX_TURNS` server settings. A timeout terminates the child and is not sent to project-code repair.
- **Claude profile expired:** reconnect that local profile and verify it before retrying. The failed job retains its frozen profile reference and does not switch accounts automatically.
- **Waiting for authorization:** allow popups or use **Open verification page**; for device login, copy the current one-time code.
- **Codex localhost:1455 is unavailable:** the browser flow was launched from a remote/container runtime. Cancel it and use **Device authorization**. Do not copy OAuth callback URLs or codes into logs or tickets.
- **Expired/cancelled:** start a new login. Old codes and URLs are not retained.
- **Verification failed:** reconnect or keep the current active profile. The failed target is never activated.
- **Profile isolation unsupported:** disconnect the existing local Cursor session before reconnecting; no private files are copied.
- **Production metadata unavailable:** apply migration 013 and configure `AI_PROVIDER_DATABASE_URL`.

Disconnect removes an isolated provider's local CLI session when a documented logout exists. A shared imported existing session cannot be logged out through a principal-scoped record. Disconnect never claims remote revocation; revoke remote grants in the provider's own security settings when required.

## Adding an adapter

1. Add one canonical metadata entry with executable names, minimum version, fixed argv arrays, approved HTTPS domains, isolation variable, auth methods, and honest capabilities.
2. Use only documented commands. Never parse or modify private credential files, accept frontend executable paths/arguments, or construct a shell string.
3. Implement verification and challenge parsing through `CliProviderAdapter`; keep raw output bounded and redacted.
4. Add mocked detection, login, cancellation, expiry, URL, redaction, isolation, activation, and secret-absence tests.
5. Regenerate this document. The API and UI automatically consume the same metadata.

## Primary CLI references

- OpenAI Codex authentication: <https://learn.chatgpt.com/docs/auth>
- OpenAI Codex CLI commands: <https://learn.chatgpt.com/docs/developer-commands?surface=cli>
- Claude Code CLI reference: <https://code.claude.com/docs/en/cli-usage>
- Claude Code environment variables: <https://code.claude.com/docs/en/env-vars>
- Claude Code sandboxing: <https://code.claude.com/docs/en/sandboxing>
- GitHub Copilot CLI authentication: <https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli>
- Cursor CLI authentication: <https://docs.cursor.com/en/cli/reference/authentication>
