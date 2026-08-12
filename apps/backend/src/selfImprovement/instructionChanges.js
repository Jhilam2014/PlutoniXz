import { SELF_IMPROVEMENT_SCHEMA_VERSION } from "./constants.js";
import { InstructionChangeSetSchema } from "./contracts.js";
import { createId, nowIso, stableHash } from "./store.js";

const APPROVED_REMOVAL_REASONS = [
  "duplicated",
  "contradictory",
  "unsafe",
  "obsolete",
  "fully_replaced"
];

function normalizedInstructionLines(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""))
    .filter((line) => line.length > 8)
    .filter((line) => !/^#+\s/.test(line))
    .map((line) => line.replace(/\s+/g, " "));
}

export function semanticInstructionDiff(previousText = "", candidateText = "") {
  const previousLines = normalizedInstructionLines(previousText);
  const candidateLines = normalizedInstructionLines(candidateText);
  const previousSet = new Set(previousLines.map((line) => line.toLowerCase()));
  const candidateSet = new Set(candidateLines.map((line) => line.toLowerCase()));
  const added = candidateLines.filter((line) => !previousSet.has(line.toLowerCase()));
  const removed = previousLines.filter((line) => !candidateSet.has(line.toLowerCase()));
  const unchanged = candidateLines.filter((line) => previousSet.has(line.toLowerCase()));
  return {
    added,
    removed,
    unchangedCount: unchanged.length,
    previousHash: stableHash(previousLines.join("\n")),
    candidateHash: stableHash(candidateLines.join("\n"))
  };
}

export function instructionDeletionAllowed({ removed = [], removalReasons = [] } = {}) {
  if (!removed.length) return true;
  if (removalReasons.length < removed.length) return false;
  return removalReasons
    .slice(0, removed.length)
    .every((reason) => APPROVED_REMOVAL_REASONS.includes(String(reason || "").trim()));
}

export function createInstructionChangeSet({
  proposal,
  instructionPath,
  previousText = "",
  candidateText = "",
  removalReasons = [],
  reviewerDecision = "pending"
} = {}) {
  const diff = semanticInstructionDiff(previousText, candidateText);
  const deletionAllowed = instructionDeletionAllowed({ removed: diff.removed, removalReasons });
  return InstructionChangeSetSchema.parse({
    id: createId("si_instruction"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    correlationId: proposal?.correlationId || createId("si_cycle"),
    source: "self-improvement-instruction-change-guard",
    timestamp: nowIso(),
    status: reviewerDecision === "approved" && deletionAllowed ? "reviewed" : "proposed",
    evidenceRefs: proposal?.id ? [proposal.id] : [],
    actor: "self-improvement-instruction-change-guard",
    modelProfile: proposal?.modelProfile || "",
    proposalId: proposal?.proposalId || "",
    instructionPath,
    previousVersionRef: diff.previousHash,
    candidateVersionRef: diff.candidateHash,
    semanticDiff: [
      ...diff.added.map((line) => `added: ${line}`),
      ...diff.removed.map((line) => `removed: ${line}`)
    ],
    capabilitiesAdded: diff.added,
    capabilitiesChanged: [],
    capabilitiesRemoved: diff.removed,
    removalReasons,
    evaluationResults: {
      unchangedCount: diff.unchangedCount,
      deletionAllowed,
      rootInstruction: /(^|\/)AGENTS\.md$/.test(instructionPath || "")
    },
    reviewerDecision,
    rollbackVersionRef: diff.previousHash
  });
}
