import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const taskPromptGroups = [
  [".codex/prompts/task-small.md", ".claude/prompts/task-small.md", ".github/prompts/task-small.prompt.md"],
  [".codex/prompts/task-medium.md", ".claude/prompts/task-medium.md", ".github/prompts/task-medium.prompt.md"],
  [".codex/prompts/task-large.md", ".claude/prompts/task-large.md", ".github/prompts/task-large.prompt.md"],
  [".codex/prompts/task-router.md", ".claude/prompts/task-router.md", ".github/prompts/task-router.prompt.md"]
];

test("provider task prompts preserve the Product Shape runtime contract", async () => {
  for (const promptGroup of taskPromptGroups) {
    for (const relativePath of promptGroup) {
      const contents = await fs.readFile(path.join(repositoryRoot, relativePath), "utf8");
      assert.match(contents, /Product Shape Contract/i, relativePath);
      assert.match(contents, /smallest complete|scope boundaries/i, relativePath);
      assert.match(contents, /React website|generic website|artifact type/i, relativePath);
    }
  }
});

test("provider adapters inherit the universal instruction and response quality contract", async () => {
  const rootInstruction = await fs.readFile(path.join(repositoryRoot, "AGENTS.md"), "utf8");
  assert.match(rootInstruction, /UNIVERSAL INSTRUCTION AND RESPONSE QUALITY CONTRACT/i);
  assert.match(rootInstruction, /Goal.*Context.*Scope.*Constraints.*Requirements.*Done when/is);

  const adapterPaths = [
    "CLAUDE.md",
    ".github/copilot-instructions.md",
    ".codex/prompts/task-router.md",
    ".claude/prompts/task-router.md",
    ".github/prompts/task-router.prompt.md"
  ];
  for (const relativePath of adapterPaths) {
    const contents = await fs.readFile(path.join(repositoryRoot, relativePath), "utf8");
    assert.match(contents, /Universal Instruction and Response Quality Contract/i, relativePath);
  }
});

test("provider QAgent prompts enforce shape, provenance, and input-consumption review", async () => {
  const qagentPrompts = [
    ".codex/prompts/task-qagentic.md",
    ".claude/prompts/task-qagentic.md",
    ".github/prompts/task-qagentic.prompt.md",
    ".codex/prompts/bootstrap-orchestrator-qagentic.md",
    ".claude/prompts/bootstrap-orchestrator-qagentic.md",
    ".github/prompts/bootstrap-orchestrator-qagentic.prompt.md"
  ];

  for (const relativePath of qagentPrompts) {
    const contents = await fs.readFile(path.join(repositoryRoot, relativePath), "utf8");
    assert.match(contents, /Product Shape/i, relativePath);
    assert.match(contents, /provenance|real\/user\/reference-backed/i, relativePath);
    assert.match(contents, /input consumption|supplied-input consumption/i, relativePath);
  }
});
