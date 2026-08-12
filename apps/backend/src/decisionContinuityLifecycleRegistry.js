/**
 * The decision-continuity router registers every endpoint through this
 * registry.  Keeping the classification next to the stable route key makes a
 * new mutation fail at startup unless it has an explicit durability decision
 * and a linked test.  It intentionally does not inspect server source text.
 */
export const DECISION_CONTINUITY_LIFECYCLE_ROUTES = Object.freeze({
  workflow_status: { method: "get", path: "/workflows/status", kind: "read_only", trust: "operator", permission: "workflow:read", matrix: { tenant: "identity", execution: "read", fixture: "workflow" }, tests: ["lifecycle registry inventory"] },
  workflow_job_status: { method: "get", path: "/workflows/:jobId", kind: "read_only", trust: "tenant_user", permission: "workflow:read", matrix: { tenant: "identity", execution: "read", fixture: "workflow" }, tests: ["lifecycle registry inventory"] },
  workflow_redrive: { method: "post", path: "/workflows/:jobId/redrive", kind: "transactionally_synchronous", trust: "operator", permission: "workflow:redrive", idempotency: "Idempotency-Key", matrix: { tenant: "identity", execution: "synchronous", fixture: "workflow" }, tests: ["workflow controls: redrive"] },
  readiness: { method: "get", path: "/readiness", kind: "read_only", trust: "trusted_service", permission: "decision:readiness", matrix: { tenant: "service_claim", execution: "read", fixture: "none" }, tests: ["lifecycle registry inventory"] },
  branch_list: { method: "get", path: "/branches", kind: "read_only", trust: "tenant_user", permission: "decision:read", matrix: { tenant: "identity", execution: "read", fixture: "branch" }, tests: ["lifecycle registry inventory"] },
  branch_create: { method: "post", path: "/branches", kind: "durably_asynchronous", trust: "tenant_user", permission: "decision:propose", idempotency: "Idempotency-Key", jobType: "branch_create", matrix: { tenant: "identity", execution: "durable_queue", fixture: "none", jsonBody: true }, tests: ["workflow controls: lifecycle handlers"] },
  graph: { method: "get", path: "/graph", kind: "read_only", trust: "tenant_user", permission: "decision:read", matrix: { tenant: "identity", execution: "read", fixture: "branch" }, tests: ["lifecycle registry inventory"] },
  branch_get: { method: "get", path: "/branches/:branchId", kind: "read_only", trust: "tenant_user", permission: "decision:read", matrix: { tenant: "identity", execution: "read", fixture: "branch" }, tests: ["lifecycle registry inventory"] },
  branch_events: { method: "get", path: "/branches/:branchId/events", kind: "read_only", trust: "tenant_user", permission: "decision:read", matrix: { tenant: "identity", execution: "read", fixture: "branch" }, tests: ["lifecycle registry inventory"] },
  branch_compare: { method: "get", path: "/branches/:branchId/compare/:otherBranchId", kind: "read_only", trust: "tenant_user", permission: "decision:read", matrix: { tenant: "identity", execution: "read", fixture: "branch_pair" }, tests: ["lifecycle registry inventory"] },
  disposition: { method: "post", path: "/branches/:branchId/disposition", kind: "durably_asynchronous", trust: "operator", permission: "decision:operate", idempotency: "derived branch/revision/status", jobType: "disposition", matrix: { tenant: "identity", execution: "durable_queue", fixture: "branch", jsonBody: true }, tests: ["workflow controls: lifecycle handlers"] },
  condition_event: { method: "post", path: "/condition-events", kind: "durably_asynchronous", trust: "trusted_service", permission: "decision:condition_ingest", idempotency: "eventId", jobType: "condition_event", matrix: { tenant: "service_claim", execution: "durable_queue", fixture: "none", jsonBody: true }, tests: ["workflow controls: lifecycle handlers"] },
  reconsideration_list: { method: "get", path: "/reconsiderations", kind: "read_only", trust: "tenant_user", permission: "decision:read", matrix: { tenant: "identity", execution: "read", fixture: "reconsideration" }, tests: ["lifecycle registry inventory"] },
  qagent_run_list: { method: "get", path: "/qagent-runs", kind: "read_only", trust: "tenant_user", permission: "decision:read", matrix: { tenant: "identity", execution: "read", fixture: "reconsideration" }, tests: ["QAgent tenant-scoped operator visibility"] },
  evaluation: { method: "post", path: "/reconsiderations/:reconsiderationId/evaluation", kind: "durably_asynchronous", trust: "trusted_service", principalTypes: ["human", "service"], permission: "decision:evaluate", idempotency: "derived reconsideration/revision", jobType: "evaluation", matrix: { tenant: "service_claim", execution: "durable_queue", fixture: "reconsideration", jsonBody: true }, tests: ["workflow controls: lifecycle handlers"] },
  policy: { method: "post", path: "/reconsiderations/:reconsiderationId/policy", kind: "durably_asynchronous", trust: "trusted_service", permission: "decision:policy", idempotency: "derived reconsideration/revision", jobType: "policy", matrix: { tenant: "service_claim", execution: "durable_queue", fixture: "reconsideration", jsonBody: true }, tests: ["workflow controls: lifecycle handlers"] },
  approval: { method: "post", path: "/reconsiderations/:reconsiderationId/approval", kind: "durably_asynchronous", trust: "operator", permission: "decision:approve", idempotency: "derived reconsideration/revision", jobType: "approval", matrix: { tenant: "identity", execution: "durable_queue", fixture: "reconsideration", jsonBody: true }, tests: ["workflow controls: lifecycle handlers"] },
  canary_start: { method: "post", path: "/reconsiderations/:reconsiderationId/canary", kind: "durably_asynchronous", trust: "operator", permission: "decision:canary", idempotency: "derived reconsideration/revision", jobType: "canary_start", matrix: { tenant: "identity", execution: "durable_queue", fixture: "reconsideration", jsonBody: true }, tests: ["workflow controls: lifecycle handlers"] },
  canary_outcome: { method: "post", path: "/canaries/:canaryId/outcome", kind: "durably_asynchronous", trust: "trusted_service", permission: "decision:condition_ingest", idempotency: "derived canary/revision", jobType: "canary_outcome", matrix: { tenant: "service_claim", execution: "durable_queue", fixture: "canary", jsonBody: true }, tests: ["workflow controls: lifecycle handlers"] }
});

