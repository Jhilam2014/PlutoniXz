import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildWorkflowPublicationReceipt,
  WorkflowProjectionPublisher
} from "../src/workflowProjectionPublisher.js";
import {
  createCanonicalWorkflowDecisionRecord,
  persistCanonicalWorkflowDecision,
  readCanonicalWorkflowDecisions
} from "../src/workflowDecisionContinuity.js";

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "plutonix-publication-"));
  const workspaceDir = path.join(root, "workspace");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "changed.js"), "export const changed = true;\n");
  context.after(() => rm(root, { recursive: true, force: true }));
  const receipt = await buildWorkflowPublicationReceipt({
    workflowId: "workflow-a",
    parentWorkflowId: "workflow-a",
    projectId: "project-a",
    projectName: "Project A",
    workspaceDir,
    taskType: "Medium",
    workflowMode: "executor",
    status: "succeeded",
    startedAt: "2026-08-29T00:00:00.000Z",
    completedAt: "2026-08-29T00:00:01.000Z",
    selectedPath: "plutonix-global-orchestration",
    selectedBranches: [{ id: "selected-a", disposition: "selected", reason: "authoritative selection" }],
    rejectedBranches: [{ id: "rejected-a", disposition: "rejected", reason: "constraint failed" }],
    deferredBranches: [{ id: "deferred-a", disposition: "deferred", reason: "human approval required" }],
    agentsUsed: [{ id: "project-execution-agent", status: "completed" }],
    changedFiles: ["changed.js"],
    instructionSummary: "Implement the requested behavior without token sk_abcdefghijklmnopqrst.",
    validation: { status: "passed" },
    flowPath: { selectedPath: "plutonix-global-orchestration" }
  });
  return { root, workspaceDir, receipt };
}

test("publication receipts hash changed files and redact operational secrets", async (context) => {
  const { receipt, workspaceDir } = await fixture(context);
  assert.match(receipt.publicationId, /^publication_/);
  assert.equal(receipt.changedFileDigests["changed.js"].status, "present");
  assert.match(receipt.changedFileDigests["changed.js"].sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(receipt.instructionSummary, /sk_abcdefghijklmnopqrst/);
  assert.equal(receipt.rejectedBranches[0].disposition, "rejected");
  assert.equal(receipt.deferredBranches[0].disposition, "deferred");
  const timingVariant = await buildWorkflowPublicationReceipt({
    ...receipt,
    workspaceDir,
    publicationId: undefined,
    startedAt: "2026-08-29T01:00:00.000Z",
    completedAt: "2026-08-29T01:01:00.000Z",
    durationMs: 60_000,
    timings: { modelExecutionDurationMs: 59_000 }
  });
  assert.equal(timingVariant.idempotencyKey, receipt.idempotencyKey);
  assert.equal(timingVariant.publicationId, receipt.publicationId);
});

test("canonical selected, rejected, and deferred decisions are visible before publication drains", async (context) => {
  const { root, receipt } = await fixture(context);
  persistCanonicalWorkflowDecision(createCanonicalWorkflowDecisionRecord({
    stage: "terminal",
    workflowId: receipt.workflowId,
    projectId: receipt.projectId,
    status: receipt.status,
    selectedPath: receipt.selectedPath,
    dispositions: {
      selectedBranches: receipt.selectedBranches,
      rejectedBranches: receipt.rejectedBranches,
      deferredBranches: receipt.deferredBranches
    },
    publicationId: receipt.publicationId,
    publicationIdempotencyKey: receipt.idempotencyKey
  }), { root });
  const publisher = new WorkflowProjectionPublisher({ root, isSystemIdle: () => false });
  await publisher.enqueue(receipt);

  const decisions = readCanonicalWorkflowDecisions({ projectId: receipt.projectId, root, terminalOnly: true });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].selectedBranches[0].disposition, "selected");
  assert.equal(decisions[0].rejectedBranches[0].disposition, "rejected");
  assert.equal(decisions[0].deferredBranches[0].disposition, "deferred");
  assert.deepEqual(await publisher.drain(), { status: "deferred", reason: "system_busy", processed: 0 });
});

test("enqueue is durable and does not wait for a blocked publication worker", async (context) => {
  const { root, receipt } = await fixture(context);
  let releaseTopology;
  const topologyGate = new Promise((resolve) => { releaseTopology = resolve; });
  const publisher = new WorkflowProjectionPublisher({
    root,
    publishProjectTopology: () => topologyGate,
    isSystemIdle: () => true
  });
  const queued = await publisher.enqueue(receipt);
  assert.equal(queued.status, "queued");
  const drainPromise = publisher.drain();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await publisher.enqueue(receipt)).status, "queued");
  releaseTopology({ status: "published" });
  assert.equal((await drainPromise).processed, 1);
});

test("publisher fails closed when idle-only operation is disabled", async (context) => {
  const { root, receipt } = await fixture(context);
  let topologyCalls = 0;
  const publisher = new WorkflowProjectionPublisher({
    root,
    idleOnly: false,
    publishProjectTopology: async () => { topologyCalls += 1; },
    isSystemIdle: () => true
  });
  await publisher.enqueue(receipt);
  assert.deepEqual(await publisher.drain(), { status: "degraded", reason: "idle_only_required", processed: 0 });
  assert.equal(topologyCalls, 0);
  await readFile(publisher.jobPath("pending", receipt.publicationId), "utf8");
});

