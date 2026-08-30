import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  beginProjectChange,
  commitProjectChange,
  projectChangeHistoryStatus,
  redoProjectChange,
  undoProjectChange
} from "../src/projectChangeHistory.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-change-history-"));
  const workspaceDir = path.join(root, "app");
  await fs.mkdir(workspaceDir);
  await fs.writeFile(path.join(workspaceDir, "app.js"), "before\n");
  await fs.writeFile(path.join(workspaceDir, ".env"), "SECRET=preserved\n");
  return { root, projectId: "project-1", workspaceDir };
}

test("undo and redo restore an exact Gotham source checkpoint without touching secrets", async (t) => {
  const options = await fixture();
  t.after(() => fs.rm(options.root, { recursive: true, force: true }));
  const checkpoint = await beginProjectChange({ ...options, instruction: "Change the screen" });
  await fs.writeFile(path.join(options.workspaceDir, "app.js"), "after\n");
  await fs.writeFile(path.join(options.workspaceDir, "new.js"), "created\n");
  const committed = await commitProjectChange(checkpoint, { buildId: "build-1" });
  assert.equal(committed.canUndo, true);
  assert.equal(committed.canRedo, false);

  const undone = await undoProjectChange(options);
  assert.equal(await fs.readFile(path.join(options.workspaceDir, "app.js"), "utf8"), "before\n");
  await assert.rejects(fs.access(path.join(options.workspaceDir, "new.js")));
  assert.equal(await fs.readFile(path.join(options.workspaceDir, ".env"), "utf8"), "SECRET=preserved\n");
  assert.equal(undone.history.canRedo, true);

  const redone = await redoProjectChange(options);
  assert.equal(await fs.readFile(path.join(options.workspaceDir, "app.js"), "utf8"), "after\n");
  assert.equal(await fs.readFile(path.join(options.workspaceDir, "new.js"), "utf8"), "created\n");
  assert.equal(redone.history.canRedo, false);
});

test("undo refuses to overwrite edits made after Gotham completed", async (t) => {
  const options = await fixture();
  t.after(() => fs.rm(options.root, { recursive: true, force: true }));
  const checkpoint = await beginProjectChange({ ...options });
  await fs.writeFile(path.join(options.workspaceDir, "app.js"), "gotham\n");
  await commitProjectChange(checkpoint);
  await fs.writeFile(path.join(options.workspaceDir, "app.js"), "manual edit\n");

  await assert.rejects(() => undoProjectChange(options), (error) => error.code === "workspace_changed");
  assert.equal(await fs.readFile(path.join(options.workspaceDir, "app.js"), "utf8"), "manual edit\n");
});

test("a new Gotham change after undo clears the redo branch", async (t) => {
  const options = await fixture();
  t.after(() => fs.rm(options.root, { recursive: true, force: true }));
  const first = await beginProjectChange({ ...options, instruction: "First" });
  await fs.writeFile(path.join(options.workspaceDir, "app.js"), "first\n");
  await commitProjectChange(first);
  await undoProjectChange(options);

  const second = await beginProjectChange({ ...options, instruction: "Second" });
  await fs.writeFile(path.join(options.workspaceDir, "app.js"), "second\n");
  await commitProjectChange(second);
  const status = await projectChangeHistoryStatus(options);
  assert.equal(status.total, 1);
  assert.equal(status.canRedo, false);
  assert.equal(status.undo.instruction, "Second");
});

test("a no-op Gotham run does not create an undo step", async (t) => {
  const options = await fixture();
  t.after(() => fs.rm(options.root, { recursive: true, force: true }));
  const checkpoint = await beginProjectChange({ ...options, instruction: "Inspect only" });
  const status = await commitProjectChange(checkpoint);
  assert.equal(status.total, 0);
  assert.equal(status.canUndo, false);
  assert.equal(status.canRedo, false);
});
