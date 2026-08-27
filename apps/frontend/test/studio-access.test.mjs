import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  authorizedStudioWorkspace,
  isProtectedStudioWorkspace,
  normalizedStudioWorkspace,
  PROTECTED_STUDIO_WORKSPACES
} from "../src/studioAccessModel.js";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const studioSource = readFileSync(new URL("../src/pages/StudioPage.jsx", import.meta.url), "utf8");
const authClientSource = readFileSync(new URL("../src/authClient.js", import.meta.url), "utf8");

test("anonymous visitors cannot select protected Studio workspaces, including through deep links", () => {
  for (const workspace of PROTECTED_STUDIO_WORKSPACES) {
    assert.equal(isProtectedStudioWorkspace(workspace), true);
    assert.equal(authorizedStudioWorkspace(workspace, null), "studio");
  }
  assert.equal(normalizedStudioWorkspace("unknown-workspace"), "studio");
  assert.equal(authorizedStudioWorkspace("studio", null), "studio");
});

test("a verified Studio identity can resolve every declared protected workspace", () => {
  const user = { id: "https://accounts.google.com:verified-subject" };
  for (const workspace of PROTECTED_STUDIO_WORKSPACES) {
    assert.equal(authorizedStudioWorkspace(workspace, user), workspace);
  }
});

test("the shell hides operational navigation and render branches behind Studio identity", () => {
  assert.ok(appSource.includes("{currentUser?.id ? <>"));
  assert.ok(appSource.includes('const visibleWorkspaceTab = authorizedStudioWorkspace(activeWorkspaceTab, currentUser)'));
  assert.ok(appSource.includes('{visibleWorkspaceTab === "studio" ? ('));
  assert.ok(appSource.includes('if (!currentUser?.id && activeWorkspaceTab !== "studio")'));
  assert.ok(studioSource.includes('{currentUser ? <button type="button" className="studio-section-nav-app"'));
  assert.ok(studioSource.includes('className="studio-authorized-launcher"'));
});

test("Studio presents one Google SSO action and uses the verified Google name as profile identity", () => {
  assert.equal((appSource.match(/className="google-login-button"/g) || []).length, 1);
  assert.equal((studioSource.match(/className="studio-google-action"/g) || []).length, 0);
  assert.equal(appSource.includes("googleButtonRef"), false);
  assert.equal(appSource.includes("identity.renderButton"), false);
  assert.ok(appSource.includes("<b>{currentUser.name}</b>"));
  assert.ok(appSource.includes("currentUser.picture ? <img"));
  assert.ok(appSource.includes('referrerPolicy="no-referrer"'));
  assert.ok(appSource.includes('{currentUser?.id ? <>'));
  for (const label of ["Builder", "PlutoniX", "Agents", "Cloud Hosting"]) assert.ok(appSource.includes(label));
});

test("an explicitly enabled development build uses its provisioned subject for strict APIs", () => {
  assert.ok(authClientSource.includes('VITE_PLUTONIX_DEV_AUTH_SUBJECT || "local:local-plutonix-user"'));
  const devHeader = 'if (developmentAuthEnabled && developmentSubject) return { "x-plutonix-dev-subject": developmentSubject };';
  const bearerHeader = 'if (bearerToken) return { authorization: `Bearer ${bearerToken}` };';
  assert.ok(authClientSource.indexOf(devHeader) >= 0);
  assert.ok(authClientSource.indexOf(devHeader) < authClientSource.indexOf(bearerHeader));
});
