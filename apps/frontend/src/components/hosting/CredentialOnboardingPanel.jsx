import { useState } from "react";
import CredentialSecurityExplainer from "./CredentialSecurityExplainer.jsx";

export default function CredentialOnboardingPanel({ disabled, onSubmit }) {
  const [method, setMethod] = useState("oidc");
  const [alias, setAlias] = useState("");
  const [secret, setSecret] = useState("");

  function submit(event) {
    event.preventDefault();
    onSubmit(method, { alias, submitted: Boolean(secret), note: "secret value is not persisted or echoed" });
    setSecret("");
  }

  return (
    <form className="credential-panel" onSubmit={submit}>
      <CredentialSecurityExplainer />
      <label>
        <span>Credential method</span>
        <select value={method} onChange={(event) => setMethod(event.target.value)} disabled={disabled}>
          <option value="oidc">OIDC / Workload identity</option>
          <option value="oauth">OAuth</option>
          <option value="workload_identity">Cloud workload identity</option>
          <option value="manual_vault_reference">Manual vault reference</option>
        </select>
      </label>
      <label>
        <span>Account alias</span>
        <input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="deploy-service-account" disabled={disabled} />
      </label>
      <label>
        <span>Secure secret input</span>
        <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Never displayed after submit" disabled={disabled} />
      </label>
      <button type="submit" disabled={disabled}>Connect credential reference</button>
    </form>
  );
}
