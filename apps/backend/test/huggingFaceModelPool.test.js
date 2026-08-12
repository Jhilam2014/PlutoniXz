import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateHuggingFaceModelSize,
  formatModelSize,
  huggingFaceDownloadArgs,
  inferHuggingFaceModelIntent,
  localModelRoutingForTask
} from "../src/huggingFaceModelPool.js";

test("detects explicit Hugging Face model instructions", () => {
  const intent = inferHuggingFaceModelIntent("Use Hugging Face model Lightricks/LTX-Video locally for image to video.");

  assert.equal(intent.requested, true);
  assert.equal(intent.searchRequested, false);
  assert.deepEqual(intent.explicitModelIds, ["Lightricks/LTX-Video"]);
  assert.equal(intent.task, "image-to-video");
});

test("detects relevant model search requests", () => {
  const intent = inferHuggingFaceModelIntent("Search for a suitable Hugging Face model for summarization and download it locally.");

  assert.equal(intent.requested, true);
  assert.equal(intent.searchRequested, true);
  assert.equal(intent.task, "summarization");
});

test("routes small and self-improvement work to local Hugging Face", () => {
  assert.deepEqual(localModelRoutingForTask({ taskType: "Simple", workflowMode: "debugger" }), {
    preferredProvider: "huggingface-local",
    enforceLocalHuggingFace: true,
    reason: "Small PlutoniX tasks prefer local Hugging Face models before paid/remote model calls.",
    workflowMode: "debugger"
  });

  const systemRouting = localModelRoutingForTask({ taskType: "Hard", target: "self-improvement" });
  assert.equal(systemRouting.preferredProvider, "huggingface-local");
  assert.equal(systemRouting.enforceLocalHuggingFace, true);
});

test("downloads complete Hugging Face repositories by default", () => {
  const args = huggingFaceDownloadArgs("Wan-AI/Wan2.1-I2V-14B-720P", "/tmp/hf/wan");

  assert.deepEqual(args, ["download", "Wan-AI/Wan2.1-I2V-14B-720P", "--local-dir", "/tmp/hf/wan"]);
  assert.equal(args.includes("--include"), false);
  assert.equal(args.includes("--exclude"), false);
});

test("allows partial Hugging Face downloads only when explicitly enabled", () => {
  const args = huggingFaceDownloadArgs("org/model", "/tmp/hf/model", {
    allowPartial: true,
    include: "*.json, *.safetensors",
    exclude: "*.msgpack"
  });

  assert.deepEqual(args, [
    "download",
    "org/model",
    "--local-dir",
    "/tmp/hf/model",
    "--include",
    "*.json",
    "--include",
    "*.safetensors",
    "--exclude",
    "*.msgpack"
  ]);
});

test("formats selected Hugging Face model size in GB", () => {
  assert.deepEqual(formatModelSize(3_632_041_404), {
    sizeBytes: 3632041404,
    sizeGb: 3.63,
    sizeLabel: "3.63 GB"
  });
});

test("estimates Hugging Face repository size from API storage or sibling files", () => {
  assert.deepEqual(estimateHuggingFaceModelSize({ usedStorage: 9_876_543_210 }), {
    sizeBytes: 9876543210,
    sizeGb: 9.88,
    sizeLabel: "9.88 GB"
  });

  assert.deepEqual(estimateHuggingFaceModelSize({ siblings: [{ size: 2_000_000_000 }, { size: 500_000_000 }] }), {
    sizeBytes: 2500000000,
    sizeGb: 2.5,
    sizeLabel: "2.50 GB"
  });
});
