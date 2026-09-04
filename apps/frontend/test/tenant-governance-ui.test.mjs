import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const panelSource = fs.readFileSync(path.join(root, "src", "TenantGovernancePanel.jsx"), "utf8");
const platformPanelSource = fs.readFileSync(path.join(root, "src", "PlatformAdminPanel.jsx"), "utf8");
const authClientSource = fs.readFileSync(path.join(root, "src", "authClient.js"), "utf8");

test("new project creation requires an enterprise label and explicit agent catalog", () => {
  assert.match(appSource, /enterpriseLabel\.trim\(\)\.length > 1/);
  assert.match(appSource, /enterpriseId: enterpriseSelection === "new" \? undefined : enterpriseSelection/);
  assert.match(appSource, /enterpriseLabel: enterpriseLabel\.trim\(\)/);
  assert.match(appSource, /agentSource,/);
  assert.match(appSource, /Global community agents/);
  assert.match(appSource, /Enterprise-specific agents/);
});

test("tenant administration uses governed APIs and shows the two-enterprise limit", () => {
  assert.match(panelSource, /\/api\/tenant-governance\/overview/);
  assert.match(panelSource, /Two-enterprise limit reached/);
  assert.match(panelSource, /team-invitations/);
  assert.doesNotMatch(panelSource, /OPENAI_API_KEY|authorization:\s*["']Bearer\s+[A-Za-z0-9]/);
});

test("Google sign-in consumes server-controlled onboarding and exposes an authorized platform tenant table", () => {
  assert.match(appSource, /onboarding:\s*data\.onboarding/);
  assert.match(authClientSource, /tenantContextHeaders\(currentUser\)/);
  assert.match(appSource, /new URL\(`\$\{BACKEND_URL\}\/api\/platform-admin\/overview`\)/);
  assert.match(appSource, /url\.searchParams\.set\("limit", "25"\)/);
  assert.match(appSource, /verifiedIdentityFetch\(url, \{ signal: controller\.signal \}\)/);
  assert.match(appSource, /platformAdminOverview\s*\?\s*<button/);
  assert.match(platformPanelSource, /<table className="platform-admin-table">/);
  assert.match(platformPanelSource, />Tenant ID</);
  assert.match(platformPanelSource, />Instance key</);
  assert.match(platformPanelSource, /tenant\.memberCount/);
  assert.match(platformPanelSource, /tenant\.enterpriseCount/);
  assert.match(platformPanelSource, /tenant\.applicationCount/);
  assert.match(platformPanelSource, /Previous tenant page/);
  assert.match(platformPanelSource, /Next tenant page/);
  assert.doesNotMatch(platformPanelSource, /tenant\.(?:members|enterprises|applications)\b/);
  assert.doesNotMatch(platformPanelSource, /administrator\?\.(?:email|displayName)/);
  assert.doesNotMatch(platformPanelSource, /jhilam\.astro|117341705060626960890|OPENAI_API_KEY/);
});

test("platform administration requests cannot repopulate data after logout or an account switch", () => {
  assert.match(appSource, /platformAdminRequestRef = useRef\(\{ generation: 0, controller: null \}\)/);
  assert.match(appSource, /active\.controller\?\.abort\(\)/);
  assert.match(appSource, /new AbortController\(\)/);
  assert.match(appSource, /platformAdminRequestRef\.current\.generation !== requestGeneration/);
  assert.match(appSource, /setPlatformAdminOverview\(null\);[\s\S]*setPlatformAdminOpen\(false\);[\s\S]*loadPlatformAdminOverview\(\{ offset: 0 \}\)/);
  assert.match(appSource, /return cancelPlatformAdminRequest/);
});
