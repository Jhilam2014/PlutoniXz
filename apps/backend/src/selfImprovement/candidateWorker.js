import fs from "fs-extra";
import path from "node:path";
import { SELF_IMPROVEMENT_SCHEMA_VERSION } from "./constants.js";
import { CandidateChangeSetSchema } from "./contracts.js";
import { createId, nowIso } from "./store.js";

export async function createIsolatedCandidate({ proposal, store, root, mode = "sandbox" } = {}) {
  const candidateId = createId("si_candidate");
  const candidateDir = path.join(store.paths.runtimeRoot, "candidates", proposal.proposalId, candidateId);
  await fs.ensureDir(candidateDir);
  const rollbackArtifact = {
    proposalId: proposal.proposalId,
    candidateId,
    createdAt: nowIso(),
    root,
    affectedFiles: proposal.affectedFiles,
    restorationPlan: proposal.affectedFiles.map((file) => ({
      path: file,
      action: "restore_from_source_control_or_recorded_backup_before_promotion",
      backupCaptured: false
    })),
    note: "This vertical slice does not patch live source. Future implementation workers must capture file snapshots or reverse patches here before promotion."
  };
  const patchPlan = {
    proposalId: proposal.proposalId,
    candidateId,
    autonomyMode: mode,
    isolation: "temporary_workspace",
    allowedOperations: [
      "read baseline inventories",
      "read affected files",
      "write candidate patch inside this candidate directory",
      "run validation commands inside candidate environment when runtime is available"
    ],
    forbiddenOperations: [
      "modify live PlutoMix source directly",
      "modify generated project workspaces for system target proposals",
      "modify secrets or .env",
      "delete features without non-regression proof"
    ],
    proposal
  };
  await fs.writeJson(path.join(candidateDir, "proposal.json"), proposal, { spaces: 2 });
  await fs.writeJson(path.join(candidateDir, "patch-plan.json"), patchPlan, { spaces: 2 });
  await fs.writeJson(path.join(candidateDir, "rollback-artifact.json"), rollbackArtifact, { spaces: 2 });
  await fs.writeFile(
    path.join(candidateDir, "README.md"),
    [
      `# Candidate ${candidateId}`,
      "",
      "This is an isolated self-improvement candidate workspace.",
      "",
      "The current safe vertical slice records the proposal, patch plan, and rollback artifact here instead of mutating the live platform source.",
      "A coding-capable implementation worker may later apply candidate-only patches in this directory and then run validation/review gates before promotion."
    ].join("\n")
  );
  return CandidateChangeSetSchema.parse({
    id: createId("si_event"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    correlationId: proposal.correlationId,
    source: "self-improvement-candidate-worker",
    timestamp: nowIso(),
    status: "candidate",
    evidenceRefs: [proposal.id, ...(proposal.evidenceRefs || [])],
    actor: "self-improvement-candidate-worker",
    modelProfile: proposal.modelProfile || "",
    proposalId: proposal.proposalId,
    candidateId,
    isolationType: "temporary_workspace",
    workspacePath: candidateDir,
    changedFiles: [],
    rollbackArtifactPath: path.join(candidateDir, "rollback-artifact.json"),
    statusReason: "Candidate metadata created in isolated workspace; live source was not modified."
  });
}
