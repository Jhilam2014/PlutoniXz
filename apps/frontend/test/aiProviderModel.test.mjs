import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { activeProviderSummary, consumeEphemeralSecret, defaultProviderAuthMethod, freezeProviderSelection, PROVIDER_LOGO_SOURCES, providerActions, providerExecutionFromResult, providerLogoSource, providerStatusLabel, safeAccountLabel, safeLoginBody, safeProviderErrorMessage } from "../src/aiProviderModel.js";

const accountsPanelSource = fs.readFileSync(new URL("../src/AiAccountsPanel.jsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("provider cards expose only capability-backed actions", () => {
  const provider = {
    installation: { installed: true, supportedVersion: true },
    capabilities: ["login", "logout", "multiple_profiles", "profile_switch"],
    profiles: [{ id: "one", status: "connected", isActive: true }, { id: "two", status: "connected" }],
    activeProfile: { id: "one", status: "connected" }
  };
  assert.deepEqual(providerActions(provider), ["add_profile", "verify", "rename", "switch_profile", "disconnect"]);
  assert.deepEqual(providerActions({ ...provider, capabilities: [], installation: { installed: false } }), []);
  assert.deepEqual(providerActions(provider, { loginSession: { state: "waiting_for_provider" } }), ["cancel_login"]);
});

test("token input is cleared synchronously before a request body is used", () => {
  const order = [];
  const token = consumeEphemeralSecret("secret-token", (value) => order.push(["cleared", value]));
  order.push(["body", safeLoginBody({ workspaceId: "workspace-a", authMethod: "api_token", displayName: "Work", secret: token }).secret]);
  assert.deepEqual(order, [["cleared", ""], ["body", "secret-token"]]);
});

test("active Gotham provider selection accepts Claude and ignores account-only providers", () => {
  const summary = activeProviderSummary([
    { providerId: "claude", name: "Anthropic Claude Code", gothamExecutionSupported: true, activeProfile: { id: "claude-1", displayName: "Claude Work", status: "connected", lastVerifiedAt: "2026-08-31T12:00:00.000Z", selectedModel: "claude-sonnet-4-6" } },
    { providerId: "copilot", name: "Copilot", gothamExecutionSupported: false, activeProfile: { id: "copilot-1", displayName: "Copilot", status: "connected" } },
    { providerId: "codex", name: "Codex", gothamExecutionSupported: true, activeProfile: { id: "codex-1", displayName: "Work", status: "connected" } }
  ], "claude");
  assert.deepEqual(summary, {
    providerId: "claude",
    providerName: "Anthropic Claude Code",
    profileId: "claude-1",
    profileName: "Claude Work",
    status: "connected",
    statusLabel: "Connected",
    verified: true,
    verificationLabel: "Connected / verified",
    selectedModel: "claude-sonnet-4-6",
    valid: true
  });
  assert.equal(providerStatusLabel("authorization_required"), "Waiting for authorization");
  assert.match(accountsPanelSource, /Use for Gotham/);
  assert.match(accountsPanelSource, /provider\.gothamExecutionSupported/);
});

test("generation provider selection freezes the active profile before asynchronous request preparation", () => {
  const summary = { providerId: "claude", profileId: "claude-work" };
  const frozen = freezeProviderSelection(summary);
  summary.providerId = "codex";
  summary.profileId = "codex-later";
  assert.equal(Object.isFrozen(frozen), true);
  assert.deepEqual(frozen, { providerId: "claude", profileId: "claude-work" });
  assert.ok(appSource.indexOf("freezeProviderSelection(gothamProviderSummary)") < appSource.indexOf("await ensureRequiredDataForInstruction"));
  assert.match(appSource, /providerSelection:\s*\{\s*\.\.\.frozenProviderSelection\s*\}/);
});

test("result selection prefers providerExecution and preserves the legacy Codex fallback", () => {
  const providerExecution = { providerId: "claude", durationMs: 17 };
  assert.equal(providerExecutionFromResult({ providerExecution, codex: { durationMs: 99 } }), providerExecution);
  assert.deepEqual(providerExecutionFromResult({ codex: { durationMs: 99 } }), { durationMs: 99 });
});

test("provider errors redact credentials, profile paths, and unredacted email addresses", () => {
  const safe = safeProviderErrorMessage("token-secretvalue123 for person@example.com failed at /workspace/runtime/ai-provider-profiles/tenant/profile");
  assert.equal(safe.includes("secretvalue123"), false);
  assert.equal(safe.includes("person@example.com"), false);
  assert.equal(safe.includes("ai-provider-profiles/tenant"), false);
  assert.match(safe, /p\*\*\*@example\.com/);
  assert.equal(safeAccountLabel("person@example.com"), "p***@example.com");
  assert.equal(safeAccountLabel("p***@example.com"), "p***@example.com");
});

test("Codex account setup defaults to device authorization in a headless runtime", () => {
  assert.equal(defaultProviderAuthMethod({
    providerId: "codex",
    authMethods: ["device_code", "api_token"],
    preferredAuthMethod: "device_code"
  }), "device_code");
  assert.equal(defaultProviderAuthMethod({ providerId: "claude", authMethods: ["browser_oauth"] }), "browser_oauth");
});

test("Claude browser authorization opens the approved page and submits the one-time code separately", () => {
  assert.match(accountsPanelSource, /login\/\$\{loginSession\.id\}\/authorize/);
  assert.match(accountsPanelSource, /loginSession\.authorizationInputRequired/);
  assert.match(accountsPanelSource, /type="password"[^>]+autoComplete="off"/);
  assert.match(accountsPanelSource, /never saved/);
});

test("every AI Accounts provider uses a vendored official SVG mark", () => {
  assert.deepEqual(Object.keys(PROVIDER_LOGO_SOURCES), ["codex", "claude", "copilot", "cursor", "emergent"]);
  for (const [providerId, source] of Object.entries(PROVIDER_LOGO_SOURCES)) {
    assert.equal(providerLogoSource(providerId), source);
    const assetUrl = new URL(`../public${source}`, import.meta.url);
    assert.equal(fs.existsSync(assetUrl), true, `${providerId} logo is missing`);
    assert.match(fs.readFileSync(assetUrl, "utf8"), /<svg\b/i, `${providerId} logo must remain SVG`);
  }
});
