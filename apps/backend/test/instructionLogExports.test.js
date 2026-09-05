import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildInstructionLogExport,
  FileInstructionLogExportRepository,
  instructionLogExportFilename,
  instructionSequenceId,
  PostgresInstructionLogExportRepository
} from "../src/instructionLogExports.js";

const scope = { tenantId: "tenant-a", workspaceId: "project-a", projectId: "project-a" };

test("builds a portable, redacted instruction log for its AI provider profile", () => {
  const record = buildInstructionLogExport({
    scope,
    project: { id: "project-a", name: "Project / One", enterprise: { name: "Example * Enterprise" } },
    instruction: {
      projectId: "project-a",
      parentWorkflowId: "workflow\\sequence/1",
      instruction: "Use Bearer private-token-value and postgres://user:password@example.test/db",
      status: "succeeded"
    },
    events: [{
      id: "event-1",
      type: "provider-complete",
      message: "Completed",
      createdAt: "2026-09-05T10:00:00.000Z",
      providerRuntimeSelection: { providerId: "codex", profileId: "profile-a" }
    }],
    actor: { principalId: "principal-a" },
    now: new Date("2026-09-05T10:01:02.000Z")
  });

  assert.equal(record.instructionSequenceId, "workflow\\sequence/1");
  assert.match(record.filename, /^Example-Enterprise_Project-One_workflow-sequence-1_gotham-log-[a-f0-9-]+_20260905T100102Z\.txt$/);
  assert.equal(/[\\/*?"<>|]/.test(record.filename), false);
  assert.match(record.content, /codex \/ profile-a/);
  assert.doesNotMatch(record.content, /private-token-value|user:password/);
  assert.equal(record.contentSha256.length, 64);
  assert.equal(record.sourceEventCount, 1);
});

test("derives a stable instruction sequence when a workflow ID is unavailable", () => {
  const instruction = { projectId: "project-a", recordedAt: "2026-09-05T10:00:00Z", instruction: "Plan only" };
  assert.equal(instructionSequenceId(instruction), instructionSequenceId({ ...instruction }));
  assert.match(instructionSequenceId(instruction), /^instruction-[a-f0-9]{24}$/);
  assert.equal(instructionLogExportFilename({ enterpriseName: "A", projectName: "B", instructionSequenceId: "C", exportId: "D", createdAt: "2026-09-05T10:00:00Z" }), "A_B_C_D_20260905T100000Z.txt");
});

test("preserves long retained log fields while redacting credentials", () => {
  const longInstruction = `${"A".repeat(2500)} END-OF-INSTRUCTION Bearer sensitive-value`;
  const record = buildInstructionLogExport({
    scope,
    project: { name: "Project A", enterprise: { name: "Enterprise A" } },
    instruction: { parentWorkflowId: "workflow-long", instruction: longInstruction, status: "succeeded" }
  });
  assert.match(record.content, /END-OF-INSTRUCTION/);
  assert.doesNotMatch(record.content, /sensitive-value/);
});

test("file repository persists exports and enforces tenant/project scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plutomix-instruction-exports-"));
  const repository = new FileInstructionLogExportRepository({ filePath: path.join(root, "exports.json") });
  const record = buildInstructionLogExport({
    scope,
    project: { name: "Project A", enterprise: { name: "Enterprise A" } },
    instruction: { parentWorkflowId: "workflow-a", instruction: "Do the task", status: "succeeded" }
  });
  try {
    const metadata = await repository.create(record, scope);
    assert.equal(metadata.content, undefined);
    assert.equal((await repository.get(record.id, scope)).content, record.content);
    await assert.rejects(
      () => repository.get(record.id, { ...scope, tenantId: "tenant-b" }),
      (error) => error.code === "instruction_log_export_not_found" && error.status === 404
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("PostgreSQL repository applies tenant, workspace, and project scope to downloads", async () => {
  const queries = [];
  const repository = new PostgresInstructionLogExportRepository({
    pool: {
      async query(sql, values) {
        queries.push({ sql, values });
        return { rows: [{ metadata: { id: "export-a", filename: "export.txt" }, content_text: "saved log" }] };
      }
    }
  });
  const record = await repository.get("export-a", scope);
  assert.equal(record.content, "saved log");
  assert.match(queries[0].sql, /tenant_id=\$2 AND workspace_id=\$3 AND project_id=\$4/);
  assert.deepEqual(queries[0].values, ["export-a", "tenant-a", "project-a", "project-a"]);
});
