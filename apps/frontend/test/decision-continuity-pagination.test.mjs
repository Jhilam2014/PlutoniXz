import test from "node:test";
import assert from "node:assert/strict";
import { fetchDecisionBranchPages, fetchDecisionGraphPages, mergeDecisionBranchPages, mergeDecisionGraphPages } from "../src/decisionContinuityPagination.js";

function branch(id, updatedAt, label = id) {
  return { id, label, updatedAt, createdAt: "2026-01-01T00:00:00.000Z" };
}

test("Decision Continuity loads every declared page and deterministically de-duplicates branch records", async () => {
  const requested = [];
  const pages = new Map([
    [0, {
      branches: [branch("alpha", "2026-01-02T00:00:00.000Z"), branch("shared", "2026-01-03T00:00:00.000Z", "Older shared record")],
      pagination: { offset: 0, limit: 2, returned: 2, hasMore: true, nextOffset: 2 }
    }],
    [2, {
      branches: [branch("beta", "2026-01-04T00:00:00.000Z"), branch("shared", "2026-01-05T00:00:00.000Z", "Newer shared record")],
      pagination: { offset: 2, limit: 2, returned: 2, hasMore: true, nextOffset: 4 }
    }],
    [4, {
      branches: [branch("gamma", "2026-01-01T00:00:00.000Z")],
      pagination: { offset: 4, limit: 2, returned: 1, hasMore: false, nextOffset: null }
    }]
  ]);

  const result = await fetchDecisionBranchPages({
    pageSize: 2,
    maxPages: 5,
    requestPage: async (request) => {
      requested.push(request);
      return pages.get(request.offset);
    }
  });

  assert.equal(result.state, "ready");
  assert.deepEqual(requested, [{ offset: 0, limit: 2 }, { offset: 2, limit: 2 }, { offset: 4, limit: 2 }]);
  assert.deepEqual(result.branches.map((entry) => entry.id), ["shared", "beta", "alpha", "gamma"]);
  assert.equal(result.branches.find((entry) => entry.id === "shared").label, "Newer shared record");
  assert.deepEqual(result.pagination, {
    pageSize: 2,
    maxPages: 5,
    maxRecords: 10,
    pageCount: 3,
    fetchedCount: 5,
    loadedCount: 4,
    total: null,
    complete: true,
    partial: false,
    truncated: false
  });
});

test("Decision Continuity keeps completed pages and reports a later page failure as partial", async () => {
  const requested = [];
  const result = await fetchDecisionBranchPages({
    pageSize: 2,
    maxPages: 5,
    requestPage: async (request) => {
      requested.push(request);
      if (request.offset === 0) {
        return {
          branches: [branch("alpha", "2026-01-02T00:00:00.000Z"), branch("beta", "2026-01-01T00:00:00.000Z")],
          pagination: { offset: 0, limit: 2, returned: 2, hasMore: true, nextOffset: 2 }
        };
      }
      throw new Error("Second page timed out.");
    }
  });

  assert.equal(result.state, "partial");
  assert.match(result.error, /Only part.*Second page timed out/i);
  assert.deepEqual(requested, [{ offset: 0, limit: 2 }, { offset: 2, limit: 2 }]);
  assert.deepEqual(result.branches.map((entry) => entry.id), ["alpha", "beta"]);
  assert.equal(result.pagination.complete, false);
  assert.equal(result.pagination.partial, true);
  assert.equal(result.pagination.truncated, false);
});

test("Decision Continuity treats a full legacy response without pagination metadata as truncated", async () => {
  const requested = [];
  const result = await fetchDecisionBranchPages({
    pageSize: 2,
    requestPage: async (request) => {
      requested.push(request);
      return { branches: [branch("alpha", "2026-01-02T00:00:00.000Z"), branch("beta", "2026-01-01T00:00:00.000Z")] };
    }
  });

  assert.equal(result.state, "truncated");
  assert.match(result.error, /without pagination metadata/i);
  assert.deepEqual(requested, [{ offset: 0, limit: 2 }]);
  assert.equal(result.pagination.loadedCount, 2);
});

