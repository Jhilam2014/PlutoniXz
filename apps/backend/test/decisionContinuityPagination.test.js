import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DecisionContinuityError, createDecisionContinuityStore } from "../src/decisionContinuity.js";
import { PostgresDecisionContinuityStore } from "../src/decisionContinuityPostgres.js";

const tenantId = "tenant-databricksx";
const workspaceId = "databricksx";
const fixedUpdatedAt = "2026-08-20T00:00:00.000Z";

function branch(index) {
  const id = `branch-${String(index).padStart(4, "0")}`;
  return {
    id,
    tenantId,
    workspaceId,
    decisionId: `decision-${index}`,
    objective: { summary: `Decision ${index}` },
    status: "candidate",
    revision: 1,
    parentBranchId: null,
    rootLineageId: id,
    evidence: [],
    updatedAt: fixedUpdatedAt,
    createdAt: fixedUpdatedAt
  };
}

async function seededFileStore(context, count = 600) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-decision-pagination-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createDecisionContinuityStore({ root });
  await store.mutate(async (state) => {
    for (let index = 0; index < count; index += 1) {
      const item = branch(index);
      state.branches[item.id] = item;
    }
  });
  return store;
}

test("file decision ledger paginates 600 equal-timestamp branches without gaps or duplicates", async (context) => {
  const store = await seededFileStore(context);
  const pages = await Promise.all([0, 250, 500].map((offset) => store.listBranchesPage({ tenantId, workspaceId, limit: 250, offset })));

  assert.deepEqual(pages.map((page) => page.pagination), [
    { offset: 0, limit: 250, returned: 250, hasMore: true, nextOffset: 250 },
    { offset: 250, limit: 250, returned: 250, hasMore: true, nextOffset: 500 },
    { offset: 500, limit: 250, returned: 100, hasMore: false, nextOffset: null }
  ]);
  assert.equal(pages[0].branches[0].id, "branch-0599", "branch ID breaks an equal updatedAt tie deterministically");
  assert.equal(pages[2].branches.at(-1).id, "branch-0000");
  const allIds = pages.flatMap((page) => page.branches.map((item) => item.id));
  assert.equal(allIds.length, 600);
  assert.equal(new Set(allIds).size, 600);
  await assert.rejects(
    store.listBranchesPage({ tenantId, workspaceId, limit: 251 }),
    (error) => error instanceof DecisionContinuityError && error.code === "invalid_pagination"
  );
  await assert.rejects(
    store.listBranchesPage({ tenantId, workspaceId, offset: -1 }),
    (error) => error instanceof DecisionContinuityError && error.code === "invalid_pagination"
  );
});

test("PostgreSQL branch pagination uses tenant-scoped count and bounded deterministic SQL", async () => {
  const queries = [];
  const store = new PostgresDecisionContinuityStore({ databaseUrl: "postgres://pagination-test-not-used" });
  store.database = async () => ({
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      if (sql.includes("count(*)::int AS total")) return { rows: [{ total: 600 }] };
      return { rows: [{ record: branch(349) }, { record: branch(348) }] };
    }
  });

  const page = await store.listBranchesPage({ tenantId, workspaceId, statuses: ["candidate", "not-a-status"], limit: 250, offset: 250 });
  assert.deepEqual(page.pagination, { offset: 250, limit: 250, returned: 2, hasMore: true, nextOffset: 252 });
  assert.deepEqual(page.branches.map((item) => item.id), ["branch-0349", "branch-0348"]);
  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => query.parameters[0] === tenantId && query.parameters[1] === workspaceId));
  const pageQuery = queries.find((query) => query.sql.includes("LIMIT $5 OFFSET $6"));
  assert.ok(pageQuery, "the PostgreSQL adapter must constrain the row query in the database");
  assert.match(pageQuery.sql, /ORDER BY record->>'updatedAt' DESC NULLS LAST, entity_id DESC/);
  assert.deepEqual(pageQuery.parameters.slice(3), [["candidate"], 250, 250]);
});
