import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, Loader2, Plus, RefreshCcw, Trash2, UserPlus, X } from "lucide-react";
import { authFetch } from "./authClient.js";
import "./TenantGovernancePanel.css";

async function responseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Tenant governance request failed.");
  return data;
}

function EnterpriseRows({ enterprises = [], applications = [], onDelete, busy }) {
  if (!enterprises.length) return <p className="tenant-governance-empty">No enterprise exists yet. Create the first one while creating an app or from this panel.</p>;
  return <div className="tenant-enterprise-list">{enterprises.map((enterprise) => {
    const apps = applications.filter((app) => app.enterpriseId === enterprise.id);
    return <article key={enterprise.id}>
      <header><div><strong>{enterprise.label}</strong><small>{enterprise.id}</small></div>{onDelete ? <button type="button" onClick={() => onDelete(enterprise)} disabled={busy || apps.length > 0} title={apps.length ? "Delete or reassign applications first" : "Delete enterprise"}><Trash2 size={14} /></button> : null}</header>
      {apps.length ? <ul>{apps.map((app) => <li key={app.id}><span>{app.name}</span><small>{app.agentSource === "enterprise" ? "Enterprise agents" : "Global community agents"}</small></li>)}</ul> : <p>No applications assigned.</p>}
    </article>;
  })}</div>;
}

export default function TenantGovernancePanel({ backendUrl, open, onClose, onChanged }) {
  const [overview, setOverview] = useState(null);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");

  async function load() {
    setState("loading");
    setError("");
    try {
      setOverview(await authFetch(`${backendUrl}/api/tenant-governance/overview`).then(responseJson));
      setState("ready");
    } catch (loadError) {
      setError(loadError.message);
      setState("error");
    }
  }

  useEffect(() => {
    if (!open) return;
    load();
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function mutate(url, options) {
    setState("saving");
    setError("");
    try {
      await authFetch(url, options).then(responseJson);
      await load();
      onChanged?.();
      return true;
    } catch (mutationError) {
      setError(mutationError.message);
      setState("error");
      return false;
    }
  }

  if (!open) return null;
  const busy = state === "loading" || state === "saving";
  return createPortal(<div className="tenant-governance-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="tenant-governance-panel" role="dialog" aria-modal="true" aria-labelledby="tenant-governance-title">
      <header className="tenant-governance-titlebar"><div><Building2 size={20} /><span><strong id="tenant-governance-title">Tenant &amp; enterprise administration</strong><small>{overview?.tenant?.instanceKey || "Loading tenant instance…"}</small></span></div><button type="button" onClick={onClose} aria-label="Close tenant administration"><X size={18} /></button></header>
      <div className="tenant-governance-toolbar"><span>{overview ? `${overview.limits.enterpriseCount} of ${overview.limits.enterprises} enterprises` : "Tenant portfolio"}</span><button type="button" onClick={load} disabled={busy}><RefreshCcw className={busy ? "spin" : ""} size={14} />Refresh</button></div>
      {error ? <p className="tenant-governance-error" role="alert">{error}</p> : null}
      {state === "loading" && !overview ? <p className="tenant-governance-loading"><Loader2 className="spin" size={18} />Loading governed tenant records…</p> : null}
      {overview ? <div className="tenant-governance-body">
        <section><h3>Enterprises and applications</h3><EnterpriseRows enterprises={overview.enterprises} applications={overview.applications} busy={busy} onDelete={overview.authorization?.canManage ? (enterprise) => mutate(`${backendUrl}/api/tenant-governance/enterprises/${encodeURIComponent(enterprise.id)}`, { method: "DELETE" }) : null} /></section>
        <section className="tenant-governance-actions"><h3>Tenant administration</h3>{overview.authorization?.canManage ? <><form onSubmit={async (event) => { event.preventDefault(); if (await mutate(`${backendUrl}/api/tenant-governance/enterprises`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) })) setLabel(""); }}><label><span>Enterprise label</span><input value={label} onChange={(event) => setLabel(event.target.value)} minLength={2} maxLength={80} required placeholder="e.g. Northwind Platform" /></label><button type="submit" disabled={busy || !overview.limits.canCreateEnterprise || label.trim().length < 2}><Plus size={14} />Create</button></form>{!overview.limits.canCreateEnterprise ? <small>Two-enterprise limit reached. Delete an empty enterprise before creating another.</small> : null}
          <form onSubmit={async (event) => { event.preventDefault(); if (await mutate(`${backendUrl}/api/tenant-governance/team-invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, roles: ["team_member"] }) })) setEmail(""); }}><label><span>Team member email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="member@company.com" /></label><button type="submit" disabled={busy || !email.trim()}><UserPlus size={14} />Invite</button></form>
          </> : <p>Tenant administration controls require the tenant administrator role.</p>}
          <div className="tenant-member-list"><strong>Accounts in this tenant</strong>{overview.members.length ? <ul>{overview.members.map((member) => <li key={member.id}><span>{member.name || member.email || member.id}</span><small>{member.roles.join(", ")}</small></li>)}</ul> : <p>No tenant-wide account records.</p>}{overview.invitations.filter((item) => item.status === "pending").map((item) => <p key={item.id}>Pending: {item.email}</p>)}</div>
        </section>
      </div> : null}
    </section>
  </div>, document.body);
}
