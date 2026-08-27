import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canCancelStudioJob,
  canRetryStudioJob,
  canSubmitStudioJob,
  costLabel,
  studioStateTone
} from "../src/gotham-studio/lib/normalizeStudioState.js";
import { normalizeFunctionalityGraph } from "../src/functionalityGraphModel.js";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("../src/gotham-studio/GothamStudio.jsx", import.meta.url), "utf8");
const jobsSource = readFileSync(new URL("../src/gotham-studio/GothamStudioJobs.jsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/gotham-studio/lib/gothamStudioApi.js", import.meta.url), "utf8");

const providers = [{ id: "databricks", capabilities: { submitJob: true, cancelJob: true } }];

test("Studio job controls follow logical state, provider capabilities, retry bounds, and workflow mode", () => {
  assert.equal(canSubmitStudioJob({ logicalState: "DRAFT", provider: "databricks" }, providers, "executor"), true);
  assert.equal(canSubmitStudioJob({ logicalState: "DRAFT", provider: "databricks" }, providers, "planner"), false);
  assert.equal(canCancelStudioJob({ logicalState: "RUNNING", provider: "databricks" }, providers), true);
  assert.equal(canCancelStudioJob({ logicalState: "SUCCEEDED", provider: "databricks" }, providers), false);
  assert.equal(canRetryStudioJob({ logicalState: "FAILED", retry: { attempt: 1 }, constraints: { maxRuns: 2 } }), true);
  assert.equal(canRetryStudioJob({ logicalState: "FAILED", retry: { attempt: 2 }, constraints: { maxRuns: 2 } }), false);
});

test("Studio presentation labels unavailable evidence instead of inventing it", () => {
  assert.equal(costLabel({}), "Cost unavailable");
  assert.equal(studioStateTone("SUCCEEDED"), "success");
  assert.equal(studioStateTone("FAILED"), "danger");
  assert.ok(jobsSource.includes("Provider budget policy ID"));
  assert.ok(jobsSource.includes("Deployment remains disabled"));
  assert.equal(/demo|mock metric|sample run/i.test(workspaceSource), false);
});

test("Gotham Studio is internal to Builder, protected, project-scoped, and context-aware", () => {
  assert.ok(appSource.includes('openStudioWorkspace("gotham-studio")'));
  assert.ok(appSource.includes('visibleWorkspaceTab === "gotham-studio"'));
  assert.ok(appSource.includes("Open in Gotham Studio"));
  assert.ok(appSource.includes("Open ML pipeline"));
  assert.ok(appSource.includes("studioContext: studioContextForRun || undefined"));
  assert.ok(workspaceSource.includes("Ask Gotham about this ML workspace"));
  assert.ok(apiSource.includes("workspaceId: projectId, projectId"));
  assert.ok(apiSource.includes('"Idempotency-Key": crypto.randomUUID()'));
});

test("functionality graph nodes preserve Studio resource IDs for contextual navigation", () => {
  const graph = normalizeFunctionalityGraph({
    functionalityGraph: {
      projectId: "project-a",
      rootId: "project-root",
      nodes: [
        { id: "project-root", type: "project", label: "Project A" },
        { id: "pipeline-node", type: "functionality", label: "Training", parentId: "project-root", studioResource: { type: "ml_pipeline", id: "PX-PIPELINE-1" } }
      ],
      links: []
    }
  }, "project-a");
  assert.deepEqual(graph.nodes.find((node) => node.id === "pipeline-node")?.studioResource, { type: "ml_pipeline", id: "PX-PIPELINE-1" });
});
