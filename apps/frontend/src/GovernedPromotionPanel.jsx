import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw, RotateCcw, ShieldCheck, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { authFetch } from "./authClient.js";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";

export default function GovernedPromotionPanel() {
  const [promotion, setPromotion] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await authFetch(`${backendUrl}/api/governed-promotions/status?workspaceId=self-improvement-runtime`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Governed-promotion status is unavailable for this role.");
      setPromotion(body.promotion || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(() => load({ silent: true }), 20_000);
    return () => clearInterval(timer);
  }, []);

  const pending = useMemo(() => (promotion?.requests || []).filter((request) => ["awaiting_approval", "approved"].includes(request.status)), [promotion]);
  const running = useMemo(() => (promotion?.requests || []).filter((request) => request.status === "canary_running"), [promotion]);

  async function operation(path, payload, key) {
    setBusy(key);
    setError("");
    try {
      const response = await authFetch(`${backendUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `operator-ui-${key}` },
        body: JSON.stringify({ ...payload, workspaceId: "self-improvement-runtime" })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The governed operation was rejected.");
      await load({ silent: true });
    } catch (operationError) {
      setError(operationError.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="decision-continuity-panel" aria-label="Governed promotion operator console">
      <header className="self-improvement-header">
        <div>
          <span className="eyebrow">Governed promotion</span>
          <h2>Self-improvement Runtime Policy</h2>
          <p>Content-addressed runtime policy changes require independent evidence, exact-digest human approval, a bounded canary, and operational rollback.</p>
        </div>
        <div className="self-improvement-actions">
          <button className="ghost-action" type="button" disabled={loading} onClick={() => load()}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />} Refresh
          </button>
          <button className="ghost-action danger" type="button" disabled={Boolean(busy)} onClick={() => operation("/api/governed-promotions/kill-switch", { halted: !promotion?.halted, reason: promotion?.halted ? "operator resumed target" : "operator halted target" }, "kill-switch")}>
            {promotion?.halted ? <CheckCircle2 size={16} /> : <Square size={16} />} {promotion?.halted ? "Clear halt" : "Halt target"}
          </button>
        </div>
      </header>

      {error ? <div className="self-improvement-error">{error}</div> : null}
      <div className="decision-continuity-notice"><ShieldCheck size={17} /><span>{promotion?.target?.productionEnabled ? "The runtime selector is explicitly enabled. Operator controls remain role-gated and every action is audited." : "Production selector is disabled until both governed-promotion environment flags are configured. No candidate can change the runtime."}</span></div>
      <div className="self-improvement-grid decision-continuity-grid">
        <article><span>Current</span><strong>{promotion?.currentDigest?.slice(0, 12) || "Environment"}</strong><small>{promotion?.target?.runtimePath || "runtime path unavailable"}</small></article>
        <article><span>Previous / rollback</span><strong>{promotion?.previousDigest?.slice(0, 12) || "None"}</strong><small>Known-good target retained for reversal</small></article>
        <article><span>Pending approvals</span><strong>{pending.length}</strong><small>Exact candidate and policy digest bindings only</small></article>
        <article><span>Canary / halt</span><strong>{promotion?.halted ? "HALTED" : running.length ? "RUNNING" : "IDLE"}</strong><small>{promotion?.haltReason || (promotion?.canaryDigest ? `Candidate ${promotion.canaryDigest.slice(0, 12)}` : "No active canary")}</small></article>
      </div>

      <div className="decision-continuity-columns">
        <section>
          <header><h3>Requests and evidence</h3><small>Validator, fixture, evaluator, and policy digests are immutable references</small></header>
          {(promotion?.requests || []).length ? (
            <ol className="decision-branch-list">
              {promotion.requests.map((request) => (
                <li key={request.requestId}>
                  <div className="decision-branch-topline"><strong>{request.status.replaceAll("_", " ")}</strong><span className={`decision-status ${request.status === "rolled_back" ? "rejected" : "reconsidering"}`}>{request.requestId.slice(0, 18)}</span></div>
                  <small>Candidate {request.candidateDigest?.slice(0, 16)} · policy {request.policyDigest?.slice(0, 16) || "pending"}</small>
                  <p>Fixture {request.fixtureDigest?.slice(0, 16)} · validator {request.validatorDigest?.slice(0, 16)} · evaluator {request.evaluator?.evaluatorVersion || "pending independent review"}</p>
                  <details><summary>Approval, canary, and rollback evidence</summary><dl><div><dt>Approvals</dt><dd>{request.approvals?.length || 0} current binding(s)</dd></div><div><dt>Canary</dt><dd>{request.canary?.outcome || request.canary?.canaryId || "not started"}</dd></div><div><dt>Revision</dt><dd>{request.revision}</dd></div></dl></details>
                </li>
              ))}
            </ol>
          ) : <p className="decision-empty">No governed runtime-policy requests are visible for this tenant/workspace or your role.</p>}
        </section>
        <section>
          <header><h3>Operational controls</h3><small>These controls require the operator permission; denials are surfaced without exposing another tenant.</small></header>
          {running.length ? (
            <ol className="decision-branch-list">
              {running.map((request) => (
                <li key={request.requestId}>
                  <div className="decision-branch-topline"><strong>Canary in progress</strong><span className="decision-status reconsidering">bounded</span></div>
                  <p>{request.canary?.workItems || 0} work items observed. A threshold breach automatically restores the known-good digest.</p>
                  <button className="ghost-action danger" type="button" disabled={Boolean(busy)} onClick={() => operation(`/api/governed-promotions/requests/${encodeURIComponent(request.requestId)}/rollback`, { reason: "operator requested rollback" }, `rollback-${request.requestId}`)}><RotateCcw size={15} /> Roll back now</button>
                </li>
              ))}
            </ol>
          ) : <p className="decision-empty"><AlertTriangle size={16} /> No running canary. Promotion and rollback effects remain unavailable until an approved request reaches that stage.</p>}
        </section>
      </div>
    </section>
  );
}
