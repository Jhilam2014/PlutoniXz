import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureProjectQAgenticFramework } from "../src/projectBootstrap.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

test("project bootstrap synchronizes canonical Product Shape and QAgent schemas", async (context) => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-qagent-parity-"));
  context.after(() => fs.rm(workspaceDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(workspaceDir, "schemas"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceDir, "schemas", "qagent-next-instruction.schema.json"),
    JSON.stringify({ title: "stale" })
  );

  await ensureProjectQAgenticFramework(
    workspaceDir,
    { id: "parity-project", name: "Parity Project" },
    { source: "unit-test" }
  );

  const canonicalQAgent = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, "schemas", "qagent-next-instruction.schema.json"), "utf8")
  );
  const canonicalProductShape = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, "schemas", "product-shape-decision.schema.json"), "utf8")
  );
  const projectQAgent = JSON.parse(
    await fs.readFile(path.join(workspaceDir, "schemas", "qagent-next-instruction.schema.json"), "utf8")
  );
  const projectProductShape = JSON.parse(
    await fs.readFile(path.join(workspaceDir, "schemas", "product-shape-decision.schema.json"), "utf8")
  );

  assert.deepEqual(projectQAgent, canonicalQAgent);
  assert.deepEqual(projectProductShape, canonicalProductShape);
  assert.ok(projectQAgent.properties.activity_validation.required.includes("shape_fit"));
  assert.ok(projectQAgent.properties.activity_validation.required.includes("input_consumption"));
  assert.match(await fs.readFile(path.join(workspaceDir, "AGENTS.md"), "utf8"), /Hugging Face Model Workspace/);
  assert.match(await fs.readFile(path.join(workspaceDir, "models", "huggingface", "README.md"), "utf8"), /complete Hugging Face repository/);
  const modelScript = await fs.readFile(path.join(workspaceDir, "scripts", "huggingface-models.mjs"), "utf8");
  assert.match(modelScript, /HF_MODEL_PARTIAL_DOWNLOAD/);
  assert.match(modelScript, /full-repository-with-weights/);
  assert.match(modelScript, /Selected Hugging Face model/);
  assert.match(modelScript, /sizeLabel/);
  assert.match(modelScript, /download", target\.repoId/);
  const manifest = JSON.parse(await fs.readFile(path.join(workspaceDir, "models", "huggingface", "model-manifest.json"), "utf8"));
  assert.deepEqual(manifest.models, []);
});
