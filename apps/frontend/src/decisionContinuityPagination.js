const DEFAULT_PAGE_SIZE = 250;
const DEFAULT_MAX_PAGES = 20;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim();
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value, fallback) {
  const parsed = nonNegativeInteger(value);
  return parsed && parsed > 0 ? parsed : fallback;
}

function valueFromPagination(payload, keys) {
  const source = record(payload);
  const pagination = record(source.pagination || source.page || source.meta);
  for (const container of [pagination, source]) {
    for (const key of keys) {
      if (container[key] !== undefined && container[key] !== null && container[key] !== "") return container[key];
    }
  }
  return undefined;
}

function booleanFromPagination(payload, keys) {
  const value = valueFromPagination(payload, keys);
  return typeof value === "boolean" ? value : undefined;
}

function timestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function branchOrder(left, right) {
  return timestamp(right?.updatedAt) - timestamp(left?.updatedAt)
    || timestamp(right?.createdAt) - timestamp(left?.createdAt)
    || text(left?.id).localeCompare(text(right?.id))
    || stableValue(left).localeCompare(stableValue(right));
}

/**
 * Keeps one canonical record for each ledger branch ID, irrespective of API
 * page boundaries. The ordering is explicit so a refreshed paged result does
 * not change presentation merely because page delivery order changed.
 */
export function mergeDecisionBranchPages(pages = []) {
  const branchesById = new Map();
  for (const page of asArray(pages)) {
    for (const branch of asArray(record(page).branches)) {
      const id = text(branch?.id);
      if (!id) continue;
      const existing = branchesById.get(id);
      if (!existing || branchOrder(branch, existing) < 0) branchesById.set(id, branch);
    }
  }
  return [...branchesById.values()].sort(branchOrder);
}

function graphEntryKey(entry) {
  const source = record(entry);
  const id = text(source.id);
  if (id) return id;
  const relation = [text(source.kind), text(source.source), text(source.target)];
  return relation.some(Boolean) ? relation.join("\u0000") : stableValue(entry);
}

function mergeGraphEntries(pages, property) {
  const entriesById = new Map();
  for (const page of asArray(pages)) {
    for (const entry of asArray(record(record(page).graph)[property])) {
      const key = graphEntryKey(entry);
      if (!key) continue;
      const existing = entriesById.get(key);
      if (!existing || stableValue(entry).localeCompare(stableValue(existing)) < 0) entriesById.set(key, entry);
    }
  }
  return [...entriesById.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([, entry]) => entry);
}

/** Merges the rebuildable graph pages without letting duplicate node or edge IDs change the event overlay. */
export function mergeDecisionGraphPages(pages = []) {
  return {
    nodes: mergeGraphEntries(pages, "nodes"),
    edges: mergeGraphEntries(pages, "edges")
  };
}

function paginationFor(payload, { offset, pageSize }) {
  const total = nonNegativeInteger(valueFromPagination(payload, ["total", "totalCount"]));
  const returned = nonNegativeInteger(valueFromPagination(payload, ["returned"]));
  const nextOffset = nonNegativeInteger(valueFromPagination(payload, ["nextOffset", "next_offset"]));
  return {
    offset: nonNegativeInteger(valueFromPagination(payload, ["offset"])) ?? offset,
    limit: positiveInteger(valueFromPagination(payload, ["limit", "pageSize"]), pageSize),
    total,
    returned,
    nextOffset,
    hasMore: booleanFromPagination(payload, ["hasMore", "has_more", "hasNextPage"])
  };
}

function resultFor({ state, pages, pageSize, maxPages, maxRecords, pageCount, fetchedCount, total, error = "" }) {
  const branches = mergeDecisionBranchPages(pages);
  return {
    state,
    branches,
    error,
    pagination: {
      pageSize,
      maxPages,
      maxRecords,
      pageCount,
      fetchedCount,
      loadedCount: branches.length,
      total,
      complete: state === "ready",
      partial: state === "partial",
      truncated: state === "truncated"
    }
  };
}