const MATRIX_TENANT_MODES = new Set(["identity", "service_claim", "none"]);
const MATRIX_EXECUTION_MODES = new Set(["read", "durable_queue", "synchronous"]);

export function decisionContinuityHttpSecurityMatrix() {
  return Object.entries(DECISION_CONTINUITY_LIFECYCLE_ROUTES).map(([key, route]) => ({
    key,
    method: route.method,
    path: route.path,
    kind: route.kind,
    trust: route.trust,
    principalTypes: route.principalTypes || null,
    permission: route.permission,
    jobType: route.jobType || null,
    idempotency: route.idempotency || null,
    ...route.matrix
  }));
}

export function assertDecisionContinuityHttpSecurityCoverage(matrix = decisionContinuityHttpSecurityMatrix()) {
  const expected = Object.entries(DECISION_CONTINUITY_LIFECYCLE_ROUTES);
  const seen = new Set();
  for (const item of matrix) {
    const route = DECISION_CONTINUITY_LIFECYCLE_ROUTES[item.key];
    if (!route) throw new Error(`Decision-continuity HTTP matrix contains unknown route ${item.key}.`);
    if (seen.has(item.key)) throw new Error(`Decision-continuity HTTP matrix covers route ${item.key} more than once.`);
    if (
      route.method !== item.method || route.path !== item.path || route.kind !== item.kind || route.trust !== item.trust || JSON.stringify(route.principalTypes || null) !== JSON.stringify(item.principalTypes || null) || route.permission !== item.permission ||
      (route.jobType || null) !== item.jobType || (route.idempotency || null) !== item.idempotency
    ) {
      throw new Error(`Decision-continuity HTTP matrix policy does not match registry route ${item.key}.`);
    }
    if (!MATRIX_TENANT_MODES.has(item.tenant) || !MATRIX_EXECUTION_MODES.has(item.execution) || !item.fixture) {
      throw new Error(`Decision-continuity HTTP matrix route ${item.key} is missing executable tenant, execution, or fixture metadata.`);
    }
    if (route.kind === "durably_asynchronous" && item.execution !== "durable_queue") {
      throw new Error(`Decision-continuity HTTP matrix route ${item.key} must use the durable queue.`);
    }
    if (route.kind === "transactionally_synchronous" && item.execution !== "synchronous") {
      throw new Error(`Decision-continuity HTTP matrix route ${item.key} must remain transactionally synchronous.`);
    }
    if (route.kind === "read_only" && item.execution !== "read") {
      throw new Error(`Decision-continuity HTTP matrix route ${item.key} must remain read-only.`);
    }
    seen.add(item.key);
  }
  if (seen.size !== expected.length) {
    const missing = expected.map(([key]) => key).filter((key) => !seen.has(key));
    throw new Error(`Decision-continuity HTTP matrix is missing routes: ${missing.join(", ")}.`);
  }
  return { inventory: expected.length, matrixCases: seen.size };
}

export function assertDecisionContinuityLifecycleCoverage(registered = []) {
  assertDecisionContinuityHttpSecurityCoverage();
  const expected = Object.entries(DECISION_CONTINUITY_LIFECYCLE_ROUTES);
  const seen = new Set();
  for (const [key, route] of expected) {
    if (!route.kind || !route.trust || !route.permission || !route.matrix || !Array.isArray(route.tests) || !route.tests.length) {
      throw new Error(`Decision-continuity lifecycle route ${key} is missing its required classification or test linkage.`);
    }
  }
  for (const item of registered) {
    const route = DECISION_CONTINUITY_LIFECYCLE_ROUTES[item.key];
    if (!route) throw new Error(`Decision-continuity route ${item.key} has no lifecycle classification.`);
    if (route.method !== item.method || route.path !== item.path) throw new Error(`Decision-continuity route ${item.key} does not match its registered lifecycle metadata.`);
    if (seen.has(item.key)) throw new Error(`Decision-continuity route ${item.key} was registered more than once.`);
    seen.add(item.key);
  }
  if (registered.length && seen.size !== expected.length) {
    const missing = expected.map(([key]) => key).filter((key) => !seen.has(key));
    throw new Error(`Decision-continuity lifecycle registry contains unregistered routes: ${missing.join(", ")}.`);
  }
  return { inventory: expected.length, registered: seen.size };
}
