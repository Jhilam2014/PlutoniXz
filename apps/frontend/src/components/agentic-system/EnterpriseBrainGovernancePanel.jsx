import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../../authClient.js";
import { enterpriseBrainMetricRows, normalizeEnterpriseBrainOverview } from "./enterpriseBrainGovernanceModel.js";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";

function dateLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function ReceiptList({ title, rows, empty, children }) {
  return (
    <section className="enterprise-brain-governance-list">
      <header><h4>{title}</h4><small>{rows.length} recorded</small></header>
      {rows.length ? <ol>{rows.slice(0, 5).map(children)}</ol> : <p>{empty}</p>}
    </section>
  );
}

export default function EnterpriseBrainGovernancePanel({ workspaceId = "" }) {
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");
  const [overview, setOverview] = useState(null);
  const query = useMemo(() => workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "", [workspaceId]);

  useEffect(() => {
    let active = true;
    setState("loading");
    setError("");
    authFetch(`${BACKEND_URL}/api/enterprise-brain/overview${query}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Enterprise Brain governance is unavailable.");
        if (active) {
          setOverview(normalizeEnterpriseBrainOverview(data));
          setState("ready");
        }
      })
      .catch((loadError) => {
        if (!active) return;
        setState("error");
        setError(loadError.message || "Enterprise Brain governance is unavailable.");
      });
    return () => { active = false; };
  }, [query]);

  if (state === "loading") return <section className="enterprise-brain-governance" aria-label="Enterprise Brain governance"><p role="status">Loading governed BrainX evidence…</p></section>;
  if (state === "error") return <section className="enterprise-brain-governance" aria-label="Enterprise Brain governance"><p className="enterprise-brain-governance-error" role="status">Enterprise Brain governance requires its dedicated permission. {error}</p></section>;

  const metrics = enterpriseBrainMetricRows(overview);
  return (
    <section className="enterprise-brain-governance" aria-labelledby="enterprise-brain-governance-heading">
      <header className="enterprise-brain-governance-heading">
        <div>
          <span className="plutonix-analysis-eyebrow">Governed BrainX</span>
          <h3 id="enterprise-brain-governance-heading">Enterprise policy and decision receipts</h3>
          <p>{overview.notice || "Policies, costs, research, and reusable agent knowledge are recorded as reviewable evidence. This panel cannot invoke models, change policy, or promote a decision."}</p>
        </div>
        <span className={`enterprise-brain-governance-policy ${overview.policy.status}`}>{overview.policy.status.replaceAll("_", " ")}</span>
      </header>
      <div className="enterprise-brain-governance-metrics">
        {metrics.map((metric) => <article key={metric.id}><span>{metric.label}</span><strong>{metric.value}</strong></article>)}
      </div>
      <section className="enterprise-brain-governance-policy-card" aria-label="Enterprise policy snapshot">
        <div><span>Policy snapshot</span><strong>{overview.policy.version}</strong></div>
        <p>{overview.policy.controls.length ? `Controls: ${overview.policy.controls.join(", ")}` : "No tenant policy is provisioned. Governed model routing remains fail-closed when enabled."}</p>
      </section>
      <div className="enterprise-brain-governance-columns">
        <ReceiptList title="Budget envelopes" rows={overview.budgets} empty="No enterprise budget envelope is recorded.">
          {(budget) => <li key={budget.id}><strong>{budget.scope}</strong><small>${budget.availableUsd.toFixed(4)} available of ${budget.limitUsd.toFixed(4)} · {budget.status}</small></li>}
        </ReceiptList>
        <ReceiptList title="AIX model routing" rows={overview.routeReceipts} empty="No governed build route has been recorded.">
          {(route) => <li key={route.id}><strong>{route.provider}{route.modelId ? ` · ${route.modelId}` : ""}</strong><small>{route.status} · ${route.estimatedCostUsd.toFixed(4)} estimated</small>{route.denialReasons.length ? <small>Excluded: {route.denialReasons.join(", ")}</small> : null}</li>}
        </ReceiptList>
        <ReceiptList title="ResearchX" rows={overview.researchRuns} empty="ResearchX has no completed allowlisted research run.">
          {(run) => <li key={run.id}><strong>{run.status}</strong><small>{run.sourceCount} cited source(s) · {run.findingCount} finding(s) · {dateLabel(run.createdAt)}</small></li>}
        </ReceiptList>
        <ReceiptList title="AgenticX reuse" rows={overview.reuseReceipts} empty="No tenant knowledge retrieval receipt is recorded.">
          {(receipt) => <li key={receipt.id}><strong>{receipt.status}</strong><small>{receipt.resultCount} reusable summary result(s) · {dateLabel(receipt.createdAt)}</small>{receipt.denialReasons.length ? <small>Denied: {receipt.denialReasons.join(", ")}</small> : null}</li>}
        </ReceiptList>
      </div>
      <ReceiptList title="DecisionX contexts" rows={overview.decisionContexts} empty="No enterprise-scoped build decision context is recorded.">
        {(context) => <li key={context.id}><strong>{context.applicationId}</strong><small>{context.state} · {context.branchId} · {dateLabel(context.createdAt)}</small></li>}
      </ReceiptList>
    </section>
  );
}
