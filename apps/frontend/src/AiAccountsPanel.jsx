import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, KeyRound, Loader2, LogOut, Pencil, Plus, RefreshCw, ShieldAlert, ShieldCheck, Trash2, X } from "lucide-react";
import { authFetch } from "./authClient.js";
import { activeProviderSummary, authMethodLabel, consumeEphemeralSecret, defaultProviderAuthMethod, providerActions, providerLogoSource, providerStatusLabel, safeLoginBody, TERMINAL_PROVIDER_LOGIN_STATES } from "./aiProviderModel.js";

function initials(name) {
  return String(name || "AI").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The provider operation could not be completed.");
  return body;
}

export default function AiAccountsPanel({ backendUrl, workspaceId, currentUserId, open, onClose, selectedProviderId, onSelectedProviderChange, onSummaryChange }) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [workingKey, setWorkingKey] = useState("");
  const [connectProviderId, setConnectProviderId] = useState("");
  const [authMethod, setAuthMethod] = useState("browser_oauth");
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [loginSession, setLoginSession] = useState(null);
  const [browserNotice, setBrowserNotice] = useState("");
  const openedChallengeRef = useRef("");

  const load = useCallback(async ({ refresh = false } = {}) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (workspaceId) params.set("workspaceId", workspaceId);
      if (refresh) params.set("refresh", "true");
      const data = await responseJson(await authFetch(`${backendUrl}/api/ai-providers?${params.toString()}`));
      setProviders(data.providers || []);
      const summary = activeProviderSummary(data.providers, selectedProviderId);
      onSummaryChange?.(summary);
      if (summary.providerId !== selectedProviderId && summary.valid) onSelectedProviderChange?.(summary.providerId);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, workspaceId, currentUserId, selectedProviderId, onSelectedProviderChange, onSummaryChange]);

  useEffect(() => {
    if (currentUserId) load();
  }, [currentUserId, workspaceId, load]);

  useEffect(() => {
    if (!loginSession || TERMINAL_PROVIDER_LOGIN_STATES.has(loginSession.state)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const params = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
        const data = await responseJson(await authFetch(`${backendUrl}/api/ai-providers/${loginSession.providerId}/login/${loginSession.id}${params}`));
        setLoginSession(data.session);
        if (data.session.authorizationUrl && openedChallengeRef.current !== data.session.authorizationUrl) {
          openedChallengeRef.current = data.session.authorizationUrl;
          const popup = window.open(data.session.authorizationUrl, "_blank", "noopener,noreferrer");
          setBrowserNotice(popup ? `Opened ${data.session.destinationDomain}.` : "Your browser blocked the new tab. Use Open verification page.");
        }
        if (TERMINAL_PROVIDER_LOGIN_STATES.has(data.session.state)) {
          window.clearInterval(timer);
          await load({ refresh: true });
        }
      } catch (pollError) {
        setError(pollError.message);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [backendUrl, workspaceId, loginSession, load]);

  const connectProvider = useMemo(() => providers.find((provider) => provider.providerId === connectProviderId) || null, [providers, connectProviderId]);
  const startConnect = (provider) => {
    const method = defaultProviderAuthMethod(provider);
    if (!method) return;
    setConnectProviderId(provider.providerId);
    setAuthMethod(method);
    setDisplayName(`${provider.name} profile`);
    setSecret("");
    setLoginSession(null);
    setBrowserNotice("");
  };

  const submitConnect = async (event) => {
    event.preventDefault();
    if (!connectProvider) return;
    const ephemeralSecret = authMethod === "api_token" ? consumeEphemeralSecret(secret, setSecret) : "";
    const requestBody = safeLoginBody({ workspaceId: workspaceId || undefined, authMethod, displayName, secret: ephemeralSecret });
    setWorkingKey(`${connectProvider.providerId}:login`);
    setError("");
    try {
      const data = await responseJson(await authFetch(`${backendUrl}/api/ai-providers/${connectProvider.providerId}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      }));
      requestBody.secret = undefined;
      setLoginSession(data.session);
    } catch (connectError) {
      requestBody.secret = undefined;
      setError(connectError.message);
    } finally {
      setWorkingKey("");
    }
  };

  const mutate = async (providerId, profileId, action, body = {}) => {
    const method = action === "remove" ? "DELETE" : action === "rename" ? "PATCH" : "POST";
    const route = action === "remove" ? "" : action === "rename" ? "" : `/${action}`;
    setWorkingKey(`${providerId}:${profileId}:${action}`);
    setError("");
    try {
      await responseJson(await authFetch(`${backendUrl}/api/ai-providers/${providerId}/profiles/${profileId}${route}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspaceId || undefined, ...body })
      }));
      await load({ refresh: action === "verify" || action === "logout" });
    } catch (mutationError) {
      setError(mutationError.message);
    } finally {
      setWorkingKey("");
    }
  };

  const cancelLogin = async () => {
    if (!loginSession) return;
    setWorkingKey(`${loginSession.providerId}:cancel`);
    try {
      const data = await responseJson(await authFetch(`${backendUrl}/api/ai-providers/${loginSession.providerId}/login/${loginSession.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspaceId || undefined })
      }));
      setLoginSession(data.session);
    } catch (cancelError) {
      setError(cancelError.message);
    } finally {
      setWorkingKey("");
    }
  };

  if (!open) return null;
  return (
    <div className="ai-accounts-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="ai-accounts-panel" role="dialog" aria-modal="true" aria-labelledby="ai-accounts-title">
        <header>
          <div><KeyRound size={20} /><span><strong id="ai-accounts-title">AI Accounts</strong><small>Provider CLI profiles for {workspaceId ? "this workspace" : "your global default"}</small></span></div>
          <div className="ai-accounts-header-actions">
            <button type="button" onClick={() => load({ refresh: true })} disabled={loading} title="Refresh CLI detection"><RefreshCw className={loading ? "spin" : ""} size={16} /></button>
            <button type="button" onClick={onClose} aria-label="Close AI Accounts"><X size={18} /></button>
          </div>
        </header>
        {error ? <div className="ai-accounts-error" role="alert"><ShieldAlert size={16} /><span>{error}</span></div> : null}
        {loading && !providers.length ? <div className="ai-accounts-loading"><Loader2 className="spin" size={20} /> Detecting provider CLIs…</div> : null}
        <div className="ai-provider-grid">
          {providers.map((provider) => {
            const actions = providerActions(provider, { loginSession: loginSession?.providerId === provider.providerId ? loginSession : null });
            const active = provider.activeProfile;
            const selected = selectedProviderId === provider.providerId;
            return (
              <article key={provider.providerId} className={`ai-provider-card ${selected ? "selected" : ""}`}>
                <div className="ai-provider-card-heading">
                  <span className={`ai-provider-icon ${provider.providerId}`} title={`${provider.name} logo`}>
                    <img src={providerLogoSource(provider.providerId)} alt="" aria-hidden="true" decoding="async" onError={(event) => { event.currentTarget.hidden = true; }} />
                    <span className="ai-provider-icon-fallback" aria-hidden="true">{initials(provider.name)}</span>
                  </span>
                  <span><strong>{provider.name}</strong><small>{provider.installation.installed ? provider.installation.version || "Version unavailable" : "CLI not detected"}</small></span>
                  <span className={`ai-provider-status status-${provider.status}`}>{providerStatusLabel(provider.status)}</span>
                </div>
                <dl>
                  <div><dt>Active profile</dt><dd>{active?.displayName || "None"}</dd></div>
                  <div><dt>Account</dt><dd>{active?.accountLabel || "Not available"}</dd></div>
                  <div><dt>Authentication</dt><dd>{active ? authMethodLabel(active.authMethod) : "—"}</dd></div>
                  <div><dt>Expiry</dt><dd>{active?.expiresAt ? new Date(active.expiresAt).toLocaleString() : "Not reported"}</dd></div>
                  <div><dt>Last verified</dt><dd>{active?.lastVerifiedAt ? new Date(active.lastVerifiedAt).toLocaleString() : "Never"}</dd></div>
                </dl>
                <div className="ai-provider-capabilities" aria-label="Supported capabilities">
                  {provider.capabilities.length ? provider.capabilities.map((capability) => <span key={capability}>{capability.replaceAll("_", " ")}</span>) : <span>Detection only</span>}
                </div>
                {provider.profiles?.length ? (
                  <div className="ai-profile-list">
                    {provider.profiles.map((profile) => (
                      <div key={profile.id} className={profile.isActive ? "active" : ""}>
                        <span>{profile.isActive ? <Check size={13} /> : null}<span><strong>{profile.displayName}</strong><small>{providerStatusLabel(profile.status)}{profile.activeScope ? ` · ${profile.activeScope}` : ""}</small></span></span>
                        <span>
                          {!profile.isActive && provider.capabilities.includes("profile_switch") && profile.status === "connected" ? <button type="button" onClick={() => mutate(provider.providerId, profile.id, "activate", { scope: workspaceId ? "workspace" : "global" })} disabled={Boolean(workingKey)}>Switch</button> : null}
                          <button type="button" title="Verify profile" onClick={() => mutate(provider.providerId, profile.id, "verify")} disabled={Boolean(workingKey)}><ShieldCheck size={14} /></button>
                          <button type="button" title="Rename local profile" onClick={() => { const name = window.prompt("Local profile name", profile.displayName); if (name && name !== profile.displayName) mutate(provider.providerId, profile.id, "rename", { displayName: name }); }} disabled={Boolean(workingKey)}><Pencil size={14} /></button>
                          {provider.capabilities.includes("logout") && profile.status === "connected" && profile.authMethod !== "existing_session" ? <button type="button" title="Disconnect local profile" onClick={() => mutate(provider.providerId, profile.id, "logout")} disabled={Boolean(workingKey)}><LogOut size={14} /></button> : null}
                          {profile.status !== "connected" ? <button type="button" title="Remove profile metadata" onClick={() => mutate(provider.providerId, profile.id, "remove")} disabled={Boolean(workingKey)}><Trash2 size={14} /></button> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <p className="ai-provider-note">{provider.notes}</p>
                <footer>
                  {actions.some((action) => ["connect", "add_profile", "reconnect"].includes(action)) ? <button type="button" className="primary" onClick={() => startConnect(provider)}><Plus size={14} />{provider.profiles.length ? "Add profile" : "Connect"}</button> : null}
                  {active?.status === "connected" && provider.gothamExecutionSupported ? <button type="button" className={selected ? "selected-provider" : ""} onClick={() => { onSelectedProviderChange?.(provider.providerId); onSummaryChange?.(activeProviderSummary(providers, provider.providerId)); }}>{selected ? "Selected for Gotham" : "Use for Gotham"}</button> : null}
                  {loginSession?.providerId === provider.providerId && !TERMINAL_PROVIDER_LOGIN_STATES.has(loginSession.state) ? <button type="button" onClick={cancelLogin}>Cancel login</button> : null}
                </footer>
              </article>
            );
          })}
        </div>
        {connectProvider ? (
          <form className="ai-connect-sheet" onSubmit={submitConnect}>
            <header><div><strong>Connect {connectProvider.name}</strong><small>PlutoniX runs only the provider’s approved CLI command.</small></div><button type="button" onClick={() => setConnectProviderId("")}><X size={16} /></button></header>
            <label>Local profile name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required /></label>
            <label>Authentication method<select value={authMethod} onChange={(event) => { setAuthMethod(event.target.value); setSecret(""); }}>
              {connectProvider.authMethods.filter((method) => !["existing_session", "unsupported"].includes(method)).map((method) => <option key={method} value={method}>{authMethodLabel(method)}{method === connectProvider.preferredAuthMethod ? " (recommended)" : ""}</option>)}
            </select></label>
            {connectProvider.authMethodNotice ? <small className="ai-auth-method-notice">{connectProvider.authMethodNotice}</small> : null}
            {authMethod === "device_code" ? <small className="ai-auth-method-notice">Open the verification page and enter the one-time code shown here. No localhost callback is required.</small> : null}
            {authMethod === "api_token" ? <label>Provider token<input type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} required /><small>Sent once to the CLI over stdin. Never saved in browser storage, PlutoniX metadata, or audit events.</small></label> : null}
            {loginSession ? (
              <div className="ai-login-challenge">
                <strong>{providerStatusLabel(loginSession.state)}</strong>
                <small>{loginSession.destinationDomain ? `Destination: ${loginSession.destinationDomain}` : "Waiting for the provider CLI…"}</small>
                {loginSession.deviceCode ? <code>{loginSession.deviceCode}</code> : null}
                <div>
                  {loginSession.authorizationUrl ? <a href={loginSession.authorizationUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open verification page</a> : null}
                  {loginSession.deviceCode ? <button type="button" onClick={() => navigator.clipboard.writeText(loginSession.deviceCode)}><Copy size={14} />Copy code</button> : null}
                </div>
                {browserNotice ? <small>{browserNotice}</small> : null}
                {loginSession.error ? <p>{loginSession.error}</p> : null}
              </div>
            ) : <button className="primary" type="submit" disabled={Boolean(workingKey)}>{workingKey ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}Begin secure sign-in</button>}
          </form>
        ) : null}
      </section>
    </div>
  );
}
