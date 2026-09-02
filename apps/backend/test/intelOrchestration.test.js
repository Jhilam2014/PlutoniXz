import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { getIntelProfile, selectIntelProfile } from "../src/intelProfiles.js";
import { validateIntelProfileOutput } from "../src/intelArtifactValidation.js";
import { IntelAgentResultSchema, assertIntelWorkspaceWithinRoot, beginIntelRepair, createIntelTaskGraph, prepareIntelWorkflow, recordIntelRepair, runIntelReadersInBatches, scoreIntelProposal, validateIntelTaskGraph } from "../src/intelOrchestration.js";
import { classifyProductShape } from "../src/productShape.js";

function webSelection() {
  const instruction = "Build a web application with an accessible customer support workflow.";
  return { instruction, selection: selectIntelProfile({ instruction, productDecision: classifyProductShape({ instruction }) }) };
}

test("creates a versioned acyclic graph with exactly one normal writer and profile roles", () => {
  const { instruction, selection } = webSelection();
  const graph = createIntelTaskGraph({ profile: selection.profile, selection, objective: instruction, projectRoot: process.cwd() });
  assert.equal(validateIntelTaskGraph(graph).workflowId, graph.workflowId);
  assert.equal(graph.nodes.filter((node) => node.permissions === "workspace-write" && node.role !== "repair-agent").length, 1);
  assert.ok(graph.nodes.some((node) => node.role === "ui-ux-explorer"));
  assert.ok(graph.nodes.some((node) => node.role === "verification-agent"));
});

test("rejects cyclic task graphs", () => {
  const { instruction, selection } = webSelection();
  const graph = createIntelTaskGraph({ profile: selection.profile, selection, objective: instruction, projectRoot: process.cwd() });
  graph.nodes.find((node) => node.id === "intel-planner").dependencies.push("verification-agent");
  assert.throws(() => validateIntelTaskGraph(graph), /cycle/i);
});

test("runs independent read-only workers concurrently up to the configured limit", async () => {
  const started = [];
  let active = 0;
  let maximum = 0;
  const results = await runIntelReadersInBatches(["one", "two", "three", "four"], 3, async (value) => {
    started.push(value);
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return value;
  });
  assert.equal(results.length, 4);
  assert.equal(started.length, 4);
  assert.equal(maximum, 3);
});

test("backend scoring ignores a model-supplied score and accepts only evidence-backed work", () => {
  const profile = getIntelProfile("web-application");
  const evidence = profile.requiredEvidence.map((kind) => ({ id: kind, kind, detail: kind }));
  const accepted = scoreIntelProposal({ profile, proposal: { id: "p1", title: "Implement the requested workflow", kind: "primary", sourceAgent: "requirements-analyst", modelScore: 1, evidenceRefs: evidence.map((item) => item.id) }, evidence });
  const rejected = scoreIntelProposal({ profile, proposal: { id: "p2", title: "Optional generic filler expansion", kind: "unrelated-filler", sourceAgent: "requirements-analyst", modelScore: 100, evidenceRefs: [] }, evidence: [] });
  assert.equal(accepted.status, "accepted");
  assert.equal(rejected.status, "deferred");
  assert.notEqual(rejected.total, 100);
});

test("prepares real reader runs and only queues implementation after accepted proposals", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-intel-"));
  await fs.writeFile(path.join(root, "package.json"), "{\"name\":\"intel-test\"}");
  try {
    const { instruction, selection } = webSelection();
    const runtime = await prepareIntelWorkflow({ profileSelection: selection, instruction, workspaceDir: root, workflowId: "intel_test_workflow" });
    assert.ok(runtime.agentRuns.length >= 3);
    assert.ok(runtime.acceptedProposals.every((proposal) => proposal.status === "accepted"));
    assert.equal(runtime.taskGraph.nodes.find((node) => node.id === "implementation-agent").status, "queued");
    assert.equal(runtime.taskGraph.nodes.find((node) => node.id === "verification-agent").status, "planned");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runs at most one bounded repair after an actionable verification failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-intel-repair-"));
  try {
    const { instruction, selection } = webSelection();
    const runtime = await prepareIntelWorkflow({ profileSelection: selection, instruction, workspaceDir: root, workflowId: "intel_repair_workflow" });
    beginIntelRepair(runtime, new Error("Independent review failed: required interaction is missing."));
    assert.equal(runtime.repairCycles, 1);
    assert.equal(runtime.taskGraph.nodes.find((node) => node.id === "verification-agent").status, "failed");
    assert.equal(runtime.taskGraph.nodes.find((node) => node.id === "repair-agent").status, "running");
    recordIntelRepair(runtime, { repairId: "repair-one", status: "repaired", modelKind: "codex", files: ["src/App.jsx"] });
    assert.equal(runtime.taskGraph.nodes.find((node) => node.id === "repair-agent").status, "completed");
    assert.throws(() => beginIntelRepair(runtime, new Error("A second failure.")), /repair limit/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("fails malformed agent records and rejects out-of-root workspaces", async () => {
  assert.throws(() => IntelAgentResultSchema.parse({ schemaVersion: "1.0" }), /Required/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-intel-root-"));
  const workspace = path.join(root, "project");
  await fs.mkdir(workspace);
  try {
    assert.equal(await assertIntelWorkspaceWithinRoot(workspace, root), await fs.realpath(workspace));
    await assert.rejects(() => assertIntelWorkspaceWithinRoot(os.tmpdir(), root), /out-of-root/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("spreadsheet validation detects stored formula errors before rendering", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-intel-workbook-"));
  const workbookPath = path.join(root, "deliverables", "invalid.xlsx");
  await fs.mkdir(path.dirname(workbookPath), { recursive: true });
  const workbook = new AdmZip();
  workbook.addFile("xl/workbook.xml", Buffer.from("<?xml version=\"1.0\"?><workbook><sheets><sheet name=\"Budget\" sheetId=\"1\"/></sheets></workbook>"));
  workbook.addFile("xl/worksheets/sheet1.xml", Buffer.from("<?xml version=\"1.0\"?><worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"e\"><v>#REF!</v></c></row></sheetData></worksheet>"));
  try {
    workbook.writeZip(workbookPath);
    const validation = await validateIntelProfileOutput({
      profile: getIntelProfile("spreadsheet"),
      workspaceDir: root,
      changedFiles: ["deliverables/invalid.xlsx"]
    });
    const formulaCheck = validation.checks.find((check) => check.id === "formula-reference-check");
    assert.equal(formulaCheck.status, "failed");
    assert.match(formulaCheck.detail, /#REF!/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("uses provider-neutral CLI transport with bounded read/write modes and no unsafe bypass flags", async () => {
  const workflowSource = await fs.readFile(new URL("../src/codexWorkflow.js", import.meta.url), "utf8");
  const claudeRuntimeSource = await fs.readFile(new URL("../src/claudeRuntime.js", import.meta.url), "utf8");
  const bootstrapSource = await fs.readFile(new URL("../src/projectBootstrap.js", import.meta.url), "utf8");
  assert.match(workflowSource, /"--sandbox",\s*"workspace-write"/);
  assert.match(workflowSource, /"--sandbox",\s*mode/);
  assert.match(workflowSource, /mode:\s*"read-only"/);
  assert.match(workflowSource, /CLAUDE_EXECUTION_MODES\.READ_ONLY/);
  assert.equal(/dangerously-bypass-approvals-and-sandbox|dangerously-skip-permissions|bypassPermissions/.test(`${workflowSource}\n${claudeRuntimeSource}\n${bootstrapSource}`), false);
});
