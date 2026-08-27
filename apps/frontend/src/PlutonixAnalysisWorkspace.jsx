import { useEffect, useMemo, useState } from "react";
import { authFetch } from "./authClient.js";
import { fetchDecisionBranchPages, fetchDecisionGraphPages } from "./decisionContinuityPagination.js";
import ApplicationDecisionMappingCanvas from "./components/agentic-system/ApplicationDecisionMappingCanvas.jsx";
import EnterprisePortfolioBrainCanvas from "./components/agentic-system/EnterprisePortfolioBrainCanvas.jsx";
import EnterpriseBrainGovernancePanel from "./components/agentic-system/EnterpriseBrainGovernancePanel.jsx";
import { decisionMapRows } from "./components/agentic-system/applicationDecisionMapModel.js";
import {
  applicationDecisionSummary,
  buildBrainHierarchy,
  buildPortfolioDirectory,
  decisionStateLabel,
  enterpriseAssignmentDraft,
  normalizePortfolioRelations,
  planEnterpriseAssignments,
  portfolioDecisionSummary,
  realReconsiderationSignals,
  relationsForProject
} from "./plutonixAnalysisModel.js";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJson(response) {
  return response.json().catch(() => ({}));
}

function dateLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function countLabel(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function decisionContinuityCoverageLabel(pagination) {
  const source = pagination && typeof pagination === "object" ? pagination : {};
  const loadedCount = Number.isFinite(Number(source.loadedCount)) ? Number(source.loadedCount) : 0;
  const pageCount = Number.isFinite(Number(source.pageCount)) ? Number(source.pageCount) : 0;
  const total = source.total === null || source.total === undefined || source.total === "" || !Number.isFinite(Number(source.total))
    ? null
    : Number(source.total);
  const loaded = countLabel(loadedCount, "unique recorded branch");
  const pages = countLabel(pageCount, "page");
  return total === null
    ? `Showing ${loaded} loaded from ${pages}.`
    : `Showing ${loaded}; the server reported ${countLabel(total, "branch")} across ${pages}.`;
}

function recordedCount(value) {
  return value === null || value === undefined ? "—" : value;
}

function focusAdjacentListButton(event) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const list = event.currentTarget.closest("ol");
  const buttons = list ? [...list.children].map((item) => item.querySelector(":scope > button")).filter(Boolean) : [];
  const index = buttons.indexOf(event.currentTarget);
  if (index < 0 || buttons.length < 2) return;
  const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  event.preventDefault();
  buttons[(index + direction + buttons.length) % buttons.length]?.focus();
}

function PortfolioMessage({ state, error, children }) {
  if (state === "loading") return <p className="plutonix-analysis-state" role="status">Loading portfolio analysis…</p>;
  if (state === "error") return <p className="plutonix-analysis-state plutonix-analysis-state-error" role="alert">{error}</p>;
  return children || null;
}

