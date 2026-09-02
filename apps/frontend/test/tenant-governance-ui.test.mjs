import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const panelSource = fs.readFileSync(path.join(root, "src", "TenantGovernancePanel.jsx"), "utf8");

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
  assert.match(panelSource, /\/api\/platform-admin\/overview/);
  assert.match(panelSource, /Two-enterprise limit reached/);
  assert.match(panelSource, /team-invitations/);
  assert.doesNotMatch(panelSource, /OPENAI_API_KEY|authorization:\s*["']Bearer\s+[A-Za-z0-9]/);
});
