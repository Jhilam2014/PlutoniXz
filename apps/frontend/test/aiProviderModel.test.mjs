import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { activeProviderSummary, consumeEphemeralSecret, defaultProviderAuthMethod, PROVIDER_LOGO_SOURCES, providerActions, providerLogoSource, providerStatusLabel, safeLoginBody } from "../src/aiProviderModel.js";

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

test("active Gotham provider selection ignores account-only providers", () => {
  const summary = activeProviderSummary([
    { providerId: "claude", name: "Claude", gothamExecutionSupported: false, activeProfile: { id: "claude-1", displayName: "Claude", status: "connected" } },
    { providerId: "codex", name: "Codex", gothamExecutionSupported: true, activeProfile: { id: "codex-1", displayName: "Work", status: "connected" } }
  ], "claude");
  assert.deepEqual(summary, { providerId: "codex", providerName: "Codex", profileId: "codex-1", profileName: "Work", valid: true });
  assert.equal(providerStatusLabel("authorization_required"), "Waiting for authorization");
});

test("Codex account setup defaults to device authorization in a headless runtime", () => {
  assert.equal(defaultProviderAuthMethod({
    providerId: "codex",
    authMethods: ["device_code", "api_token"],
    preferredAuthMethod: "device_code"
  }), "device_code");
  assert.equal(defaultProviderAuthMethod({ providerId: "claude", authMethods: ["browser_oauth"] }), "browser_oauth");
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
