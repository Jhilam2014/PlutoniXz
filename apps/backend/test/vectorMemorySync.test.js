import assert from "node:assert/strict";
import test from "node:test";
import { scheduleAgentMemorySync, vectorSyncDecision, vectorSyncMinimumPendingFiles } from "../src/vectorMemorySync.js";

test("vector sync defers while the system has active work", async () => {
  const events = [];
  const summary = await scheduleAgentMemorySync({
    reason: "unit-test-busy",
    isSystemIdle: () => false,
    minSpacingMs: 0,
    emit: (type, message, data) => events.push({ type, message, data })
  });

  assert.equal(summary.status, "deferred");
  assert.equal(summary.deferred_reason, "system_busy");
  assert.equal(events[0].type, "vector-sync-deferred");
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
