import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("production grants only the bounded outer-container controls required by Bubblewrap", async () => {
  const compose = await fs.readFile(path.join(repositoryRoot, "compose.production.yaml"), "utf8");

  assert.match(compose, /cap_add:\s*\n\s*- SYS_ADMIN/);
  assert.match(compose, /security_opt:\s*\n\s*- apparmor=unconfined/);
  assert.doesNotMatch(compose, /privileged:\s*true/);
  assert.doesNotMatch(compose, /pid:\s*host/);
  assert.doesNotMatch(compose, /seccomp=unconfined/);
});

test("production deployment proves the real workspace-write sandbox before succeeding", async () => {
  const deploy = await fs.readFile(path.join(repositoryRoot, "scripts/deploy-plutomix.sh"), "utf8");

  assert.match(deploy, /probeCodexWorkspaceSandbox/);
  assert.match(deploy, /process\.env\.PROJECTS_ROOT/);
  assert.match(deploy, /result\.status !== "ready"/);
  assert.doesNotMatch(deploy, /codex[^\n]*sandbox[^\n]*\/bin\/true/);
});
