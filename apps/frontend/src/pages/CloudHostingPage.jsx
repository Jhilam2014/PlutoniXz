import { useEffect, useMemo, useState } from "react";
import CloudHostingLayout from "../components/hosting/CloudHostingLayout.jsx";
import ProjectDeploymentSelector from "../components/hosting/ProjectDeploymentSelector.jsx";
import DeploymentChatWindow from "../components/hosting/DeploymentChatWindow.jsx";
import DeploymentStageTimeline from "../components/hosting/DeploymentStageTimeline.jsx";
import ProviderSelectionCards from "../components/hosting/ProviderSelectionCards.jsx";
import StackSelectionPanel from "../components/hosting/StackSelectionPanel.jsx";
import PermissionPreview from "../components/hosting/PermissionPreview.jsx";
import CredentialOnboardingPanel from "../components/hosting/CredentialOnboardingPanel.jsx";
import DeploymentPlanPreview from "../components/hosting/DeploymentPlanPreview.jsx";
import DeploymentProgress from "../components/hosting/DeploymentProgress.jsx";
import DeploymentLogsViewer from "../components/hosting/DeploymentLogsViewer.jsx";
import DeploymentResultCard from "../components/hosting/DeploymentResultCard.jsx";
import RollbackPanel from "../components/hosting/RollbackPanel.jsx";
import ArchitectureCanvas from "../components/hosting/ArchitectureCanvas.jsx";
import { authFetch } from "../authClient.js";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";
const credentialOptions = [
  {
    id: "oidc",
    label: "OIDC / Workload identity",
    description: "Preferred short-lived identity federation. Avoids long-lived keys and is safest for automated deploys."
  },
  {
    id: "oauth",
    label: "OAuth",
    description: "User-authorized access for cloud accounts that support delegated OAuth deployment flows."
  },
  {
    id: "workload_identity",
    label: "Cloud workload identity",
    description: "Cloud-native federation between a deployment workload and a scoped cloud service identity."
  },
  {
    id: "manual_vault_reference",
    label: "Manual vault reference",
    description: "Last-resort reference to a secret already stored in a vault. The assistant stores only metadata, not the secret value."
  }
];