function ApplicationDirectory({ applications, selectedProjectId, search, onSearch, onSelectProject }) {
  return (
    <aside className="plutonix-analysis-directory" aria-label="Application directory">
      <header className="plutonix-analysis-directory-header">
        <div>
          <span className="plutonix-analysis-eyebrow">Enterprise portfolio</span>
          <h2>Applications</h2>
        </div>
        <span className="plutonix-analysis-directory-count">{countLabel(applications.length, "application")}</span>
      </header>
      <label className="plutonix-analysis-search-label">
        <span>Find application</span>
        <input
          className="plutonix-analysis-search"
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Name, status, or enterprise"
        />
      </label>
      {applications.length ? (
        <ol className="plutonix-analysis-directory-list">
          {applications.map((application) => (
            <li key={application.id}>
              <button
                className="plutonix-analysis-directory-item"
                type="button"
                aria-current={application.id === selectedProjectId ? "page" : undefined}
                onClick={() => onSelectProject(application.project)}
              >
                <span className="plutonix-analysis-directory-item-copy">
                  <strong>{application.name}</strong>
                  <small>{application.summary || "No portfolio summary is recorded."}</small>
                </span>
                <span className="plutonix-analysis-directory-item-meta">
                  <span className="plutonix-analysis-state-badge">{application.status}</span>
                  <small>{application.provenance?.label || "Application origin not recorded"}</small>
                  <small>{application.enterprise?.name || "Enterprise unassigned"}</small>
                  {application.attentionCount !== null ? <small>{countLabel(application.attentionCount, "open item")}</small> : null}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="plutonix-analysis-empty">No managed applications match this search.</p>
      )}
    </aside>
  );
}

function EnterpriseBrainHierarchy({ hierarchy, selectedProjectId }) {
  const selected = hierarchy.applications.find((application) => application.projectId === selectedProjectId) || null;
  return (
    <section className="plutonix-analysis-brain-hierarchy" aria-labelledby="plutonix-analysis-brain-heading">
      <header>
        <span className="plutonix-analysis-eyebrow">Intelligence boundary</span>
        <h3 id="plutonix-analysis-brain-heading">Enterprise Brain and App BrainX</h3>
      </header>
      <ol className="plutonix-analysis-brain-list">
        <li className="plutonix-analysis-brain-enterprise">
          <strong>{hierarchy.enterprise.label}</strong>
          <span>{hierarchy.enterprise.summary}</span>
          <small>{hierarchy.enterprise.recorded ? "A governed enterprise publication is recorded." : "No governed Enterprise Brain publication is recorded; cross-app access remains denied."}</small>
          {hierarchy.enterprise.updatedAt ? <small>Updated {dateLabel(hierarchy.enterprise.updatedAt)}</small> : null}
        </li>
        {selected ? (
          <li className="plutonix-analysis-brain-application">
            <strong>{selected.projectName} · {selected.label}</strong>
            <span>{selected.summary || "Private application evidence and decision context."}</span>
            <small>{selected.recorded ? "An application publication is recorded." : "No application publication is recorded; this BrainX remains private."}</small>
            {selected.updatedAt ? <small>Updated {dateLabel(selected.updatedAt)}</small> : null}
          </li>
        ) : null}
      </ol>
    </section>
  );
}

function EnterprisePortfolioMap({ applications, relations, hierarchy, portfolioSummary, onOpenApplication }) {
  return (
    <EnterprisePortfolioBrainCanvas
      applications={applications}
      relations={relations}
      hierarchy={hierarchy}
      portfolioSummary={portfolioSummary}
      onOpenApplication={onOpenApplication}
    />
  );
}

function EnterpriseAssignmentEditor({ project, onProjectUpdated }) {
  const initialEnterprise = project?.enterprise || project?.metadata?.enterprise || {};
  const [enterpriseId, setEnterpriseId] = useState(initialEnterprise?.id || project?.enterpriseId || "");
  const [enterpriseName, setEnterpriseName] = useState(initialEnterprise?.name || project?.enterpriseName || "");
  const [state, setState] = useState("idle");
  const [message, setMessage] = useState("");
  const savedEnterprise = enterpriseAssignmentDraft({
    id: initialEnterprise?.id || project?.enterpriseId,
    name: initialEnterprise?.name || project?.enterpriseName
  });
  const draft = enterpriseAssignmentDraft({ id: enterpriseId, name: enterpriseName });
  const assignmentChanged = draft.enterprise.id !== savedEnterprise.enterprise.id || draft.enterprise.name !== savedEnterprise.enterprise.name;
  const canSave = Boolean(project?.id) && draft.isSubmittable && assignmentChanged && state !== "saving";
  const editorHelp = draft.isInvalid
    ? "Enter both a valid lowercase enterprise ID and an enterprise name to save. Clear both fields to remove the assignment."
    : draft.isRemoval
      ? savedEnterprise.isRemoval
        ? "No enterprise assignment is recorded. Enter an ID and name to assign this application."
        : "Clear both fields only when you intend to remove this application’s enterprise assignment."
      : "A complete enterprise assignment is ready to save.";

  useEffect(() => {
    setEnterpriseId(initialEnterprise?.id || project?.enterpriseId || "");
    setEnterpriseName(initialEnterprise?.name || project?.enterpriseName || "");
    setState("idle");
    setMessage("");
  }, [project?.id, project?.enterprise?.id, project?.enterprise?.name, project?.enterpriseId, project?.enterpriseName, project?.metadata?.enterprise?.id, project?.metadata?.enterprise?.name]);

  const saveEnterprise = async (event) => {
    event?.preventDefault?.();
    if (!canSave) return;
    setState("saving");
    setMessage("");
    try {
      const response = await authFetch(`${BACKEND_URL}/api/projects/${encodeURIComponent(project.id)}/enterprise`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enterprise: draft.isRemoval
            ? null
            : draft.enterprise
        })
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Enterprise assignment update failed.");
      if (!data.project) throw new Error("The project service did not confirm the identity update.");
      setEnterpriseId(data.project.enterprise?.id || "");
      setEnterpriseName(data.project.enterprise?.name || "");
      onProjectUpdated?.(data.project);
      setState("saved");
      setMessage(data.project.enterprise ? "Enterprise assignment saved." : "Enterprise assignment removed; the application remains private.");
    } catch (error) {
      setState("error");
      setMessage(error.message || "Enterprise assignment update failed.");
    }
  };

  const updateDraft = (nextId, nextName) => {
    setEnterpriseId(nextId);
    setEnterpriseName(nextName);
    if (state !== "saving") {
      setState("idle");
      setMessage("");
    }
  };

  const actionLabel = state === "saving"
    ? "Saving enterprise…"
    : draft.isInvalid
      ? "Complete enterprise ID and name"
      : draft.isRemoval
        ? savedEnterprise.isRemoval
          ? "No enterprise assignment to remove"
          : "Remove enterprise assignment"
        : assignmentChanged
          ? "Save enterprise assignment"
          : "Enterprise assignment is up to date";

  return (
    <section className="plutonix-analysis-enterprise-editor" aria-labelledby="plutonix-analysis-enterprise-heading">
      <header>
        <div>
          <span className="plutonix-analysis-eyebrow">Portfolio classification</span>
          <h3 id="plutonix-analysis-enterprise-heading">Enterprise assignment</h3>
        </div>
      </header>
      <form className="plutonix-analysis-enterprise-form" onSubmit={saveEnterprise}>
        <label>
          <span>Enterprise ID</span>
          <input
            value={enterpriseId}
            onChange={(event) => updateDraft(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""), enterpriseName)}
            placeholder="acme-platform"
            autoComplete="off"
            minLength={2}
            maxLength={80}
            pattern="[a-z0-9][a-z0-9-]*"
            required={draft.hasName}
            aria-invalid={draft.isInvalid || undefined}
            aria-describedby="plutonix-analysis-enterprise-editor-help"
          />
        </label>
        <label>
          <span>Enterprise name</span>
          <input
            value={enterpriseName}
            onChange={(event) => updateDraft(enterpriseId, event.target.value)}
            placeholder="Acme Platform"
            autoComplete="organization"
            minLength={2}
            maxLength={80}
            required={draft.hasId}
            aria-invalid={draft.isInvalid || undefined}
            aria-describedby="plutonix-analysis-enterprise-editor-help"
          />
        </label>
        <p id="plutonix-analysis-enterprise-editor-help" className={`plutonix-analysis-enterprise-editor-help ${draft.isInvalid ? "is-error" : ""}`}>{editorHelp}</p>
        <button className="plutonix-analysis-enterprise-save" type="submit" disabled={!canSave} aria-busy={state === "saving"}>
          {actionLabel}
        </button>
      </form>
      {message ? <p className={`plutonix-analysis-enterprise-message ${state === "error" ? "plutonix-analysis-enterprise-message-error" : ""}`} role={state === "error" ? "alert" : "status"}>{message}</p> : null}
    </section>
  );
}

function enterpriseSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function EnterprisePortfolioAssignmentPanel({ applications, onProjectsUpdated }) {
  const [applicationSearch, setApplicationSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [enterpriseChoice, setEnterpriseChoice] = useState("");
  const [enterpriseId, setEnterpriseId] = useState("");
  const [enterpriseName, setEnterpriseName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState("idle");
  const [progress, setProgress] = useState({ complete: 0, total: 0 });
  const [results, setResults] = useState([]);

  const enterprises = useMemo(() => [...applications.reduce((map, application) => {
    if (application.enterprise?.id && application.enterprise?.name) {
      const current = map.get(application.enterprise.id) || { ...application.enterprise, applicationCount: 0 };
      current.applicationCount += 1;
      map.set(application.enterprise.id, current);
    }
    return map;
  }, new Map()).values()].sort((left, right) => left.name.localeCompare(right.name)), [applications]);

  const normalizedSearch = applicationSearch.trim().toLowerCase();
  const visibleApplications = applications.filter((application) => !normalizedSearch || [
    application.name,
    application.enterprise?.name,
    application.enterprise?.id
  ].join(" ").toLowerCase().includes(normalizedSearch));
  const selectedSet = new Set(selectedIds);
  const desiredEnterprise = enterpriseChoice === "__remove__"
    ? { id: "", name: "" }
    : { id: enterpriseId.trim(), name: enterpriseName.trim() };
  const assignmentPlan = planEnterpriseAssignments({ applications, selectedIds, enterprise: desiredEnterprise });
  const unchangedSelectionCount = selectedIds.length - assignmentPlan.length;
  const affectedAssignedApplications = assignmentPlan.filter((item) => item.currentEnterprise.id);
  const isRemoving = enterpriseChoice === "__remove__";
  const isCreating = enterpriseChoice === "__new__";
  const enterpriseIsValid = isRemoving || (
    desiredEnterprise.id.length >= 2
    && /^[a-z0-9][a-z0-9-]*$/.test(desiredEnterprise.id)
    && desiredEnterprise.name.length >= 2
  );
  const confirmationRequired = affectedAssignedApplications.length > 0;
  const canApply = assignmentPlan.length > 0
    && enterpriseChoice
    && enterpriseIsValid
    && (!confirmationRequired || confirmed)
    && state !== "saving";

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => applications.some((application) => application.id === id)));
  }, [applications]);

  const resetOutcome = () => {
    if (state !== "saving") setState("idle");
    setResults([]);
  };

  const toggleApplication = (applicationId) => {
    setSelectedIds((current) => current.includes(applicationId)
      ? current.filter((id) => id !== applicationId)
      : [...current, applicationId]);
    setConfirmed(false);
    resetOutcome();
  };

  const selectVisible = () => {
    setSelectedIds((current) => [...new Set([...current, ...visibleApplications.map((application) => application.id)])]);
    setConfirmed(false);
    resetOutcome();
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setConfirmed(false);
    resetOutcome();
  };

  const chooseEnterprise = (choice) => {
    setEnterpriseChoice(choice);
    setConfirmed(false);
    resetOutcome();
    const recordedEnterprise = enterprises.find((enterprise) => enterprise.id === choice);
    if (recordedEnterprise) {
      setEnterpriseId(recordedEnterprise.id);
      setEnterpriseName(recordedEnterprise.name);
    } else {
      setEnterpriseId("");
      setEnterpriseName("");
    }
  };

  const applyAssignment = async (event) => {
    event?.preventDefault?.();
    if (!canApply) return;
    setState("saving");
    setResults([]);
    setProgress({ complete: 0, total: assignmentPlan.length });
    const nextResults = [];
    const updatedProjects = [];

    for (const item of assignmentPlan) {
      try {
        const response = await authFetch(`${BACKEND_URL}/api/projects/${encodeURIComponent(item.projectId)}/enterprise`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enterprise: isRemoving ? null : { id: desiredEnterprise.id, name: desiredEnterprise.name }
          })
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "Enterprise assignment update failed.");
        if (!data.project) throw new Error("The project service did not confirm the identity update.");
        updatedProjects.push(data.project);
        nextResults.push({ projectId: item.projectId, projectName: item.projectName, status: "saved", message: isRemoving ? "Assignment removed" : `Assigned to ${desiredEnterprise.name}` });
      } catch (error) {
        nextResults.push({ projectId: item.projectId, projectName: item.projectName, status: "failed", message: error.message || "Enterprise assignment update failed." });
      }
      setProgress((current) => ({ ...current, complete: current.complete + 1 }));
    }

    const failures = nextResults.filter((result) => result.status === "failed");
    setResults(nextResults);
    setState(failures.length ? (updatedProjects.length ? "partial" : "error") : "saved");
    setSelectedIds(failures.map((result) => result.projectId));
    setConfirmed(false);
    if (updatedProjects.length) onProjectsUpdated?.(updatedProjects);
  };

  const actionLabel = isRemoving
    ? `Remove ${countLabel(assignmentPlan.length, "assignment")}`
    : `${state === "partial" ? "Retry" : "Assign"} ${countLabel(assignmentPlan.length, "application")}`;

  return (
    <section className="plutonix-analysis-enterprise-assignment-panel" aria-labelledby="plutonix-analysis-enterprise-assignment-panel-heading">
      <header>
        <div>
          <span className="plutonix-analysis-eyebrow">Portfolio management</span>
          <h3 id="plutonix-analysis-enterprise-assignment-panel-heading">Add applications to an enterprise</h3>
          <p>Classify one or more applications under an enterprise. Membership does not grant information sharing or create a dependency.</p>
        </div>
        <span className="plutonix-analysis-directory-count" role="status" aria-live="polite">{countLabel(selectedIds.length, "selected application")}</span>
      </header>
      <form className="plutonix-analysis-enterprise-assignment-grid" onSubmit={applyAssignment}>
        <fieldset className="plutonix-analysis-enterprise-application-picker">
          <legend>1. Select applications</legend>
          <label>
            <span>Find application</span>
            <input type="search" value={applicationSearch} onChange={(event) => setApplicationSearch(event.target.value)} placeholder="Application or enterprise" disabled={state === "saving"} />
          </label>
          <div className="plutonix-analysis-enterprise-selection-actions">
            <button type="button" onClick={selectVisible} disabled={!visibleApplications.length || state === "saving"} aria-label={`Select all ${countLabel(visibleApplications.length, "visible application")}`}>Select visible · {visibleApplications.length}</button>
            <button type="button" onClick={clearSelection} disabled={!selectedIds.length || state === "saving"}>Clear all selected</button>
          </div>
          <div className="plutonix-analysis-enterprise-application-list" role="group" aria-label="Managed applications">
            {visibleApplications.length ? visibleApplications.map((application) => (
              <label key={application.id}>
                <input type="checkbox" checked={selectedSet.has(application.id)} onChange={() => toggleApplication(application.id)} disabled={state === "saving"} />
                <span><strong>{application.name}</strong><small>{application.enterprise?.name || "Enterprise unassigned"}</small></span>
              </label>
            )) : <p className="plutonix-analysis-empty">No applications match this search.</p>}
          </div>
        </fieldset>
        <fieldset className="plutonix-analysis-enterprise-target-picker">
          <legend>2. Choose enterprise</legend>
          <label>
            <span>Enterprise</span>
            <select value={enterpriseChoice} onChange={(event) => chooseEnterprise(event.target.value)} disabled={state === "saving"}>
              <option value="">Choose an enterprise</option>
              {enterprises.map((enterprise) => <option key={enterprise.id} value={enterprise.id}>{enterprise.name} · {countLabel(enterprise.applicationCount, "application")}</option>)}
              <option value="__new__">Use a new enterprise label…</option>
              <option value="__remove__">Remove enterprise assignment</option>
            </select>
          </label>
          {isCreating ? (
            <div className="plutonix-analysis-enterprise-form">
              <label>
                <span>Enterprise name</span>
                <input
                  id="plutonix-analysis-new-enterprise-name"
                  value={enterpriseName}
                  onChange={(event) => {
                    const name = event.target.value;
                    setEnterpriseName(name);
                    setEnterpriseId(enterpriseSlug(name));
                    setConfirmed(false);
                    resetOutcome();
                  }}
                  placeholder="Acme Platform"
                  autoComplete="organization"
                  disabled={state === "saving"}
                  required
                  aria-invalid={!enterpriseIsValid}
                  aria-describedby="plutonix-analysis-enterprise-validation"
                />
              </label>
              <label>
                <span>Enterprise ID</span>
                <input
                  id="plutonix-analysis-new-enterprise-id"
                  value={enterpriseId}
                  onChange={(event) => {
                    setEnterpriseId(enterpriseSlug(event.target.value));
                    setConfirmed(false);
                    resetOutcome();
                  }}
                  placeholder="acme-platform"
                  autoComplete="off"
                  disabled={state === "saving"}
                  required
                  aria-invalid={!enterpriseIsValid}
                  aria-describedby="plutonix-analysis-enterprise-validation"
                />
              </label>
            </div>
          ) : null}
          {enterpriseChoice && !isCreating && !isRemoving ? <div className="plutonix-analysis-enterprise-target-summary"><strong>{enterpriseName}</strong><small>{enterpriseId} · existing enterprise</small></div> : null}
          {isCreating ? <p id="plutonix-analysis-enterprise-validation" className="plutonix-analysis-enterprise-help">This records the first application membership under a new enterprise label; it does not create a sharing agreement or Enterprise Brain. Enter a name and a lowercase ID of at least two characters. IDs may contain numbers and hyphens.</p> : null}
          <div className="plutonix-analysis-enterprise-review">
            <strong>{assignmentPlan.length
              ? isRemoving
                ? `${countLabel(assignmentPlan.length, "application")} will have no enterprise assignment.`
                : `${countLabel(assignmentPlan.length, "application")} will be assigned to ${enterpriseName || "the selected enterprise"}.`
              : selectedIds.length ? "The selected applications already match this assignment." : "Select at least one application to continue."}</strong>
            <small>{countLabel(selectedIds.length, "selected application")} · {countLabel(assignmentPlan.length, "assignment change")} · {countLabel(Math.max(0, unchangedSelectionCount), "already matching application")}. Sharing stays denied until a separate active agreement authorizes an exact direction and purpose.</small>
          </div>
          {assignmentPlan.length ? (
            <ul className="plutonix-analysis-enterprise-change-list" aria-label="Enterprise assignment changes">
              {assignmentPlan.map((item) => (
                <li key={item.projectId}>
                  <strong>{item.projectName}</strong>
                  <span>{item.currentEnterprise.name || "Unassigned"} → {isRemoving ? "Unassigned" : desiredEnterprise.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {confirmationRequired ? (
            <label className="plutonix-analysis-enterprise-confirmation">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={state === "saving"} />
              <span>{isRemoving
                ? `Confirm removing ${countLabel(affectedAssignedApplications.length, "existing assignment")}.`
                : `Confirm moving ${countLabel(affectedAssignedApplications.length, "application")} from an existing enterprise.`}</span>
            </label>
          ) : null}
          <p className="plutonix-analysis-enterprise-batch-note">Updates are applied to each application individually. Completed assignments remain saved if another application fails.</p>
          <button className="plutonix-analysis-enterprise-save" type="submit" disabled={!canApply}>
            {state === "saving" ? `Updating ${progress.complete} of ${progress.total}…` : actionLabel}
          </button>
          {results.length ? (
            <div className={`plutonix-analysis-enterprise-results ${results.some((result) => result.status === "failed") ? "has-errors" : ""}`}>
              <p className="plutonix-analysis-enterprise-result-summary" role={results.some((result) => result.status === "failed") ? "alert" : "status"} aria-atomic="true">{state === "saved" ? "Enterprise assignments updated." : "Some assignments need attention."}</p>
              <ul>{results.map((result) => <li key={result.projectId} className={`is-${result.status}`}><span>{result.projectName}</span><small>{result.message}</small></li>)}</ul>
            </div>
          ) : state === "saving" ? <p className="plutonix-analysis-enterprise-message" role="status">Updating application {progress.complete + 1} of {progress.total}.</p> : null}
        </fieldset>
      </form>
    </section>
  );
}

function PortfolioRelations({ relations, applications, selectedProjectId = "", title = "Portfolio relations" }) {
  const applicationsById = new Map(applications.map((application) => [application.id, application.name]));
  const visibleRelations = selectedProjectId ? relationsForProject(relations, selectedProjectId) : relations;
  return (
    <section className="plutonix-analysis-relations" aria-labelledby="plutonix-analysis-relations-heading">
      <header>
        <span className="plutonix-analysis-eyebrow">Recorded connections</span>
        <h3 id="plutonix-analysis-relations-heading">{title}</h3>
      </header>
      {visibleRelations.length ? (
        <div className="plutonix-analysis-relations-table-wrap">
          <table>
            <thead>
              <tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Category</th><th scope="col">Relationship</th><th scope="col">Recorded basis</th></tr>
            </thead>
            <tbody>
              {visibleRelations.map((relation) => (
                <tr key={relation.id}>
                  <td>{applicationsById.get(relation.sourceProjectId) || relation.sourceProjectId}</td>
                  <td>{applicationsById.get(relation.targetProjectId) || relation.targetProjectId}</td>
                  <td><span className={`plutonix-analysis-relation-kind plutonix-analysis-relation-kind-${relation.kind}`}>{relation.kindLabel}</span></td>
                  <td><strong>{relation.label.replaceAll("_", " ")}</strong>{relation.description ? <small>{relation.description}</small> : null}</td>
                  <td>{relation.kind === "authorized_information_sharing"
                    ? countLabel(relation.agreementCount, "active agreement")
                    : countLabel(relation.evidenceCount, "recorded reference")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="plutonix-analysis-empty">No application relationship has been recorded for this scope. PlutoniX does not infer portfolio dependencies from shared names, tags, or agents.</p>}
    </section>
  );
}

function PortfolioRelationFlow({ relations, applications, selectedProjectId = "", title = "Relation flow" }) {
  const applicationsById = new Map(applications.map((application) => [application.id, application.name]));
  const visibleRelations = selectedProjectId ? relationsForProject(relations, selectedProjectId) : relations;
  const groups = [
    { kind: "causal_dependency", label: "Causal dependencies" },
    { kind: "authorized_information_sharing", label: "Authorized information sharing" },
    { kind: "recorded_relationship", label: "Other recorded relationships" }
  ].map((group) => ({ ...group, relations: visibleRelations.filter((relation) => relation.kind === group.kind) })).filter((group) => group.relations.length);

  return (
    <section className="plutonix-analysis-relation-flow" aria-labelledby="plutonix-analysis-relation-flow-heading">
      <header>
        <span className="plutonix-analysis-eyebrow">Recorded relation flow</span>
        <h3 id="plutonix-analysis-relation-flow-heading">{title}</h3>
        <p>Each row is an explicit left-to-right record. Causal dependencies and authorized sharing rights are separate.</p>
      </header>
      {groups.length ? groups.map((group) => (
        <section className="plutonix-analysis-relation-flow-group" key={group.kind} aria-labelledby={`plutonix-analysis-relation-flow-${group.kind}`}>
          <h4 id={`plutonix-analysis-relation-flow-${group.kind}`}>{group.label}</h4>
          <ol>
            {group.relations.map((relation) => (
              <li key={relation.id}>
                <article className="plutonix-analysis-relation-endpoint"><small>Source application</small><strong>{applicationsById.get(relation.sourceProjectId) || relation.sourceProjectId}</strong></article>
                <div className="plutonix-analysis-relation-arrow" aria-hidden="true">→</div>
                <div className="plutonix-analysis-relation-label"><span className={`plutonix-analysis-relation-kind plutonix-analysis-relation-kind-${relation.kind}`}>{relation.kindLabel}</span><strong>{relation.label.replaceAll("_", " ")}</strong><small>{relation.kind === "authorized_information_sharing" ? countLabel(relation.agreementCount, "active agreement") : countLabel(relation.evidenceCount, "recorded reference")}</small></div>
                <div className="plutonix-analysis-relation-arrow" aria-hidden="true">→</div>
                <article className="plutonix-analysis-relation-endpoint"><small>Target application</small><strong>{applicationsById.get(relation.targetProjectId) || relation.targetProjectId}</strong></article>
              </li>
            ))}
          </ol>
        </section>
      )) : <p className="plutonix-analysis-empty">No cross-application relation is recorded for this scope, so no flow is shown.</p>}
    </section>
  );
}

function BranchDetailPanel({ checkpoint, reconsiderations }) {
  if (!checkpoint) {
    return <aside className="plutonix-analysis-branch-detail" aria-label="Decision detail"><p className="plutonix-analysis-empty">Choose a recorded outcome to inspect its rationale, constraints, evidence, and reconsideration signals.</p></aside>;
  }
  return (
    <aside className="plutonix-analysis-branch-detail" aria-labelledby="plutonix-analysis-branch-detail-heading">
      <header>
        <span className="plutonix-analysis-eyebrow">Checkpoint outcome</span>
        <span className={`plutonix-analysis-decision-state plutonix-analysis-decision-state-${checkpoint.state}`}>{decisionStateLabel(checkpoint.state, checkpoint.recordClassification)}</span>
      </header>
      <h3 id="plutonix-analysis-branch-detail-heading">{checkpoint.label}</h3>
      <dl className="plutonix-analysis-branch-detail-list">
        <div><dt>Status</dt><dd>{decisionStateLabel(checkpoint.state, checkpoint.recordClassification)}</dd></div>
        <div><dt>Record basis</dt><dd>{checkpoint.recordBasis}</dd></div>
        <div><dt>Time</dt><dd>{checkpoint.historicalClaim === false ? "No historical decision time is claimed for this source-derived option." : checkpoint.temporal?.createdAt ? `Recorded ${dateLabel(checkpoint.temporal.createdAt)}` : "No historical decision time is available."}</dd></div>
        <div><dt>Reason</dt><dd>{checkpoint.reason || "No decision reason is recorded."}</dd></div>
        <div><dt>Constraints</dt><dd>{checkpoint.constraints.length ? <ul>{checkpoint.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}</ul> : "No constraints are recorded."}</dd></div>
        <div><dt>Evidence</dt><dd>{checkpoint.evidenceCount ? <ul>{checkpoint.evidence.map((evidence, index) => <li key={evidence?.id || evidence?.reference || index}>{typeof evidence === "string" ? evidence : evidence?.reference || evidence?.id || "Recorded reference"}</li>)}</ul> : "No immutable references are recorded."}</dd></div>
        {checkpoint.score !== null && checkpoint.score !== undefined ? <div><dt>Analysis score</dt><dd>{checkpoint.score} · not an approval or probability</dd></div> : null}
        <div><dt>Reconsideration</dt><dd>{reconsiderations.length ? <ul>{reconsiderations.map((signal) => <li key={signal.id}><strong>{signal.status}</strong>{signal.reason ? ` · ${signal.reason}` : ""}{signal.createdAt ? ` · ${dateLabel(signal.createdAt)}` : ""}</li>)}</ul> : checkpoint.autoReconsideration ? "Monitoring is configured, but no reconsideration event is recorded." : "No reconsideration signal is recorded for this checkpoint."}</dd></div>
        {checkpoint.events?.length ? <div><dt>Ledger events</dt><dd><ul>{checkpoint.events.map((event) => <li key={event.id}>{event.type}{event.occurredAt ? ` · ${dateLabel(event.occurredAt)}` : ""}</li>)}</ul></dd></div> : null}
      </dl>
    </aside>
  );
}

function DecisionBranchCard({ branch, selected, relationship, onSelect, onNavigate }) {
  return (
    <button
      className={`plutonix-analysis-lineage-card plutonix-analysis-lineage-card-${branch.state} ${selected ? "is-selected" : ""}`}
      type="button"
      data-decision-branch-id={branch.id}
      aria-pressed={selected}
      aria-controls="plutonix-analysis-branch-detail-heading"
      onClick={() => onSelect(branch.id)}
      onKeyDown={(event) => onNavigate?.(event, branch.id)}
    >
      <span className={`plutonix-analysis-decision-state plutonix-analysis-decision-state-${branch.state}`}>{decisionStateLabel(branch.state, branch.recordClassification)}</span>
      <strong>{branch.label}</strong>
      <small>{relationship}</small>
      <small>{branch.historicalClaim === false ? "Not a historical decision" : branch.temporal?.createdAt ? dateLabel(branch.temporal.createdAt) : "Decision time unavailable"}</small>
      <span>{countLabel(branch.evidenceCount, "reference")}</span>
    </button>
  );
}

function agentsForFunctionality(agentNodesByFunctionality, functionalityId) {
  if (!(agentNodesByFunctionality instanceof Map)) return [];
  return agentNodesByFunctionality.get(functionalityId) || [];
}

function DecisionAgentNodes({ agents = [], functionalityLabel = "this functionality", compact = false }) {
  if (!agents.length) return null;
  return (
    <section className={`plutonix-analysis-decision-agent-nodes ${compact ? "is-compact" : ""}`.trim()} aria-label={`Direct agent nodes for ${functionalityLabel}`}>
      <header><span className="plutonix-analysis-eyebrow">Direct agent nodes</span><small>{agents.length === 1 ? "1 explicit association" : `${agents.length} explicit associations`}</small></header>
      <ol>
        {agents.map((agent) => (
          <li key={agent.id} className={agent.associationBasis === "analysis_assignment" ? "is-analysis-assignment" : "is-recorded-link"}>
            <span aria-hidden="true">●</span>
            <div><strong>{agent.label}</strong><small>{agent.associationBasis === "analysis_assignment" ? "Analysis assignment" : "Recorded implementation link"}</small></div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DecisionPathBoard({ summary, reconsiderations, agentNodesByFunctionality = null }) {
  const sourceCheckpoints = summary.sourceMap?.checkpoints || [];
  const recordedLineages = summary.lineages || [];
  const [view, setView] = useState(recordedLineages.length ? "recorded" : "source");
  const [lineageId, setLineageId] = useState("");
  const [functionalityId, setFunctionalityId] = useState("");
  const [branchId, setBranchId] = useState("");
  const activeLineage = recordedLineages.find((lineage) => lineage.id === lineageId) || recordedLineages[0] || null;
  const activeCheckpoint = sourceCheckpoints.find((checkpoint) => checkpoint.id === functionalityId) || sourceCheckpoints[0] || null;
  const activeLineageFunctionalityId = activeLineage?.nodes?.[0]?.functionalityId || "";
  const relatedSourceCheckpoint = sourceCheckpoints.find((checkpoint) => checkpoint.id === activeLineageFunctionalityId) || null;
  const lineageAnticipatedChoices = (relatedSourceCheckpoint?.choices || []).filter((branch) => ["anticipated", "anticipated_rejected"].includes(branch.state));
  const activeChoices = view === "recorded"
    ? [...(activeLineage?.nodes || []), ...(summary.unlinkedBranches || []), ...lineageAnticipatedChoices]
    : activeCheckpoint?.choices || [];
  const activeBranch = activeChoices.find((branch) => branch.id === branchId)
    || activeChoices.find((branch) => branch.state === "selected")
    || activeChoices.find((branch) => branch.state === "observed_current")
    || activeChoices[0]
    || null;
  const reconsiderationSignals = activeBranch ? realReconsiderationSignals(reconsiderations, activeBranch.id) : [];
  const origin = summary.applicationOrigin || { kind: "unknown_legacy", label: "Application origin not recorded" };
  const graphicalChoices = view === "recorded" ? activeLineage?.nodes || [] : activeCheckpoint?.choices || [];
  const lineageAgents = agentsForFunctionality(agentNodesByFunctionality, activeLineageFunctionalityId);
  const sourceAgents = agentsForFunctionality(agentNodesByFunctionality, activeCheckpoint?.id || "");

  const navigateBranch = (event, currentBranchId) => {
    if (event.key === "Escape") {
      event.preventDefault();
      document.getElementById(view === "recorded" ? "plutonix-analysis-lineage-root-select" : "plutonix-analysis-source-checkpoint-select")?.focus();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || graphicalChoices.length < 2) return;
    const index = graphicalChoices.findIndex((branch) => branch.id === currentBranchId);
    if (index < 0) return;
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = graphicalChoices[(index + direction + graphicalChoices.length) % graphicalChoices.length];
    event.preventDefault();
    setBranchId(next.id);
    requestAnimationFrame(() => {
      [...document.querySelectorAll("[data-decision-branch-id]")].find((element) => element.dataset.decisionBranchId === next.id)?.focus();
    });
  };

  useEffect(() => {
    const preferredView = recordedLineages.length ? "recorded" : "source";
    if ((view === "recorded" && !recordedLineages.length) || (view === "source" && !sourceCheckpoints.length)) setView(preferredView);
  }, [recordedLineages.length, sourceCheckpoints.length, view]);

  useEffect(() => {
    if (!recordedLineages.some((lineage) => lineage.id === lineageId)) setLineageId(recordedLineages[0]?.id || "");
  }, [lineageId, recordedLineages]);

  useEffect(() => {
    if (!sourceCheckpoints.some((checkpoint) => checkpoint.id === functionalityId)) setFunctionalityId(sourceCheckpoints[0]?.id || "");
  }, [functionalityId, sourceCheckpoints]);

  useEffect(() => {
    if (!activeChoices.some((branch) => branch.id === branchId)) setBranchId(activeBranch?.id || "");
  }, [activeBranch?.id, activeChoices, branchId]);

  if (!sourceCheckpoints.length && !recordedLineages.length) {
    return <section className="plutonix-analysis-decision-board" aria-label="Application decisions"><p className="plutonix-analysis-empty">No source-backed functionality or recorded decision lineage is available. Analyze this application to create an observed decision map; PlutoniX will not invent historical choices.</p></section>;
  }

  const checkpointIndex = Math.max(0, sourceCheckpoints.findIndex((checkpoint) => checkpoint.id === activeCheckpoint?.id));
  const ranks = activeLineage ? [...activeLineage.nodes.reduce((map, branch) => {
    const rows = map.get(branch.depth) || [];
    rows.push(branch);
    map.set(branch.depth, rows);
    return map;
  }, new Map()).entries()].map(([depth, nodes]) => {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const incomingEdges = activeLineage.edges.filter((edge) => nodeIds.has(edge.targetId));
    const parentGroups = [...nodes.reduce((map, node) => {
      const parentId = node.parentBranchId || "__root__";
      const rows = map.get(parentId) || [];
      rows.push(node);
      map.set(parentId, rows);
      return map;
    }, new Map()).entries()];
    return { depth, nodes, incomingEdges, parentGroups };
  }) : [];

  return (
    <section className="plutonix-analysis-decision-board plutonix-analysis-lineage-board" aria-labelledby="plutonix-analysis-decision-heading">
      <header>
        <div>
          <span className="plutonix-analysis-eyebrow">Application decision analysis</span>
          <h3 id="plutonix-analysis-decision-heading">Decision lineage</h3>
          <p>{origin.kind === "plutonix_created"
            ? "Recorded choices are separated from source-observed implementation and anticipated alternatives."
            : origin.kind === "imported"
              ? "Source-observed implementation and anticipated alternatives are mapped without claiming to reconstruct historical decisions."
              : "Application origin is unavailable, so only explicit ledger records and clearly labelled source analysis are shown."}</p>
        </div>
        <div className="plutonix-analysis-lineage-heading-meta">
          <span className={`plutonix-analysis-origin-badge is-${origin.kind}`}>{origin.label}</span>
          <small>{countLabel(recordedLineages.length, "recorded root")} · {countLabel(sourceCheckpoints.length, "source checkpoint")}</small>
        </div>
      </header>
      <div className="plutonix-analysis-lineage-legend" aria-label="Decision graph key">
        <span><i className="is-selected" />Selected by record</span>
        <span><i className="is-observed" />Source-observed current</span>
        <span><i className="is-deferred" />Recorded deferred</span>
        <span><i className="is-rejected" />Recorded rejected</span>
        <span><i className="is-anticipated" />Anticipated, not historical</span>
      </div>
      {recordedLineages.length && sourceCheckpoints.length ? (
        <nav className="plutonix-analysis-lineage-view-switcher" aria-label="Decision graph source">
          <button type="button" aria-pressed={view === "recorded"} onClick={() => { setView("recorded"); setBranchId(""); }}>Recorded lineage</button>
          <button type="button" aria-pressed={view === "source"} onClick={() => { setView("source"); setBranchId(""); }}>Source choice map</button>
        </nav>
      ) : null}

      {view === "recorded" && activeLineage ? (
        <>
          <div className="plutonix-analysis-lineage-toolbar">
            <label className="plutonix-analysis-functionality-picker">
              <span>Decision root</span>
              <select id="plutonix-analysis-lineage-root-select" value={activeLineage.id} onChange={(event) => { setLineageId(event.target.value); setBranchId(""); }}>
                {recordedLineages.map((lineage) => <option key={lineage.id} value={lineage.id}>{lineage.label}</option>)}
              </select>
            </label>
            <div className="plutonix-analysis-lineage-order-note">
              <strong>{activeLineage.chronologyStatus === "recorded" ? "Ledger record order" : activeLineage.chronologyStatus === "partial" ? "Partial ledger order" : "Recorded order unavailable"}</strong>
              <small>Connector lines use only stored parent-branch IDs. Record time is not inferred from source files.</small>
            </div>
          </div>
          <ol className="plutonix-analysis-root-index" aria-label="Recorded decision roots">
            {recordedLineages.map((lineage, index) => <li key={lineage.id}><button type="button" aria-pressed={lineage.id === activeLineage.id} onKeyDown={focusAdjacentListButton} onClick={() => { setLineageId(lineage.id); setBranchId(""); }}><span>{index + 1}</span><strong>{lineage.label}</strong><small>{countLabel(lineage.nodes.length, "branch")}</small></button></li>)}
          </ol>
          <DecisionAgentNodes agents={lineageAgents} functionalityLabel={activeLineage?.label || "this lineage"} compact />
          {lineageAnticipatedChoices.length ? (
            <section className="plutonix-analysis-lineage-anticipated-options" aria-label={`Anticipated options for ${activeLineage?.label || "this lineage"}`}>
              <header><div><span className="plutonix-analysis-eyebrow">Related anticipated option nodes</span><strong>Source-derived options outside the recorded lineage</strong></div><small>Not historical edges</small></header>
              <div>{lineageAnticipatedChoices.map((branch) => <DecisionBranchCard key={branch.id} branch={branch} selected={branch.id === activeBranch?.id} relationship="Source-derived option · no historical lineage edge" onSelect={setBranchId} onNavigate={navigateBranch} />)}</div>
            </section>
          ) : null}
          <div className="plutonix-analysis-lineage-layout">
            <div className="plutonix-analysis-lineage-scroll" role="group" aria-label={`${activeLineage.label} recorded branch lineage`}>
              <div className="plutonix-analysis-lineage-flow">
                {ranks.map(({ depth, nodes, incomingEdges, parentGroups }, rankIndex) => (
                  <section className="plutonix-analysis-lineage-rank" key={depth} aria-label={depth === 0 ? "Decision root" : `Recorded branch depth ${depth}`}>
                    {rankIndex ? <div className="plutonix-analysis-lineage-connector" aria-hidden="true"><span>→</span></div> : null}
                    <div className="plutonix-analysis-lineage-rank-copy"><span>{depth === 0 ? "Root" : `Branch ${depth}`}</span><small>{countLabel(nodes.length, "record")} · {countLabel(incomingEdges.length, "stored link")}</small></div>
                    <div className="plutonix-analysis-lineage-rank-cards">
                      {parentGroups.map(([parentId, children]) => {
                        const parent = parentId === "__root__" ? null : activeLineage.nodes.find((candidate) => candidate.id === parentId);
                        return (
                          <section className={`plutonix-analysis-lineage-parent-group ${parent ? "has-parent" : ""}`} key={parentId} aria-label={parent ? `Branches from ${parent.label}` : "Recorded root branch"}>
                            {parent ? <div className="plutonix-analysis-lineage-parent-label"><span aria-hidden="true">↳</span><small>Branches from</small><strong>{parent.label}</strong></div> : null}
                            {children.map((branch) => <DecisionBranchCard key={branch.id} branch={branch} selected={branch.id === activeBranch?.id} relationship={parent ? `Stored parent link · ${parent.label}` : "Recorded root branch"} onSelect={setBranchId} onNavigate={navigateBranch} />)}
                          </section>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
              {summary.unlinkedBranches?.length ? <section className="plutonix-analysis-unlinked-branches"><strong>Unlinked recorded branches</strong><p>These records have no safe lineage connector.</p><ul>{summary.unlinkedBranches.map((branch) => <li key={branch.id}><button type="button" onClick={() => setBranchId(branch.id)}>{branch.label}<small>{branch.lineageIssue}</small></button></li>)}</ul></section> : null}
            </div>
            <BranchDetailPanel checkpoint={activeBranch} reconsiderations={reconsiderationSignals} />
          </div>
        </>
      ) : null}

      {view === "source" && activeCheckpoint ? (
        <>
          <div className="plutonix-analysis-lineage-toolbar">
            <div className="plutonix-analysis-checkpoint-navigation">
              <button type="button" aria-label="Previous source checkpoint" disabled={checkpointIndex <= 0} onClick={() => { setFunctionalityId(sourceCheckpoints[checkpointIndex - 1]?.id || activeCheckpoint.id); setBranchId(""); }}>←</button>
              <label className="plutonix-analysis-functionality-picker">
                <span>Source checkpoint · {checkpointIndex + 1} of {sourceCheckpoints.length}</span>
                <select id="plutonix-analysis-source-checkpoint-select" value={activeCheckpoint.id} onChange={(event) => { setFunctionalityId(event.target.value); setBranchId(""); }}>
                  {sourceCheckpoints.map((checkpoint) => <option key={checkpoint.id} value={checkpoint.id}>{checkpoint.displayOrder}. {checkpoint.label}</option>)}
                </select>
              </label>
              <button type="button" aria-label="Next source checkpoint" disabled={checkpointIndex >= sourceCheckpoints.length - 1} onClick={() => { setFunctionalityId(sourceCheckpoints[checkpointIndex + 1]?.id || activeCheckpoint.id); setBranchId(""); }}>→</button>
            </div>
            <div className="plutonix-analysis-lineage-order-note">
              <strong>{summary.sourceMap.sequenceBasis === "source_inferred_delivery" ? "Anticipated implementation order" : "Source grouping · order unavailable"}</strong>
              <small>This planning sequence is inferred from static application structure. It is not historical decision chronology.</small>
            </div>
          </div>
          <ol className="plutonix-analysis-root-index" aria-label="Application source checkpoints">
            {sourceCheckpoints.map((checkpoint) => <li key={checkpoint.id}><button type="button" aria-pressed={checkpoint.id === activeCheckpoint.id} onKeyDown={focusAdjacentListButton} onClick={() => { setFunctionalityId(checkpoint.id); setBranchId(""); }}><span>{checkpoint.displayOrder}</span><strong>{checkpoint.label}</strong><small>{countLabel(checkpoint.choices.length, "choice")}</small></button></li>)}
          </ol>
          <div className="plutonix-analysis-lineage-layout">
            <div className="plutonix-analysis-source-choice-scroll" role="group" aria-label={`${activeCheckpoint.label} source-based choice map`}>
              <div className={`plutonix-analysis-source-choice-flow ${sourceAgents.length ? "has-agent-nodes" : ""}`.trim()}>
                <section className="plutonix-analysis-source-root-card">
                  <span className="plutonix-analysis-eyebrow">Application root</span>
                  <strong>{origin.label}</strong>
                  <small>{origin.kind === "imported" ? "External source baseline" : origin.kind === "plutonix_created" ? "PlutoniX build context" : "Origin unavailable"}</small>
                </section>
                <div className="plutonix-analysis-source-choice-arrow" aria-hidden="true">→</div>
                <section className="plutonix-analysis-source-checkpoint-card">
                  <span className="plutonix-analysis-eyebrow">Checkpoint {activeCheckpoint.displayOrder}</span>
                  <strong>{activeCheckpoint.label}</strong>
                  <small>{activeCheckpoint.description || "Source-derived application capability."}</small>
                  <span>{countLabel(activeCheckpoint.evidence?.length || 0, "source reference")}</span>
                </section>
                <div className="plutonix-analysis-source-choice-arrow" aria-hidden="true">→</div>
                {sourceAgents.length ? <>
                  <DecisionAgentNodes agents={sourceAgents} functionalityLabel={activeCheckpoint.label} />
                  <div className="plutonix-analysis-source-choice-arrow" aria-hidden="true">→</div>
                </> : null}
                <div className="plutonix-analysis-source-choice-branches">
                  {activeCheckpoint.choices.length ? activeCheckpoint.choices.map((branch) => <DecisionBranchCard key={branch.id} branch={branch} selected={branch.id === activeBranch?.id} relationship={branch.recordClassification === "anticipated" ? "Source-derived possibility · no historical edge" : branch.recordClassification === "source_observed" ? "Observed implementation · not a historical selection" : branch.recordClassification === "governed_disposition" ? "Governed ledger outcome" : branch.recordClassification === "recorded_summary" ? "Report disposition · chronology unavailable" : "Recorded decision context"} onSelect={setBranchId} onNavigate={navigateBranch} />) : <p className="plutonix-analysis-empty">No choice record or anticipated alternative is available for this checkpoint.</p>}
                </div>
              </div>
            </div>
            <BranchDetailPanel checkpoint={activeBranch} reconsiderations={reconsiderationSignals} />
          </div>
        </>
      ) : null}
    </section>
  );
}

function SharingPolicyNotice({ summary }) {
  const copy = summary.agreementStatus === "configured"
    ? "The agreement registry is configured. Information sharing remains denied unless an active, fully approved agreement authorizes its exact direction and purpose."
    : summary.agreementStatus === "unconfigured"
      ? "No agreement registry is configured. Information sharing remains denied."
      : summary.agreementStatus === "invalid"
        ? `${summary.agreementError || "The agreement registry is invalid."} Information sharing remains denied.`
        : "The portfolio response did not report an agreement-registry status.";
  const label = summary.agreementStatus === "not_reported" ? "Not reported" : summary.agreementStatus;
  return (
    <section className={`plutonix-analysis-sharing-policy plutonix-analysis-sharing-policy-${summary.agreementStatus}`} aria-label="Information-sharing policy status">
      <div><span className="plutonix-analysis-eyebrow">Information-sharing policy</span><strong>{label}</strong></div>
      <p>{copy}</p>
    </section>
  );
}

function PortfolioMode({ applications, assignmentApplications = applications, hierarchy, relations, portfolioSummary, onOpenApplication, onProjectsUpdated }) {
  const applicationsWithRecordedReviewNeeds = applications.filter((application) => application.attentionCount !== null);
  const knownReviewNeeds = applicationsWithRecordedReviewNeeds.reduce((total, application) => total + application.attentionCount, 0);
  return (
    <section className="plutonix-analysis-portfolio" aria-labelledby="plutonix-analysis-portfolio-heading">
      <header className="plutonix-analysis-content-header">
        <div>
          <span className="plutonix-analysis-eyebrow">Portfolio view</span>
          <h1 id="plutonix-analysis-portfolio-heading">Application portfolio</h1>
          <p>{portfolioSummary.explanation || "Source-backed application inventory, decision posture, and explicitly recorded cross-application relationships."}</p>
        </div>
      </header>
      <section className="plutonix-analysis-summary-strip" aria-label="Portfolio summary">
        <article><span>Applications</span><strong>{applications.length}</strong></article>
        <article><span>Known review needs</span><strong>{applicationsWithRecordedReviewNeeds.length ? knownReviewNeeds : "—"}</strong></article>
        <article><span>Causal dependencies</span><strong>{portfolioSummary.causalDependencyCount}</strong></article>
        <article><span>Authorized sharing</span><strong>{portfolioSummary.authorizedSharingCount}</strong></article>
      </section>
      <EnterprisePortfolioAssignmentPanel applications={assignmentApplications} onProjectsUpdated={onProjectsUpdated} />
      <SharingPolicyNotice summary={portfolioSummary} />
      <EnterprisePortfolioMap
        applications={applications}
        relations={relations}
        hierarchy={hierarchy}
        portfolioSummary={portfolioSummary}
        onOpenApplication={onOpenApplication}
      />
      <PortfolioRelationFlow relations={relations} applications={applications} />
      <PortfolioRelations relations={relations} applications={applications} />
    </section>
  );
}

function ApplicationMode({ project, applications, hierarchy, relations, decisionState, remoteState, remoteError, remotePagination, remoteGraphEventCoverage, sourceMapState, sourceMapError, analysisSource, architectureAnalysisReport, architectureAnalysisError, onAnalyzeArchitecture, analyzingArchitecture, onProjectUpdated }) {
  const [decisionRelationshipMap, setDecisionRelationshipMap] = useState(null);
  const agentNodesByFunctionality = useMemo(() => {
    if (!project?.id || decisionRelationshipMap?.projectId !== project.id) return new Map();
    return new Map(decisionMapRows(decisionRelationshipMap).map((row) => [row.functionality.sourceFunctionalityId, row.agents]));
  }, [decisionRelationshipMap, project?.id]);
  if (!project?.id) {
    return <section className="plutonix-analysis-application" aria-label="Application analysis"><p className="plutonix-analysis-empty">Choose an application from the directory to inspect its decision analysis.</p></section>;
  }
  return (
    <section className="plutonix-analysis-application" aria-labelledby="plutonix-analysis-application-heading">
      <header className="plutonix-analysis-content-header">
        <div>
          <span className="plutonix-analysis-eyebrow">Application decisions</span>
          <h1 id="plutonix-analysis-application-heading">{project.name}</h1>
          <p>Project-scoped decision evidence. Current implementation and confirmed selection remain separate states.</p>
        </div>
        <div className="plutonix-analysis-application-actions">
          <button type="button" onClick={onAnalyzeArchitecture} disabled={!onAnalyzeArchitecture || analyzingArchitecture}>
            {analyzingArchitecture ? "Analyzing application…" : "Analyze application"}
          </button>
        </div>
      </header>
      <EnterpriseBrainHierarchy hierarchy={hierarchy} selectedProjectId={project.id} />
      <EnterpriseBrainGovernancePanel workspaceId={project.id} />
      <EnterpriseAssignmentEditor project={project} onProjectUpdated={onProjectUpdated} />
      {architectureAnalysisError ? <p className="plutonix-analysis-state plutonix-analysis-state-error" role="alert">Architecture analysis: {architectureAnalysisError}</p> : null}
      {sourceMapState === "loading" ? <p className="plutonix-analysis-state" role="status">Reading the bounded source decision map…</p> : null}
      {sourceMapState === "error" ? <p className="plutonix-analysis-state plutonix-analysis-state-error" role="alert">Source decision map: {sourceMapError}</p> : null}
      {remoteState === "loading" ? <p className="plutonix-analysis-state" role="status">Loading recorded decision continuity…</p> : null}
      {remoteState === "error" ? <p className="plutonix-analysis-state plutonix-analysis-state-error" role="alert">{remoteError}{decisionState.reportBranchCount ? " Showing source-analysis records from the latest scoped report." : ""}</p> : null}
      {remoteState === "partial" ? <p className="plutonix-analysis-state plutonix-analysis-state-error" role="alert">Recorded decision continuity is incomplete. {remoteError || "Some recorded branch pages or supporting records could not be loaded."} {decisionContinuityCoverageLabel(remotePagination)}</p> : null}
      {remoteState === "truncated" ? <p className="plutonix-analysis-state plutonix-analysis-state-error" role="alert">Recorded decision continuity is truncated and must not be treated as complete. {remoteError || "The browser stopped at a safe pagination boundary."} {decisionContinuityCoverageLabel(remotePagination)}</p> : null}
      {remoteGraphEventCoverage === "unconfirmed" ? <p className="plutonix-analysis-state" role="status">Recorded event annotations may be incomplete: the graph API does not publish event pagination or total event coverage. Branch lineage uses the loaded branch ledger, not the event overlay.</p> : null}
      <section className="plutonix-analysis-summary-strip" aria-label="Application decision summary">
        <article><span>Selected by record</span><strong>{decisionState.selectedCount}</strong></article>
        <article><span>Observed current</span><strong>{decisionState.observedCurrentCount}</strong></article>
        <article><span>Recorded deferred</span><strong>{decisionState.deferredCount}</strong></article>
        <article><span>Recorded rejected</span><strong>{decisionState.rejectedCount}</strong></article>
        <article><span>Anticipated alternatives</span><strong>{decisionState.anticipatedCount}</strong></article>
        <article><span>Anticipated rejections</span><strong>{decisionState.anticipatedRejectedCount}</strong></article>
      </section>
      {analysisSource ? <p className="plutonix-analysis-analysis-source">{analysisSource === "stale_recorded_source_analysis"
        ? "Current application source is unavailable. The source choice map uses the last recorded local snapshot and may be stale; it cannot assert historical decisions."
        : `Source map: ${analysisSource.replaceAll("_", " ")}. Static analysis cannot assert historical decisions.`}</p> : null}
      <DecisionPathBoard summary={decisionState} reconsiderations={decisionState.reconsiderations} agentNodesByFunctionality={agentNodesByFunctionality} />
      <ApplicationDecisionMappingCanvas project={project} architectureAnalysisReport={architectureAnalysisReport} decisionBranches={decisionState.branchRows} onDecisionMap={setDecisionRelationshipMap} />
      <PortfolioRelationFlow relations={relations} applications={applications} selectedProjectId={project.id} title="Application relation flow" />
      <PortfolioRelations relations={relations} applications={applications} selectedProjectId={project.id} title="Application relationships" />
    </section>
  );
}

export default function PlutonixAnalysisWorkspace({
  projects = [],
  selectedProject = null,
  architectureAnalysisReport = null,
  architectureAnalysisError = "",
  onSelectProject,
  onAnalyzeArchitecture,
  analyzingArchitecture = false,
  onProjectUpdated
}) {
  const [mode, setMode] = useState("portfolio");
  const [search, setSearch] = useState("");
  const [portfolioState, setPortfolioState] = useState("loading");
  const [portfolioError, setPortfolioError] = useState("");
  const [portfolio, setPortfolio] = useState(null);
  const [decisionRemote, setDecisionRemote] = useState({ state: "idle", error: "", branches: [], reconsiderations: [], graph: null, pagination: null, graphEventCoverage: "unavailable" });
  const [sourceDecisionRemote, setSourceDecisionRemote] = useState({ state: "idle", error: "", report: null, project: null, analysisSource: "" });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setPortfolioState("loading");
    setPortfolioError("");
    authFetch(`${BACKEND_URL}/api/enterprise-portfolio`)
      .then(async (response) => {
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "Enterprise portfolio data is unavailable.");
        if (active) {
          setPortfolio(data);
          setPortfolioState("ready");
        }
      })
      .catch((error) => {
        if (!active) return;
        setPortfolio(null);
        setPortfolioError(`${error.message || "Enterprise portfolio data is unavailable."} The managed application directory is still available.`);
        setPortfolioState("error");
      });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setDecisionRemote({ state: "idle", error: "", branches: [], reconsiderations: [], graph: null, pagination: null, graphEventCoverage: "unavailable" });
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    setDecisionRemote({ state: "loading", error: "", branches: [], reconsiderations: [], graph: null, pagination: null, graphEventCoverage: "unavailable" });
    const query = new URLSearchParams({ workspaceId: projectId });
    const requestBranches = ({ offset, limit }) => {
      const branchQuery = new URLSearchParams({ limit: String(limit), offset: String(offset), workspaceId: projectId });
      return authFetch(`${BACKEND_URL}/api/decision-continuity/branches?${branchQuery}`, { signal: controller.signal })
        .then(async (response) => {
          const data = await readJson(response);
          if (!response.ok) throw new Error(data.error || "Recorded decision continuity is unavailable.");
          return data;
        });
    };
    const requestGraph = ({ offset, limit }) => {
      const graphQuery = new URLSearchParams({ limit: String(limit), offset: String(offset), workspaceId: projectId });
      return authFetch(`${BACKEND_URL}/api/decision-continuity/graph?${graphQuery}`, { signal: controller.signal })
        .then(async (response) => {
          const data = await readJson(response);
          if (!response.ok) throw new Error(data.error || "Recorded decision event graph is unavailable.");
          return data;
        });
    };
    Promise.all([
      fetchDecisionBranchPages({ requestPage: requestBranches }),
      authFetch(`${BACKEND_URL}/api/decision-continuity/reconsiderations?${query}`, { signal: controller.signal }),
      fetchDecisionGraphPages({ requestPage: requestGraph })
    ])
      .then(async ([branchResult, reconsiderationsResponse, graphResult]) => {
        const reconsiderationsPayload = await readJson(reconsiderationsResponse);
        const reconsiderationError = !reconsiderationsResponse.ok
          ? reconsiderationsPayload?.error || "Reconsideration records are unavailable."
          : "";
        const graphCoverageLabel = graphResult.state === "truncated" ? "truncated" : "incomplete";
        const graphError = graphResult.state !== "ready"
          ? graphResult.error && graphResult.error !== branchResult.error
            ? `Recorded event graph is ${graphCoverageLabel}: ${graphResult.error}`
            : `Recorded event graph is ${graphCoverageLabel}.`
          : "";
        const supportingErrors = [reconsiderationError, graphError]
          .filter((message) => message && message !== branchResult.error);
        let state = branchResult.state;
        if (supportingErrors.length && state === "ready") state = "partial";
        const error = [...new Set([branchResult.error, ...supportingErrors].filter(Boolean))].join(" ");
        if (active) setDecisionRemote({
          state,
          error,
          branches: branchResult.branches,
          reconsiderations: reconsiderationsResponse.ok ? asArray(reconsiderationsPayload.reconsiderations) : [],
          graph: graphResult.graph,
          pagination: branchResult.pagination,
          graphEventCoverage: graphResult.eventCoverage
        });
      })
      .catch((error) => {
        if (active) setDecisionRemote({ state: "error", error: error.message || "Recorded decision continuity is unavailable.", branches: [], reconsiderations: [], graph: null, pagination: null, graphEventCoverage: "unavailable" });
      });
    return () => { active = false; controller.abort(); };
  }, [selectedProject?.id, refreshKey]);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setSourceDecisionRemote({ state: "idle", error: "", report: null, project: null, analysisSource: "" });
      return undefined;
    }
    let active = true;
    setSourceDecisionRemote({ state: "loading", error: "", report: null, project: null, analysisSource: "" });
    authFetch(`${BACKEND_URL}/api/projects/${encodeURIComponent(projectId)}/decision-map`)
      .then(async (response) => {
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "Application decision map is unavailable.");
        if (active) setSourceDecisionRemote({ state: "ready", error: "", report: data.report || null, project: data.project || null, analysisSource: data.analysisSource || "" });
      })
      .catch((error) => {
        if (active) setSourceDecisionRemote({ state: "error", error: error.message || "Application decision map is unavailable.", report: null, project: null, analysisSource: "" });
      });
    return () => { active = false; };
  }, [selectedProject?.id, refreshKey]);

  const allApplications = useMemo(() => buildPortfolioDirectory({ projects, portfolio }), [portfolio, projects]);
  const directory = useMemo(() => buildPortfolioDirectory({ projects, portfolio, query: search }), [portfolio, projects, search]);
  const relations = useMemo(() => normalizePortfolioRelations(portfolio), [portfolio]);
  const hierarchy = useMemo(() => buildBrainHierarchy({ portfolio, directory: allApplications }), [allApplications, portfolio]);
  const portfolioSummary = useMemo(() => portfolioDecisionSummary(portfolio), [portfolio]);
  const scopedArchitectureReport = architectureAnalysisReport && architectureAnalysisReport.projectId === selectedProject?.id
    ? architectureAnalysisReport
    : sourceDecisionRemote.report?.projectId === selectedProject?.id
      ? sourceDecisionRemote.report
      : null;
  const decisions = useMemo(() => applicationDecisionSummary({
    architectureAnalysisReport: scopedArchitectureReport,
    branches: decisionRemote.branches,
    reconsiderations: decisionRemote.reconsiderations,
    decisionGraph: decisionRemote.graph,
    project: sourceDecisionRemote.project || selectedProject
  }), [scopedArchitectureReport, decisionRemote.branches, decisionRemote.graph, decisionRemote.reconsiderations, selectedProject, sourceDecisionRemote.project]);

  const selectProject = (project) => {
    onSelectProject?.(project);
    setMode("application");
  };

  return (
    <section className="plutonix-analysis-workspace" aria-label="PlutoniX enterprise portfolio and application decision analysis">
      <header className="plutonix-analysis-workspace-header">
        <div>
          <span className="plutonix-analysis-eyebrow">PlutoniX analysis</span>
          <strong>Enterprise portfolio and application decisions</strong>
        </div>
        <nav className="plutonix-analysis-mode-switcher" aria-label="Analysis mode">
          <button type="button" aria-pressed={mode === "portfolio"} onClick={() => setMode("portfolio")}>Portfolio</button>
          <button type="button" aria-pressed={mode === "application"} onClick={() => setMode("application")} disabled={!selectedProject?.id}>Application decisions</button>
          <button type="button" onClick={() => setRefreshKey((current) => current + 1)}>Refresh analysis</button>
        </nav>
      </header>
      <div className="plutonix-analysis-layout">
        <ApplicationDirectory
          applications={directory}
          selectedProjectId={selectedProject?.id || ""}
          search={search}
          onSearch={setSearch}
          onSelectProject={selectProject}
        />
        <div className="plutonix-analysis-content">
          <PortfolioMessage state={portfolioState} error={portfolioError} />
          {mode === "portfolio" ? (
            <PortfolioMode
              applications={directory}
              assignmentApplications={allApplications}
              hierarchy={hierarchy}
              relations={relations}
              portfolioSummary={portfolioSummary}
              onOpenApplication={selectProject}
              onProjectsUpdated={(updatedProjects) => {
                updatedProjects.forEach((project) => onProjectUpdated?.(project, { select: false }));
                setRefreshKey((current) => current + 1);
              }}
            />
          ) : (
            <ApplicationMode
              project={selectedProject}
              applications={allApplications}
              hierarchy={hierarchy}
              relations={relations}
              decisionState={decisions}
              remoteState={decisionRemote.state}
              remoteError={decisionRemote.error}
              remotePagination={decisionRemote.pagination}
              remoteGraphEventCoverage={decisionRemote.graphEventCoverage}
              sourceMapState={sourceDecisionRemote.state}
              sourceMapError={sourceDecisionRemote.error}
              analysisSource={sourceDecisionRemote.analysisSource}
              architectureAnalysisReport={scopedArchitectureReport}
              architectureAnalysisError={architectureAnalysisError}
              onAnalyzeArchitecture={onAnalyzeArchitecture}
              analyzingArchitecture={analyzingArchitecture}
              onProjectUpdated={(project) => {
                onProjectUpdated?.(project);
                setRefreshKey((current) => current + 1);
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

export { ApplicationDirectory, BranchDetailPanel, DecisionPathBoard, EnterpriseAssignmentEditor, EnterpriseBrainHierarchy, EnterprisePortfolioAssignmentPanel, PortfolioRelations };
