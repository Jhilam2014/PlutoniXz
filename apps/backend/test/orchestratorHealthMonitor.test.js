import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import fs from "fs-extra";
import { createOrchestratorHealthMonitor } from "../src/orchestratorHealthMonitor.js";

test("health audits are manual-only and persist a three-attempt daily limit", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-health-audit-"));
  context.after(() => fs.remove(root));
  let currentTime = new Date("2026-08-29T08:00:00.000Z");
  const events = [];
  const options = {
    root,
    now: () => new Date(currentTime),
    timeZone: "UTC",
    maxDailyAudits: 3,
    emit: (type, message) => events.push({ type, message }),
    getRuntimeEvents: () => [],
    getInstructionTimeline: () => [],
    getTokenEconomy: async () => ({})
  };
  const monitor = createOrchestratorHealthMonitor(options);

  assert.deepEqual(monitor.start(), { mode: "manual", scheduled: false, maxDailyAudits: 3 });
  assert.equal((await monitor.status()).latestReport, null);
  assert.equal(events.length, 0);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const report = await monitor.audit({ reason: "control-panel-user-request", requestedBy: "test-user" });
    assert.equal(report.status, "healthy");
    assert.equal((await monitor.status()).quota.used, attempt);
  }
  assert.equal((await monitor.status()).quota.remaining, 0);
  await assert.rejects(
    () => monitor.audit({ reason: "control-panel-user-request" }),
    (error) => error.code === "orchestrator_health_daily_limit_reached" && error.statusCode === 429
  );

  const restartedMonitor = createOrchestratorHealthMonitor(options);
  assert.equal((await restartedMonitor.status()).quota.used, 3);
  await assert.rejects(
    () => restartedMonitor.audit({ reason: "control-panel-user-request" }),
    (error) => error.code === "orchestrator_health_daily_limit_reached"
  );

  const timeline = (await fs.readFile(path.join(root, "observability", "orchestrator-health", "health-report.timeline.jsonl"), "utf8"))
    .trim()
    .split("\n");
  assert.equal(timeline.length, 3);

  currentTime = new Date("2026-08-30T08:00:00.000Z");
  assert.equal((await restartedMonitor.status()).quota.remaining, 3);
  await restartedMonitor.audit({ reason: "control-panel-user-request" });
  assert.equal((await restartedMonitor.status()).quota.used, 1);
});