async function api(path, options = {}) {
  const res = await authFetch(`${BACKEND_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Cloud hosting request failed.");
  return data;
}

function DeploymentOptionGuide({ providers, selectedProvider, session }) {
  const selectedCredential = credentialOptions.find((option) => option.id === session?.credential_method);
  return (
    <section className="hosting-side-card option-guide-card">
      <span className="eyebrow">Option guide</span>
      <h3>Selection details</h3>
      <div className="option-guide-section">
        <strong>Cloud providers</strong>
        <p>Pick the hosting target that matches your operating model. These descriptions come from the deployment provider catalog.</p>
        <ul className="option-guide-list">
          {(providers || []).map((provider) => (
            <li key={provider.id} className={provider.id === selectedProvider?.id ? "active" : ""}>
              <span>{provider.name}</span>
              <p>{provider.bestFor}</p>
              <small>{provider.recommendation}</small>
            </li>
          ))}
        </ul>
      </div>
      <div className="option-guide-section">
        <strong>Regions</strong>
        <p>
          {selectedProvider
            ? `${selectedProvider.name} supports ${(selectedProvider.regions || []).join(", ")}. Current selection: ${session?.selected_region || selectedProvider.regions?.[0] || "none"}.`
            : "Select a provider to see available deployment regions."}
        </p>
      </div>
      <div className="option-guide-section">
        <strong>Credential methods</strong>
        <ul className="option-guide-list compact">
          {credentialOptions.map((option) => (
            <li key={option.id} className={option.id === selectedCredential?.id ? "active" : ""}>
              <span>{option.label}</span>
              <p>{option.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function CloudHostingPage() {
  const [projects, setProjects] = useState([]);
  const [providers, setProviders] = useState([]);
  const [session, setSession] = useState(null);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");

  const selectedProject = useMemo(() => projects.find((project) => project.id === session?.project_id), [projects, session]);
  const selectedProvider = providers.find((provider) => provider.id === session?.selected_provider);
  const deployDisabled = session?.approval_status !== "approved" || ["running", "succeeded"].includes(session?.deployment_status);

  async function refreshSession(nextSession = session) {
    if (!nextSession?.session_id) return;
    const data = await api(`/api/hosting/sessions/${nextSession.session_id}`);
    setSession(data.session);
    const logData = await api(`/api/hosting/sessions/${nextSession.session_id}/logs`);
    setLogs(logData.logs || []);
  }

  async function start() {
    const [projectData, sessionData, providerData] = await Promise.all([
      api("/api/hosting/projects"),
      api("/api/hosting/sessions", { method: "POST", body: "{}" }),
      api("/api/hosting/providers")
    ]);
    setProjects(projectData.projects || []);
    setProviders(providerData.providers || sessionData.providers || []);
    setSession(sessionData.session);
  }

  useEffect(() => {
    start().catch((loadError) => setError(loadError.message));
  }, []);

  async function mutate(path, body) {
    setError("");
    try {
      const data = await api(path, { method: "POST", body: JSON.stringify(body || {}) });
      setSession(data.session);
      await refreshSession(data.session);
    } catch (mutateError) {
      setError(mutateError.message);
    }
  }

  const left = (
    <>
      <section className="hosting-panel">
        <span className="eyebrow">Cloud Hosting</span>
        <h1>Deploy generated projects safely</h1>
        <ProjectDeploymentSelector
          projects={projects}
          selectedProjectId={session?.project_id}
          onSelect={(projectId) => mutate(`/api/hosting/sessions/${session.session_id}/select-project`, { projectId })}
        />
        {selectedProject ? <p>{selectedProject.name} will deploy from its generated workspace on port {selectedProject.port}.</p> : null}
      </section>
      <DeploymentStageTimeline currentStage={session?.current_stage || "project_selection"} />
    </>
  );

  const main = (
    <>
      <section className="hosting-hero">
        <div>
          <span className="eyebrow">Interactive deployment assistant</span>
          <h2>Chat through project, provider, credentials, approval, deploy, health check, and rollback.</h2>
        </div>
        {error ? <strong className="hosting-error">{error}</strong> : null}
      </section>
      <DeploymentChatWindow
        messages={session?.messages || []}
        onSend={(message) => mutate(`/api/hosting/sessions/${session.session_id}/message`, { message })}
      />
      <section className="hosting-actions">
        <div>
          <h3>Provider</h3>
          <ProviderSelectionCards
            providers={providers}
            selectedProvider={session?.selected_provider}
            onSelect={(providerId) => mutate(`/api/hosting/sessions/${session.session_id}/select-provider`, { providerId })}
          />
        </div>
        {selectedProvider ? (
          <label className="hosting-field compact">
            <span>Region</span>
            <select
              value={session?.selected_region || selectedProvider.regions?.[0] || ""}
              onChange={(event) => mutate(`/api/hosting/sessions/${session.session_id}/select-region`, { region: event.target.value })}
            >
              {(selectedProvider.regions || []).map((region) => <option key={region}>{region}</option>)}
            </select>
          </label>
        ) : null}
      </section>
    </>
  );

  const right = (
    <>
      <DeploymentOptionGuide providers={providers} selectedProvider={selectedProvider} session={session} />
      <StackSelectionPanel session={session} project={selectedProject} provider={selectedProvider} onConfirm={() => mutate(`/api/hosting/sessions/${session.session_id}/select-stack`, {})} />
      <ArchitectureCanvas project={selectedProject} provider={selectedProvider} session={session} />
      <section className="hosting-side-card">
        <h3>Credential method</h3>
        <div className="hosting-button-row">
          {credentialOptions.map((option) => (
            <button key={option.id} type="button" onClick={() => mutate(`/api/hosting/sessions/${session.session_id}/credential-method`, { credentialMethod: option.id })}>
              {option.label}
            </button>
          ))}
        </div>
      </section>
      <PermissionPreview preview={session?.permission_preview} />
      <CredentialOnboardingPanel
        disabled={!session?.credential_method}
        onSubmit={(credentialMethod, credentialPayload) =>
          mutate(`/api/hosting/sessions/${session.session_id}/credentials`, { credentialPayload: { ...credentialPayload, credentialMethod } })
        }
      />
      <DeploymentPlanPreview
        plan={session?.deployment_plan}
        approved={session?.approval_status === "approved"}
        onPreview={() => mutate(`/api/hosting/sessions/${session.session_id}/preview`)}
        onApprove={() => mutate(`/api/hosting/sessions/${session.session_id}/approve`)}
      />
      <DeploymentProgress session={session} disabled={deployDisabled} onDeploy={() => mutate(`/api/hosting/sessions/${session.session_id}/deploy`)} />
      <DeploymentLogsViewer logs={logs} />
      <DeploymentResultCard session={session} />
      <RollbackPanel
        session={session}
        onRollback={() => mutate(`/api/hosting/sessions/${session.session_id}/rollback`)}
        onCancel={() => mutate(`/api/hosting/sessions/${session.session_id}/cancel`)}
      />
    </>
  );

  return <CloudHostingLayout left={left} main={main} right={right} />;
}