/**
 * Fetch a bounded offset-paginated branch ledger. A full page without a
 * continuation signal is deliberately treated as truncated: the UI must not
 * present a capped legacy response as a complete historical record.
 */
export async function fetchDecisionBranchPages({ requestPage, pageSize = DEFAULT_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES, maxRecords } = {}) {
  const requestedPageSize = positiveInteger(pageSize, DEFAULT_PAGE_SIZE);
  const requestedMaxPages = positiveInteger(maxPages, DEFAULT_MAX_PAGES);
  const requestedMaxRecords = positiveInteger(maxRecords, requestedPageSize * requestedMaxPages);
  const pages = [];
  const requestedOffsets = new Set();
  let offset = 0;
  let total = null;
  let fetchedCount = 0;

  if (typeof requestPage !== "function") {
    return resultFor({
      state: "error",
      pages,
      pageSize: requestedPageSize,
      maxPages: requestedMaxPages,
      maxRecords: requestedMaxRecords,
      pageCount: 0,
      fetchedCount,
      total,
      error: "Recorded decision continuity could not be requested."
    });
  }

  for (let pageIndex = 0; pageIndex < requestedMaxPages; pageIndex += 1) {
    if (fetchedCount >= requestedMaxRecords) {
      return resultFor({
        state: "truncated",
        pages,
        pageSize: requestedPageSize,
        maxPages: requestedMaxPages,
        maxRecords: requestedMaxRecords,
        pageCount: pages.length,
        fetchedCount,
        total,
        error: `Recorded decision continuity stopped after ${requestedMaxRecords} records to keep this browser request bounded.`
      });
    }
    if (requestedOffsets.has(offset)) {
      return resultFor({
        state: "truncated",
        pages,
        pageSize: requestedPageSize,
        maxPages: requestedMaxPages,
        maxRecords: requestedMaxRecords,
        pageCount: pages.length,
        fetchedCount,
        total,
        error: "Recorded decision continuity stopped because pagination repeated an offset."
      });
    }
    requestedOffsets.add(offset);

    let payload;
    try {
      payload = await requestPage({ offset, limit: Math.min(requestedPageSize, requestedMaxRecords - fetchedCount) });
    } catch (error) {
      const message = error?.message || "Recorded decision continuity is unavailable.";
      return resultFor({
        state: pages.length ? "partial" : "error",
        pages,
        pageSize: requestedPageSize,
        maxPages: requestedMaxPages,
        maxRecords: requestedMaxRecords,
        pageCount: pages.length,
        fetchedCount,
        total,
        error: pages.length ? `Only part of the recorded decision continuity was loaded: ${message}` : message
      });
    }

    const page = record(payload);
    const rows = asArray(page.branches);
    const pagination = paginationFor(page, { offset, pageSize: requestedPageSize });
    if (pagination.returned !== null && pagination.returned !== rows.length) {
      return resultFor({
        state: pages.length ? "partial" : "error",
        pages,
        pageSize: requestedPageSize,
        maxPages: requestedMaxPages,
        maxRecords: requestedMaxRecords,
        pageCount: pages.length,
        fetchedCount,
        total,
        error: "Recorded decision continuity could not be verified because the server's returned count does not match the branch payload."
      });
    }
    const remainingRecords = requestedMaxRecords - fetchedCount;
    const boundedRows = rows.slice(0, remainingRecords);
    if (boundedRows.length !== rows.length) {
      pages.push({ branches: boundedRows });
      fetchedCount += boundedRows.length;
      return resultFor({
        state: "truncated",
        pages,
        pageSize: requestedPageSize,
        maxPages: requestedMaxPages,
        maxRecords: requestedMaxRecords,
        pageCount: pages.length,
        fetchedCount,
        total,
        error: `Recorded decision continuity stopped after ${requestedMaxRecords} records to keep this browser request bounded.`
      });
    }
    pages.push({ branches: boundedRows });
    fetchedCount += boundedRows.length;
    if (pagination.total !== null) total = total === null ? pagination.total : Math.max(total, pagination.total);

    const coveredThrough = pagination.offset + rows.length;
    const totalIndicatesMore = total !== null && coveredThrough < total;
    const nextIndicatesMore = pagination.nextOffset !== null;
    if (pagination.hasMore === false && (nextIndicatesMore || totalIndicatesMore)) {
      return resultFor({
        state: "truncated",
        pages,
        pageSize: requestedPageSize,
        maxPages: requestedMaxPages,
        maxRecords: requestedMaxRecords,
        pageCount: pages.length,
        fetchedCount,
        total,
        error: "Recorded decision continuity stopped because the server pagination metadata is inconsistent."
      });
    }
    const more = pagination.hasMore === true || nextIndicatesMore || totalIndicatesMore;

    if (!more) {
      if (pagination.hasMore === undefined && pagination.nextOffset === null && total === null && rows.length >= pagination.limit) {
        return resultFor({
          state: "truncated",
          pages,
          pageSize: requestedPageSize,
          maxPages: requestedMaxPages,
          maxRecords: requestedMaxRecords,
          pageCount: pages.length,
          fetchedCount,
          total,
          error: "Recorded decision continuity reached a full page without pagination metadata, so completeness cannot be confirmed."
        });
      }
      return resultFor({
        state: "ready",
        pages,
        pageSize: requestedPageSize,
        maxPages: requestedMaxPages,
        maxRecords: requestedMaxRecords,
        pageCount: pages.length,
        fetchedCount,
        total
      });
    }

    if (!rows.length) {
      return resultFor({
        state: "truncated",
        pages,
        pageSize: requestedPageSize,
        maxPages: requestedMaxPages,
        maxRecords: requestedMaxRecords,
        pageCount: pages.length,
        fetchedCount,
        total,
        error: "Recorded decision continuity stopped because the server reported another page but returned no branch records."
      });
    }

    const nextOffset = pagination.nextOffset ?? pagination.offset + pagination.limit;
    if (nextOffset <= offset) {
      return resultFor({
        state: "truncated",
        pages,
        pageSize: requestedPageSize,
        maxPages: requestedMaxPages,
        maxRecords: requestedMaxRecords,
        pageCount: pages.length,
        fetchedCount,
        total,
        error: "Recorded decision continuity stopped because pagination did not advance."
      });
    }
    offset = nextOffset;
  }

  return resultFor({
    state: "truncated",
    pages,
    pageSize: requestedPageSize,
    maxPages: requestedMaxPages,
    maxRecords: requestedMaxRecords,
    pageCount: pages.length,
    fetchedCount,
    total,
    error: `Recorded decision continuity stopped after ${requestedMaxPages} pages to keep this browser request bounded.`
  });
}

