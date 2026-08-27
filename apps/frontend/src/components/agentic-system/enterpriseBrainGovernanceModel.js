function array(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeEnterpriseBrainOverview(payload = {}) {
  const source = record(payload);
  const policy = record(source.policy);
  const controls = Array.isArray(policy.controls)
    ? policy.controls
    : Object.keys(record(policy.controls));
  const budgets = array(source.budgets).map((item) => {
    const budget = record(item);
    const totals = record(budget.totals);
    const limitUsd = finite(budget.limitUsd ?? budget.amountUsd ?? budget.limitAmount);
    const reservedUsd = finite(budget.reservedUsd ?? totals.reservedAmount);
    const settledUsd = finite(budget.settledUsd ?? budget.spentUsd ?? totals.settledAmount);
    return {
      id: text(budget.id, "budget-not-recorded"),
      scope: text(budget.scope ?? budget.budgetKey ?? budget.applicationId, "enterprise"),
      status: text(budget.status ?? budget.lifecycleStatus, "active"),
      limitUsd,
      reservedUsd,
      settledUsd,
      availableUsd: finite(totals.availableAmount, Math.max(0, Number((limitUsd - reservedUsd - settledUsd).toFixed(6))))
    };
  });
  const routeReceipts = array(source.modelRouteReceipts ?? source.routeReceipts).map((item) => {
    const receipt = record(item);
    return {
      id: text(receipt.id, "route-not-recorded"),
      status: text(receipt.status, "unknown"),
      provider: text(receipt.provider, "No model selected"),
      modelId: text(receipt.modelId, ""),
      estimatedCostUsd: finite(receipt.estimatedCostUsd ?? receipt.estimatedCost),
      denialReasons: array(receipt.denialReasons ?? receipt.reasonCodes).map((reason) => text(reason)).filter(Boolean),
      createdAt: text(receipt.createdAt || receipt.recordedAt)
    };
  });
  const researchRuns = array(source.researchRuns).map((item) => {
    const run = record(item);
    return {
      id: text(run.id, "research-not-recorded"),
      status: text(run.status, "unknown"),
      sourceCount: finite(run.sourceCount ?? run.citations?.length ?? (run.citation ? 1 : 0)),
      findingCount: finite(run.findingCount ?? run.findings?.length ?? (run.observation?.status === "created" ? 1 : 0)),
      createdAt: text(run.completedAt || run.createdAt || run.recordedAt)
    };
  });
  const reuseReceipts = array(source.reuseReceipts).map((item) => {
    const receipt = record(item);
    return {
      id: text(receipt.id, "reuse-not-recorded"),
      status: text(receipt.status, "denied"),
      resultCount: finite(receipt.resultCount ?? receipt.knowledgeIds?.length ?? receipt.knowledgeReferences?.length),
      denialReasons: array(receipt.denialReasons ?? receipt.reasonCodes).map((reason) => text(reason)).filter(Boolean),
      createdAt: text(receipt.persistedAt || receipt.createdAt)
    };
  });
  const decisionContexts = array(source.decisionContexts).map((item) => {
    const context = record(item);
    return {
      id: text(context.id, "decision-context-not-recorded"),
      branchId: text(context.branchId, "No linked branch"),
      applicationId: text(context.applicationId, "Application not recorded"),
      state: text(context.state || context.stage || context.outcome || context.status, "recorded"),
      createdAt: text(context.createdAt || context.recordedAt)
    };
  });
  return {
    enabled: source.feature?.enabled !== false,
    policy: {
      id: text(policy.id, "No policy snapshot"),
      version: text(policy.version || policy.policyVersion, "Not provisioned"),
      status: text(policy.status, Object.keys(policy).length ? "recorded" : "not_provisioned"),
      controls: controls.map((control) => text(control)).filter(Boolean)
    },
    budgets,
    routeReceipts,
    researchRuns,
    reuseReceipts,
    decisionContexts,
    notice: text(source.notice || source.explanation)
  };
}

export function enterpriseBrainMetricRows(overview = {}) {
  const source = normalizeEnterpriseBrainOverview(overview);
  return [
    { id: "budgets", label: "Budget envelopes", value: source.budgets.length },
    { id: "routes", label: "AIX route receipts", value: source.routeReceipts.length },
    { id: "research", label: "ResearchX runs", value: source.researchRuns.length },
    { id: "reuse", label: "AgenticX receipts", value: source.reuseReceipts.length },
    { id: "decisions", label: "Decision contexts", value: source.decisionContexts.length }
  ];
}