test("Decision Continuity enforces both record and page request bounds", async () => {
  const requested = [];
  const result = await fetchDecisionBranchPages({
    pageSize: 2,
    maxPages: 2,
    maxRecords: 3,
    requestPage: async (request) => {
      requested.push(request);
      if (request.offset === 0) {
        return {
          branches: [branch("alpha", "2026-01-03T00:00:00.000Z"), branch("beta", "2026-01-02T00:00:00.000Z")],
          pagination: { offset: 0, limit: 2, returned: 2, hasMore: true, nextOffset: 2 }
        };
      }
      return {
        branches: [branch("gamma", "2026-01-01T00:00:00.000Z"), branch("discarded", "2025-12-31T00:00:00.000Z")],
        pagination: { offset: 2, limit: 1, returned: 2, hasMore: true, nextOffset: 3 }
      };
    }
  });

  assert.equal(result.state, "truncated");
  assert.match(result.error, /after 3 records/i);
  assert.deepEqual(requested, [{ offset: 0, limit: 2 }, { offset: 2, limit: 1 }]);
  assert.deepEqual(result.branches.map((entry) => entry.id), ["alpha", "beta", "gamma"]);
  assert.equal(result.pagination.maxRecords, 3);
  assert.equal(result.pagination.fetchedCount, 3);
});

test("branch page merge is stable if duplicate records arrive in a different page order", () => {
  const older = branch("shared", "2026-01-01T00:00:00.000Z", "Older");
  const newer = branch("shared", "2026-01-03T00:00:00.000Z", "Newer");
  const alpha = branch("alpha", "2026-01-02T00:00:00.000Z");
  const first = mergeDecisionBranchPages([{ branches: [older, alpha] }, { branches: [newer] }]);
  const second = mergeDecisionBranchPages([{ branches: [newer] }, { branches: [alpha, older] }]);

  assert.deepEqual(first, second);
  assert.deepEqual(first.map((entry) => entry.id), ["shared", "alpha"]);
});

test("Decision Continuity fetches and deterministically merges graph pages for every loaded branch page", async () => {
  const requested = [];
  const result = await fetchDecisionGraphPages({
    pageSize: 1,
    maxPages: 4,
    requestPage: async (request) => {
      requested.push(request);
      if (request.offset === 0) {
        return {
          graph: {
            nodes: [
              { id: "branch:alpha", kind: "branch", branchId: "alpha" },
              { id: "event:created-alpha", kind: "event", eventType: "branch.created", occurredAt: "2026-01-01T00:00:00.000Z" }
            ],
            edges: [{ id: "recorded:event:created-alpha:alpha", kind: "recorded_for", source: "event:created-alpha", target: "branch:alpha" }]
          },
          pagination: { offset: 0, limit: 1, returned: 1, hasMore: true, nextOffset: 1 }
        };
      }
      return {
        graph: {
          nodes: [
            { id: "branch:beta", kind: "branch", branchId: "beta" },
            { id: "event:created-alpha", kind: "event", eventType: "branch.created", occurredAt: "2026-01-01T00:00:00.000Z" }
          ],
          edges: [{ id: "recorded:event:created-alpha:alpha", kind: "recorded_for", source: "event:created-alpha", target: "branch:alpha" }]
        },
        pagination: { offset: 1, limit: 1, returned: 1, hasMore: false, nextOffset: null }
      };
    }
  });

  assert.equal(result.state, "ready");
  assert.equal(result.eventCoverage, "unconfirmed");
  assert.deepEqual(requested, [{ offset: 0, limit: 1 }, { offset: 1, limit: 1 }]);
  assert.deepEqual(result.graph.nodes.map((entry) => entry.id), ["branch:alpha", "branch:beta", "event:created-alpha"]);
  assert.deepEqual(result.graph.edges.map((entry) => entry.id), ["recorded:event:created-alpha:alpha"]);
});

test("graph page merge is stable and never duplicates nodes or edges", () => {
  const first = mergeDecisionGraphPages([{
    graph: {
      nodes: [{ id: "branch:alpha", kind: "branch" }, { id: "event:alpha", kind: "event" }],
      edges: [{ id: "recorded:event:alpha:alpha", kind: "recorded_for", source: "event:alpha", target: "branch:alpha" }]
    }
  }, {
    graph: {
      nodes: [{ id: "event:alpha", kind: "event" }, { id: "branch:beta", kind: "branch" }],
      edges: [{ id: "recorded:event:alpha:alpha", kind: "recorded_for", source: "event:alpha", target: "branch:alpha" }]
    }
  }]);

  assert.deepEqual(first.nodes.map((entry) => entry.id), ["branch:alpha", "branch:beta", "event:alpha"]);
  assert.deepEqual(first.edges.map((entry) => entry.id), ["recorded:event:alpha:alpha"]);
});