/**
 * Fetches the graph pages with the same bounded contract as branches. The
 * server's `returned` count describes source branch rows, not graph nodes, so
 * it is removed only for the generic page-progress validator below.
 */
export async function fetchDecisionGraphPages({ requestPage, ...options } = {}) {
  const graphPages = [];
  const result = await fetchDecisionBranchPages({
    ...options,
    requestPage: async (request) => {
      const payload = await requestPage(request);
      const source = record(payload);
      const pagination = { ...record(source.pagination) };
      delete pagination.returned;
      graphPages.push({ graph: record(source.graph) });
      return {
        branches: asArray(record(source.graph).nodes),
        pagination
      };
    }
  });
  return {
    state: result.state,
    error: result.error,
    pagination: result.pagination,
    graph: mergeDecisionGraphPages(graphPages),
    // Graph pagination covers branches. The current API does not expose an
    // event cursor, event total, or event-completeness flag, so annotations
    // must remain visibly qualified even when all branch pages are present.
    eventCoverage: "unconfirmed"
  };
}

export const DECISION_BRANCH_PAGINATION_DEFAULTS = Object.freeze({
  pageSize: DEFAULT_PAGE_SIZE,
  maxPages: DEFAULT_MAX_PAGES,
  maxRecords: DEFAULT_PAGE_SIZE * DEFAULT_MAX_PAGES
});
