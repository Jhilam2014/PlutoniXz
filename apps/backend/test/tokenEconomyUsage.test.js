import assert from "node:assert/strict";
import test from "node:test";
import { extractModelAuthoredText, parseProviderUsageFromEventStream, resolveWorkflowTokenUsage } from "../src/tokenEconomy.js";

test("provider terminal usage is preferred and preserves cached and reasoning tokens", () => {
  const stream = [
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", role: "assistant", content: [{ type: "output_text", text: "Implemented." }] } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 80 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 12 }, total_tokens: 150 } })
  ].join("\n");
  assert.deepEqual(parseProviderUsageFromEventStream(stream), {
    inputTokens: 120,
    cachedInputTokens: 80,
    outputTokens: 30,
    reasoningOutputTokens: 12,
    totalTokens: 150,
    usageSource: "provider",
    providerUsageSchemaVersion: "normalized-v1"
  });
  assert.equal(resolveWorkflowTokenUsage({ eventStream: stream, promptText: "ignored estimate" }).usageSource, "provider");
});

test("fallback estimation counts model-authored text and not event transport", () => {
  const payload = "x".repeat(20_000);
  const stream = [
    JSON.stringify({ type: "tool.completed", output: payload }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", role: "assistant", content: [{ type: "output_text", text: "Done." }] } })
  ].join("\n");
  assert.equal(extractModelAuthoredText(stream), "Done.");
  const usage = resolveWorkflowTokenUsage({ eventStream: stream, promptText: "Do it." });
  assert.equal(usage.usageSource, "estimated");
  assert.ok(usage.outputTokens < 10);
});

test("usage parser defensively handles camel-case provider snapshots", () => {
  const usage = parseProviderUsageFromEventStream(JSON.stringify({ response: { token_usage: { inputTokens: 9, cachedInputTokens: 4, outputTokens: 3, reasoningOutputTokens: 2, totalTokens: 12 } } }));
  assert.equal(usage.inputTokens, 9);
  assert.equal(usage.totalTokens, 12);
});