test("duplicate receipts do not duplicate local memory and vector sync follows local publication", async (context) => {
  const { root, receipt } = await fixture(context);
  const order = [];
  const publisher = new WorkflowProjectionPublisher({
    root,
    publishProjectTopology: async () => { order.push("topology"); return { status: "published" }; },
    scheduleVectorSync: () => { order.push("vector"); },
    isSystemIdle: () => true
  });
  await publisher.enqueue(receipt);
  assert.equal((await publisher.enqueue(receipt)).duplicate, true);
  await publisher.drain();
  await publisher.publish(receipt);

  const historyRoot = path.join(root, "memory", "project-intelligence", "projects", "project-a");
  const instructionRows = (await readFile(path.join(historyRoot, "project-instructions.jsonl"), "utf8")).trim().split("\n");
  const whatNextRows = (await readFile(path.join(historyRoot, "what-next-knowledge.jsonl"), "utf8")).trim().split("\n");
  const agentRows = (await readFile(path.join(root, "memory", "agent-knowledge", "agents", "project-execution-agent.executions.jsonl"), "utf8")).trim().split("\n");
  assert.equal(instructionRows.length, 1);
  assert.equal(whatNextRows.length, 1);
  assert.equal(agentRows.length, 1);
  assert.deepEqual(order.slice(0, 2), ["topology", "vector"]);
  assert.equal(JSON.parse(whatNextRows[0]).deferredBranches[0].disposition, "deferred");
});

test("processing jobs recover after restart and preserve original dispositions", async (context) => {
  const { root, receipt } = await fixture(context);
  const first = new WorkflowProjectionPublisher({ root });
  await first.enqueue(receipt);
  await mkdir(path.join(first.outboxRoot, "processing"), { recursive: true });
  await rename(first.jobPath("pending", receipt.publicationId), first.jobPath("processing", receipt.publicationId));

  const recoveredPublisher = new WorkflowProjectionPublisher({
    root,
    publishProjectTopology: async (publishedReceipt) => {
      assert.deepEqual(publishedReceipt.rejectedBranches, receipt.rejectedBranches);
      assert.deepEqual(publishedReceipt.deferredBranches, receipt.deferredBranches);
      return { status: "published" };
    },
    isSystemIdle: () => true
  });
  assert.equal((await recoveredPublisher.recoverPending()).count, 1);
  assert.equal((await recoveredPublisher.drain()).processed, 1);
});

test("publication failure preserves canonical history and moves bounded retries to failed", async (context) => {
  const { root, receipt } = await fixture(context);
  let vectorSchedules = 0;
  persistCanonicalWorkflowDecision(createCanonicalWorkflowDecisionRecord({
    workflowId: receipt.workflowId,
    projectId: receipt.projectId,
    status: receipt.status,
    selectedPath: receipt.selectedPath,
    dispositions: {
      selectedBranches: receipt.selectedBranches,
      rejectedBranches: receipt.rejectedBranches,
      deferredBranches: receipt.deferredBranches
    },
    publicationId: receipt.publicationId,
    publicationIdempotencyKey: receipt.idempotencyKey
  }), { root });
  const publisher = new WorkflowProjectionPublisher({
    root,
    maxAttempts: 1,
    publishProjectTopology: async () => { throw new Error("graph unavailable with token sk_abcdefghijklmnopqrst"); },
    scheduleVectorSync: () => { vectorSchedules += 1; },
    isSystemIdle: () => true
  });
  await publisher.enqueue(receipt);
  await publisher.drain();

  const failedJob = JSON.parse(await readFile(publisher.jobPath("failed", receipt.publicationId), "utf8"));
  assert.equal(failedJob.attempts, 1);
  assert.doesNotMatch(failedJob.lastFailure.error, /sk_abcdefghijklmnopqrst/);
  const decisions = readCanonicalWorkflowDecisions({ projectId: receipt.projectId, root, terminalOnly: true });
  assert.equal(decisions[0].selectedBranches[0].id, "selected-a");
  assert.equal(decisions[0].deferredBranches[0].disposition, "deferred");
  assert.equal(vectorSchedules, 0);
});

test("publication retry preserves exact branch dispositions before succeeding", async (context) => {
  const { root, receipt } = await fixture(context);
  let attempts = 0;
  const seen = [];
  const events = [];
  const publisher = new WorkflowProjectionPublisher({
    root,
    maxAttempts: 2,
    retryBaseMs: 60_000,
    emit: (type) => events.push(type),
    publishProjectTopology: async (publishedReceipt) => {
      attempts += 1;
      seen.push({
        selected: structuredClone(publishedReceipt.selectedBranches),
        rejected: structuredClone(publishedReceipt.rejectedBranches),
        deferred: structuredClone(publishedReceipt.deferredBranches)
      });
      if (attempts === 1) throw new Error("temporary graph failure");
      return { status: "published" };
    },
    isSystemIdle: () => true
  });
  await publisher.enqueue(receipt);
  await publisher.drain();
  const pendingPath = publisher.jobPath("pending", receipt.publicationId);
  const pendingJob = JSON.parse(await readFile(pendingPath, "utf8"));
  pendingJob.nextAttemptAt = "1970-01-01T00:00:00.000Z";
  await writeFile(pendingPath, `${JSON.stringify(pendingJob, null, 2)}\n`);
  await publisher.drain();

  assert.equal(attempts, 2);
  assert.deepEqual(seen[0], seen[1]);
  assert.equal(seen[1].rejected[0].disposition, "rejected");
  assert.equal(seen[1].deferred[0].disposition, "deferred");
  assert.ok(events.includes("publication.retry_scheduled"));
  assert.ok(events.includes("publication.completed"));
  await readFile(publisher.jobPath("published", receipt.publicationId), "utf8");
});
