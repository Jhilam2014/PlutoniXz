import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scheduleAgentMemorySync, vectorSyncDailyDecision, vectorSyncDecision, vectorSyncMaximumRunsPerDay, vectorSyncMinimumPendingFiles } from "../src/vectorMemorySync.js";

test("vector sync remains silent while the system has active work", async () => {
  const events = [];
  const summary = await scheduleAgentMemorySync({
    reason: "unit-test-busy",
    isSystemIdle: () => false,
    minSpacingMs: 0,
    emit: (type, message, data) => events.push({ type, message, data })
  });

  assert.equal(summary, null);
  assert.deepEqual(events, []);
});

test("vector sync has a three-attempt daily scheduling budget by default", () => {
  assert.equal(vectorSyncMaximumRunsPerDay("invalid"), 3);
  assert.equal(vectorSyncMaximumRunsPerDay("2"), 2);
  assert.equal(vectorSyncMaximumRunsPerDay("99"), 24);
  assert.deepEqual(vectorSyncDailyDecision({ scheduledRuns: 2, maxRunsPerDay: 3 }), {
    shouldRun: true,
    status: "ready",
    reason: "daily_run_slot_available",
    scheduledRuns: 2,
    maxRunsPerDay: 3
  });
  assert.deepEqual(vectorSyncDailyDecision({ scheduledRuns: 3, maxRunsPerDay: 3 }), {
    shouldRun: false,
    status: "skipped",
    reason: "daily_run_limit_reached",
    scheduledRuns: 3,
    maxRunsPerDay: 3
  });
});

test("daily vector-sync scheduling budget survives successive scheduler calls", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "plutonix-vector-sync-"));
  const originalRoot = process.env.PLUTONIX_PROJECT_ROOT;
  const originalEnabled = process.env.AGENT_MEMORY_SYNC_ENABLED;
  const scheduleStatePath = path.join(temporaryRoot, "observability", "agent-memory", "vector-sync-schedule.json");
  try {
    process.env.PLUTONIX_PROJECT_ROOT = temporaryRoot;
    process.env.AGENT_MEMORY_SYNC_ENABLED = "false";
    const scheduleOptions = {
      reason: "unit-test-daily-budget",
      minSpacingMs: 0,
      maxRunsPerDay: 3,
      scheduleStatePath,
      now: () => new Date("2026-08-27T04:00:00.000Z")
    };
    const first = await scheduleAgentMemorySync(scheduleOptions);
    const second = await scheduleAgentMemorySync(scheduleOptions);
    const third = await scheduleAgentMemorySync(scheduleOptions);
    const fourth = await scheduleAgentMemorySync(scheduleOptions);
    assert.equal(first.status, "skipped");
    assert.equal(second.status, "skipped");
    assert.equal(third.status, "skipped");
    assert.equal(fourth.status, "skipped");
    assert.equal(fourth.skipped_reason, "daily_run_limit_reached");
    assert.equal(fourth.scheduled_runs, 3);
    assert.equal(JSON.parse(await readFile(scheduleStatePath, "utf8")).scheduled_runs, 3);
  } finally {
    if (originalRoot === undefined) delete process.env.PLUTONIX_PROJECT_ROOT;
    else process.env.PLUTONIX_PROJECT_ROOT = originalRoot;
    if (originalEnabled === undefined) delete process.env.AGENT_MEMORY_SYNC_ENABLED;
    else process.env.AGENT_MEMORY_SYNC_ENABLED = originalEnabled;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("vector sync requires a configurable pending-file threshold", () => {
  assert.equal(vectorSyncMinimumPendingFiles("invalid"), 5);
  assert.equal(vectorSyncMinimumPendingFiles("3"), 3);
  assert.deepEqual(vectorSyncDecision({ systemIdle: true, pendingSyncCount: 4, minPendingFiles: 5 }), {
    shouldRun: false,
    status: "deferred",
    reason: "below_pending_threshold",
    minPendingFiles: 5
  });
  assert.equal(vectorSyncDecision({ systemIdle: true, pendingSyncCount: 5, minPendingFiles: 5 }).shouldRun, true);
});
