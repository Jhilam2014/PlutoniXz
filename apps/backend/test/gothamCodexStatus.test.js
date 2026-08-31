import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import test from "node:test";

test("Gotham status exposes verified backend-managed Codex readiness", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-status-codex-"));
  const fakeCodex = path.join(root, "fake-codex.mjs");
  await fs.writeFile(fakeCodex, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") { process.stdout.write("codex-cli status-test\\n"); process.exit(0); }
if (args[0] === "login" && args[1] === "status") { process.stdout.write("Logged in using ChatGPT\\n"); process.exit(0); }
process.exit(2);
`);
  await fs.chmod(fakeCodex, 0o755);
  process.env.PLUTONIX_SERVER_AUTOSTART = "false";
  process.env.CODEX_BIN = fakeCodex;
  process.env.OPENAI_API_KEY = "";
  process.env.DECISION_CONTINUITY_ADAPTER = "file";
  process.env.GOTHAM_STUDIO_REPOSITORY = "file";
  process.env.PLUTONIX_PROJECT_ROOT = path.resolve(process.cwd(), "../..");
  const { app, closePlutonixServerResources } = await import("../src/server.js");
  const server = app.listen(0, "127.0.0.1");
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closePlutonixServerResources();
    await fs.rm(root, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/status`);
  const status = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(status.codex, {
    transport: "cli",
    available: true,
    authenticated: true,
    authenticationStatus: "ready",
    version: "codex-cli status-test",
    runtimeManagedBy: "plutonix-backend",
    requiresVsCode: false,
    error: ""
  });
  assert.equal(status.codexMcp, "not-required");
});
