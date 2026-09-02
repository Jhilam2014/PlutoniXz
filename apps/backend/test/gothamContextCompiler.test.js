import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { fileURLToPath } from "node:url";
import { clearGothamStaticPolicyCache, compileGothamContext, resolveGothamPolicyRoot } from "../src/gothamContextCompiler.js";
import { estimateTokens } from "../src/tokenEconomy.js";

const backendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(backendDir, "../..");
const policyRoot = path.join(repositoryRoot, "policies");

function baseInput(overrides = {}) {
  return {
    instruction: "Adjust one header label.",
    projectLifecycle: "runtime-development",
    taskType: "Simple",
    artifactType: "web_application",
    riskLevel: "low",
    selectedExecutionAgent: "project-agent",
    selectedAgentDefinitions: [{ id: "project-agent", content: "bounded agent" }],
    ...overrides
  };
}

test("compact root policy remains bounded and routes detailed policy through the manifest", async () => {
  const root = await fs.readFile(path.join(repositoryRoot, "AGENTS.md"), "utf8");
  assert.ok(estimateTokens(root) <= 8000);
  assert.match(root, /policies\/manifest\.json/);
  assert.doesNotMatch(root, /CREATE CONSTRAINT|MERGE \(.*Neo4j/i);
});

test("container policy resolution uses the mounted PlutoMix project instead of filesystem root", async (context) => {
  const mountedProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-mounted-policy-"));
  context.after(() => fs.remove(mountedProjectRoot));
  await fs.ensureDir(path.join(mountedProjectRoot, "policies"));
  await fs.writeFile(path.join(mountedProjectRoot, "policies", "manifest.json"), "{}\n");
  assert.equal(
    resolveGothamPolicyRoot({ env: { PLUTOMIX_PROJECT_ROOT: mountedProjectRoot } }),
    path.resolve(mountedProjectRoot, "policies")
  );
  assert.equal(
    resolveGothamPolicyRoot({ policyRoot: "/custom/policies", env: { PLUTOMIX_PROJECT_ROOT: "/workspace/project" } }),
    path.resolve("/custom/policies")
  );
});

test("runtime Simple web compilation selects only applicable mandatory packs and one agent", async () => {
  const result = await compileGothamContext(baseInput());
  const ids = result.selectedInstructionPacks.map((pack) => pack.id);
  assert.ok(ids.includes("lifecycle.runtime-development"));
  assert.ok(ids.includes("task-size.simple"));
  assert.ok(ids.includes("domain.web-application"));
  assert.equal(ids.includes("lifecycle.project-init"), false);
  assert.equal(ids.includes("domain.infrastructure"), false);
  assert.deepEqual(result.selectedAgentDefinitions.map((agent) => agent.id), ["project-agent"]);
  assert.ok(result.provenance.estimatedTokens < result.provenance.targetTokenLimit);
  assert.ok(result.provenance.omittedOptionalPacks.includes("reference.full-operating-manual"));
});

test("project initiation and artifact-domain packs are selected deterministically", async () => {
  const result = await compileGothamContext(baseInput({ projectLifecycle: "project-init", taskType: "Medium", artifactType: "spreadsheet" }));
  const ids = result.selectedInstructionPacks.map((pack) => pack.id);
  assert.ok(ids.includes("lifecycle.project-init"));
  assert.ok(ids.includes("task-size.medium"));
  assert.ok(ids.includes("domain.spreadsheet"));
  assert.equal(ids.includes("domain.web-application"), false);
});

test("static policy cache is reused while every instruction reads a fresh decision snapshot", async () => {
  clearGothamStaticPolicyCache();
  let decision = { workflowId: "workflow-a", selectedBranches: [{ id: "a", disposition: "selected" }] };
  const first = await compileGothamContext(baseInput({ readDecisionSnapshot: async () => decision }));
  decision = { workflowId: "workflow-b", rejectedBranches: [{ id: "b", disposition: "rejected" }], deferredBranches: [{ id: "c", disposition: "deferred" }] };
  const second = await compileGothamContext(baseInput({ instruction: "Change another label.", readDecisionSnapshot: async () => decision }));
  assert.equal(first.provenance.staticCacheStatus, "miss");
  assert.equal(second.provenance.staticCacheStatus, "hit");
  assert.equal(second.decisionSnapshot.workflowId, "workflow-b");
  assert.equal(second.decisionSnapshot.rejectedBranches[0].disposition, "rejected");
  assert.equal(second.decisionSnapshot.deferredBranches[0].disposition, "deferred");
});

test("pack version/hash changes invalidate cache and unresolved mandatory conflicts fail", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-policy-"));
  context.after(() => fs.remove(temporaryRoot));
  await fs.copy(policyRoot, temporaryRoot);
  clearGothamStaticPolicyCache();
  const first = await compileGothamContext(baseInput(), { policyRoot: temporaryRoot });
  const packPath = path.join(temporaryRoot, "task-size", "simple.md");
  await fs.appendFile(packPath, "\n- Versioned fixture addition.\n");
  const manifestPath = path.join(temporaryRoot, "manifest.json");
  const manifest = await fs.readJson(manifestPath);
  const simple = manifest.packs.find((pack) => pack.id === "task-size.simple");
  simple.version = "1.0.1";
  simple.contentHash = `sha256:${crypto.createHash("sha256").update(await fs.readFile(packPath, "utf8")).digest("hex")}`;
  await fs.writeJson(manifestPath, manifest);
  const second = await compileGothamContext(baseInput(), { policyRoot: temporaryRoot });
  assert.notEqual(second.provenance.staticCacheKey, first.provenance.staticCacheKey);
  assert.equal(second.provenance.staticCacheStatus, "miss");

  simple.incompatibleWith = ["core.authority-and-safety"];
  await fs.writeJson(manifestPath, manifest);
  clearGothamStaticPolicyCache();
  await assert.rejects(() => compileGothamContext(baseInput(), { policyRoot: temporaryRoot }), /Mandatory Gotham policy conflict/);
});

test("mandatory context exceeding the hard budget fails before execution", async () => {
  await assert.rejects(
    () => compileGothamContext(baseInput({ instruction: "x".repeat(30_000) }), { hardTokenLimit: 2000, targetTokenLimit: 1500 }),
    /exceeding the hard limit/
  );
});
