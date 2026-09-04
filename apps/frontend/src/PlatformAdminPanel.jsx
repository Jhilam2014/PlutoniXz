import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCcw, ShieldCheck, X } from "lucide-react";
import { createPortal } from "react-dom";
import "./PlatformAdminPanel.css";

function count(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function createdAtLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

export default function PlatformAdminPanel({ open, overview, loading = false, error = "", onClose, onRefresh, onPageChange }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !overview) return null;

  const tenants = Array.isArray(overview.tenants) ? overview.tenants : [];
  const pagination = overview.pagination && typeof overview.pagination === "object" ? overview.pagination : {};
  const offset = count(pagination.offset);
  const limit = Math.max(1, count(pagination.limit) || 25);
  const total = count(pagination.total);
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasPrevious = pagination.hasPrevious === true || offset > 0;
  const hasMore = pagination.hasMore === true;
  const previousOffset = count(pagination.previousOffset ?? Math.max(0, offset - limit));
  const nextOffset = count(pagination.nextOffset ?? offset + limit);
  return createPortal(
    <div className="platform-admin-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="platform-admin-panel" role="dialog" aria-modal="true" aria-labelledby="platform-admin-title">
        <header className="platform-admin-titlebar">
          <div>
            <ShieldCheck size={20} />
            <span>
              <strong id="platform-admin-title">Platform administration</strong>
              <small>Authorized for a verified platform administrator</small>
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close platform administration"><X size={18} /></button>
        </header>

        <div className="platform-admin-toolbar">
          <span>{total} tenant{total === 1 ? "" : "s"} registered</span>
          <div className="platform-admin-actions">
            <span className="platform-admin-page-status">Page {currentPage} of {totalPages}</span>
            <div className="platform-admin-pagination" aria-label="Tenant pages">
              <button
                type="button"
                onClick={() => onPageChange(previousOffset)}
                disabled={loading || !hasPrevious}
                aria-label="Previous tenant page"
              >
                <ChevronLeft size={15} />
                Previous
              </button>
              <button
                type="button"
                onClick={() => onPageChange(nextOffset)}
                disabled={loading || !hasMore}
                aria-label="Next tenant page"
              >
                Next
                <ChevronRight size={15} />
              </button>
            </div>
            <button type="button" onClick={onRefresh} disabled={loading}>
              <RefreshCcw className={loading ? "spin" : ""} size={14} />
              Refresh
            </button>
          </div>
        </div>

        {error ? <p className="platform-admin-error" role="alert">{error}</p> : null}
        {loading && !tenants.length ? <p className="platform-admin-loading"><Loader2 className="spin" size={18} />Loading tenant portfolio…</p> : null}

        <div className="platform-admin-table-wrap" aria-busy={loading}>
          {tenants.length ? (
            <table className="platform-admin-table">
              <caption>All tenant instances visible to the verified platform administrator</caption>
              <thead>
                <tr>
                  <th scope="col">Tenant ID</th>
                  <th scope="col">Instance key</th>
                  <th scope="col">Created</th>
                  <th scope="col">Members</th>
                  <th scope="col">Enterprises</th>
                  <th scope="col">Applications</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={`${tenant.id}:${tenant.instanceKey}`}>
                    <th scope="row">{tenant.id || "Unknown tenant"}</th>
                    <td><code>{tenant.instanceKey || "Not assigned"}</code></td>
                    <td>{createdAtLabel(tenant.createdAt)}</td>
                    <td>{count(tenant.memberCount)}</td>
                    <td>{count(tenant.enterpriseCount)}</td>
                    <td>{count(tenant.applicationCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="platform-admin-empty">No tenant instances have been registered.</p>}
        </div>
      </section>
    </div>,
    document.body
  );
}
