const DISABLED_BRANCH_STATUSES = new Set(["rejected", "superseded", "archived", "retired", "disabled", "dead", "abandoned", "expired", "withdrawn"]);

function createdTime(branch) {
  const timestamp = Date.parse(branch?.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareBranches(left, right) {
  return createdTime(left.branch) - createdTime(right.branch)
    || String(left.branch?.objective?.summary || left.branch?.id || "").localeCompare(String(right.branch?.objective?.summary || right.branch?.id || ""));
}

export function isDisabledDecisionBranch(branch = {}) {
  return DISABLED_BRANCH_STATUSES.has(String(branch.status || "").trim().toLowerCase());
}

export function decisionBranchStateLabel(branch = {}) {
  return isDisabledDecisionBranch(branch) ? "disabled" : String(branch.status || "candidate").replaceAll("_", " ");
}

export function decisionBranchVisualKind(branch = {}) {
  if (isDisabledDecisionBranch(branch)) return "dormant";
  if (String(branch?.candidate?.inferenceRole || "").toLowerCase() === "observed_current") return "current";
  if (branch.autoReconsideration || branch.allowRejectedReconsideration || ["deferred", "reconsidering", "proposed"].includes(String(branch.status || "").toLowerCase())) return "possibility";
  return "record";
}

function isTimelineSelectionNode(branch = {}) {
  const status = String(branch?.status || "").trim().toLowerCase();
  const role = String(branch?.candidate?.inferenceRole || "").trim().toLowerCase();
  return status === "selected" || role === "observed_current";
}

/**
 * A visual triage cue only. It intentionally does not grant authority, imply
 * branch quality, or change any governed lifecycle state.
 */
export function decisionBranchReviewSignal(branch = {}, childCount = 0) {
  const disabled = isDisabledDecisionBranch(branch);
  const evidenceCount = Array.isArray(branch.evidence) ? branch.evidence.length : 0;
  const visualKind = decisionBranchVisualKind(branch);
  const revisitEligible = Boolean(branch.autoReconsideration || branch.allowRejectedReconsideration);
  const score = Math.max(0,
    Math.min(10,
      Math.min(3, evidenceCount) * 2
      + Math.min(2, Number(childCount) || 0) * 2
      + (visualKind === "current" ? 2 : 0)
      + (revisitEligible ? 2 : 0)
      - (disabled ? 2 : 0)
    )
  );
  const level = score >= 7 ? "high" : score >= 4 ? "medium" : "reference";
  const label = disabled
    ? revisitEligible ? "Dormant / reconsiderable" : "Dormant provenance"
    : visualKind === "current" ? "Current implementation" : score >= 7 ? "High review signal" : score >= 4 ? "Review signal" : "Recorded possibility";
  return { score, level, label, evidenceCount, childCount: Number(childCount) || 0, revisitEligible, disabled, visualKind };
}

export function decisionBranchWorkshopSummary(branches = []) {
  const rows = Array.isArray(branches) ? branches.filter((branch) => branch?.id) : [];
  const byId = new Map(rows.map((branch) => [branch.id, branch]));
  const childCount = new Map(rows.map((branch) => [branch.id, 0]));
  rows.forEach((branch) => {
    if (byId.has(branch.parentBranchId)) childCount.set(branch.parentBranchId, (childCount.get(branch.parentBranchId) || 0) + 1);
  });
  const entries = rows.map((branch) => ({
    branch,
    visualKind: decisionBranchVisualKind(branch),
    signal: decisionBranchReviewSignal(branch, childCount.get(branch.id) || 0)
  }));
  const byReviewSignal = (left, right) => right.signal.score - left.signal.score
    || right.signal.evidenceCount - left.signal.evidenceCount
    || createdTime(right.branch) - createdTime(left.branch)
    || String(left.branch.objective?.summary || left.branch.id).localeCompare(String(right.branch.objective?.summary || right.branch.id));
  return {
    entries,
    current: entries.filter((entry) => entry.visualKind === "current"),
    possibilities: entries.filter((entry) => entry.visualKind === "possibility"),
    dormant: entries.filter((entry) => entry.visualKind === "dormant"),
    records: entries.filter((entry) => entry.visualKind === "record"),
    reviewQueue: entries.filter((entry) => !entry.signal.disabled).sort(byReviewSignal),
    dormantQueue: entries.filter((entry) => entry.signal.disabled).sort(byReviewSignal)
  };
}

function branchDecisionReason(branch = {}) {
  const recorded = String(branch?.candidate?.decisionRationale || "").trim();
  const disposition = String(branch?.disposition?.reason || "").trim();
  if (branch.status === "selected") return disposition || "Selected only after the governed evaluation, policy, approval, and canary lifecycle recorded its evidence.";
  if (branch?.candidate?.inferenceRole === "observed_current") {
    return recorded || "Source evidence confirms this implementation exists; it does not establish a historical selection reason.";
  }
  if (recorded) return recorded;
  if (["rejected", "superseded", "retired", "archived"].includes(String(branch.status || "").toLowerCase())) return disposition || "Rejected or retired in the authoritative lifecycle record.";
  return disposition || "Not selected for execution; retained as a governed possibility until evidence supports a lifecycle decision.";
}

function suppressedCandidateReason(candidate = {}) {
  const score = Number(candidate.score);
  const dimensions = candidate.dimensions || {};
  const penalties = [
    ["estimated change cost", dimensions.estimatedChangeCost],
    ["data migration risk", dimensions.dataMigrationRisk],
    ["dependency / operational risk", dimensions.dependencyOperationalRisk],
    ["uncertainty", dimensions.uncertainty]
  ].filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0.35)
    .sort((left, right) => Number(right[1]) - Number(left[1]));
  const reason = candidate.suppressionReason === "blocking_policy_or_security_conflict"
    ? "Rejected before branch publication because the candidate has a recorded blocking policy or security conflict."
    : `Not published as a decision branch because its evidence score${Number.isFinite(score) ? ` (${score.toFixed(2)})` : ""} did not meet the publication threshold.`;
  return penalties.length ? `${reason} Main trade-offs: ${penalties.slice(0, 2).map(([label]) => label).join(" and ")}.` : reason;
}

/**
 * A read-only, objective-first ledger projection. It groups the authoritative
 * branch records by the major capability they affect and keeps elementary
 * source observations as feature evidence under that capability.
 */
export function buildDecisionObjectiveLedger({ analysisReport = null, branches = [] } = {}) {
  const ledgerBranches = Array.isArray(branches) ? branches.filter((branch) => branch?.id) : [];
  const majorFunctionalities = Array.isArray(analysisReport?.majorFunctionalities) && analysisReport.majorFunctionalities.length
    ? analysisReport.majorFunctionalities
    : Array.isArray(analysisReport?.functionalities) ? analysisReport.functionalities : [];
  const objectives = Array.isArray(analysisReport?.objectives) && analysisReport.objectives.length
    ? analysisReport.objectives
    : [{ id: "source-derived-objective", label: "Source-derived project objective", description: "Objective grouping was not available in this analysis.", majorFunctionalityIds: majorFunctionalities.map((item) => item.id) }];
  const suppressedByFunctionalityId = new Map();
  for (const candidate of Array.isArray(analysisReport?.suppressedCandidates) ? analysisReport.suppressedCandidates : []) {
    const rows = suppressedByFunctionalityId.get(candidate.functionalityId) || [];
    rows.push(candidate);
    suppressedByFunctionalityId.set(candidate.functionalityId, rows);
  }
  const branchesByFunctionalityId = new Map();
  for (const branch of ledgerBranches) {
    const functionalityId = functionalityIdForBranch(branch);
    const rows = branchesByFunctionalityId.get(functionalityId) || [];
    rows.push(branch);
    branchesByFunctionalityId.set(functionalityId, rows);
  }
  const functionalityRows = majorFunctionalities.map((functionality) => {
    const relatedBranches = (branchesByFunctionalityId.get(functionality.id) || []).sort(landscapeBranchSort);
    const confirmedSelection = relatedBranches.find((branch) => branch.status === "selected") || null;
    const observedCurrent = relatedBranches.find((branch) => branch?.candidate?.inferenceRole === "observed_current") || null;
    const selectedPath = confirmedSelection || observedCurrent;
    const alternatives = relatedBranches.filter((branch) => branch.id !== selectedPath?.id).map((branch) => ({
      branch,
      state: branch.status,
      reason: branchDecisionReason(branch),
      disposition: branch.status === "selected" ? "selected" : ["rejected", "superseded", "retired", "archived"].includes(branch.status) ? "rejected" : "not_selected"
    }));
    return {
      functionality,
      objectiveId: functionality.objectiveId || "",
      selectedPath: selectedPath ? {
        branch: selectedPath,
        confirmed: selectedPath.status === "selected",
        reason: branchDecisionReason(selectedPath)
      } : null,
      alternatives,
      suppressedAlternatives: (suppressedByFunctionalityId.get(functionality.id) || []).map((candidate) => ({
        candidate,
        reason: suppressedCandidateReason(candidate)
      })),
      featureCount: Array.isArray(functionality.features) ? functionality.features.length : 0,
      evidenceCount: Array.isArray(functionality.evidence) ? functionality.evidence.length : 0
    };
  });
  const mappedFunctionalityIds = new Set(functionalityRows.map((item) => item.functionality.id));
  const isLegacySourceObservation = (branch) => {
    const role = String(branch?.candidate?.inferenceRole || "");
    const sourceDigest = String(branch?.candidate?.sourceDigest || "");
    return ["observed_current", "deferred_alternative"].includes(role)
      && sourceDigest
      && sourceDigest === String(analysisReport?.sourceDigest || "")
      && !mappedFunctionalityIds.has(functionalityIdForBranch(branch));
  };
  const featureObservationBranches = ledgerBranches.filter(isLegacySourceObservation);
  const unmappedBranches = ledgerBranches.filter((branch) => !mappedFunctionalityIds.has(functionalityIdForBranch(branch)) && !isLegacySourceObservation(branch));
  return {
    objectives: objectives.map((objective) => ({
      ...objective,
      functionalities: functionalityRows.filter((item) => (objective.majorFunctionalityIds || []).includes(item.functionality.id))
    })),
    functionalities: functionalityRows,
    decisionBranches: ledgerBranches.filter((branch) => !isLegacySourceObservation(branch)),
    featureObservationBranches,
    featureObservationCount: featureObservationBranches.length,
    unmappedBranches,
    objectiveCount: objectives.length,
    majorFunctionalityCount: functionalityRows.length,
    featureCount: functionalityRows.reduce((total, item) => total + item.featureCount, 0)
  };
}

/**
 * Returns the selected record's connected provenance component. This is a
 * visual focus helper only: it does not change the ledger or infer a missing
 * relationship. Orphaned records remain independently selectable.
 */
export function decisionBranchLineageIds(branches = [], selectedBranchId = "") {
  const selectedId = String(selectedBranchId || "").trim();
  if (!selectedId) return new Set();
  const rows = Array.isArray(branches) ? branches.filter((branch) => branch?.id) : [];
  const byId = new Map(rows.map((branch) => [branch.id, branch]));
  if (!byId.has(selectedId)) return new Set();
  const childrenById = new Map(rows.map((branch) => [branch.id, []]));
  for (const branch of rows) {
    const parentId = String(branch.parentBranchId || "").trim();
    if (childrenById.has(parentId) && parentId !== branch.id) childrenById.get(parentId).push(branch.id);
  }
  const ids = new Set([selectedId]);
  const queue = [selectedId];
  while (queue.length) {
    const branchId = queue.shift();
    const branch = byId.get(branchId);
    const parentId = String(branch?.parentBranchId || "").trim();
    const neighbours = [parentId, ...(childrenById.get(branchId) || [])];
    for (const neighbourId of neighbours) {
      if (!byId.has(neighbourId) || ids.has(neighbourId)) continue;
      ids.add(neighbourId);
      queue.push(neighbourId);
    }
  }
  return ids;
}

const FUNCTIONALITY_CATEGORY_META = Object.freeze({
  ui: { label: "Interface", glyph: "UI", priority: 8, tone: "violet" },
  api: { label: "API surface", glyph: "API", priority: 7, tone: "blue" },
  data: { label: "Data boundary", glyph: "DB", priority: 6, tone: "cyan" },
  integration: { label: "Integration", glyph: "INT", priority: 5, tone: "amber" },
  security: { label: "Security", glyph: "SEC", priority: 6, tone: "rose" },
  test: { label: "Validation", glyph: "TST", priority: 4, tone: "green" },
  runtime: { label: "Runtime", glyph: "OPS", priority: 3, tone: "slate" },
  other: { label: "Architecture", glyph: "ARC", priority: 2, tone: "slate" }
});

function functionalityIdForBranch(branch = {}) {
  return String(branch?.candidate?.functionalityId || branch?.functionalityId || `ledger-${branch?.id || "unmapped"}`).trim();
}

function functionalityMeta(functionality = {}) {
  const category = String(functionality?.category || "other").trim().toLowerCase() || "other";
  return { category, ...(FUNCTIONALITY_CATEGORY_META[category] || FUNCTIONALITY_CATEGORY_META.other) };
}

function landscapeBranchSort(left, right) {
  const leftCurrent = decisionBranchVisualKind(left) === "current" ? 1 : 0;
  const rightCurrent = decisionBranchVisualKind(right) === "current" ? 1 : 0;
  return rightCurrent - leftCurrent
    || decisionBranchReviewSignal(right).score - decisionBranchReviewSignal(left).score
    || createdTime(right) - createdTime(left)
    || String(left?.objective?.summary || left?.id || "").localeCompare(String(right?.objective?.summary || right?.id || ""));
}

function safeLandscapeLabel(value, fallback = "Recorded branch") {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 84) || fallback;
}

const HEAVY_DEFERRED_COMPLEXITY_THRESHOLD = 0.55;

function normalizedBranchDimension(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number >= 0 && number <= 1) return number;
  if (number > 1 && number <= 100) return number / 100;
  return null;
}

function branchScoreDimensions(branch = {}) {
  const direct = branch?.candidate?.scoreBreakdown;
  if (direct && typeof direct === "object") return direct;
  const vector = Array.isArray(branch?.fitnessVector?.dimensions) ? branch.fitnessVector.dimensions : [];
  return Object.fromEntries(vector
    .filter((dimension) => dimension?.name)
    .map((dimension) => [dimension.name, dimension.normalizedValue ?? dimension.value]));
}

/**
 * Returns a visual-only complexity signal for a deferred alternative when the
 * discovery record supplied the underlying scored risks. It deliberately
 * returns null for incomplete records rather than guessing a complexity.
 */
export function decisionBranchDeferredComplexity(branch = {}) {
  if (decisionBranchVisualKind(branch) !== "possibility") return null;
  const dimensions = branchScoreDimensions(branch);
  const weighted = [
    ["estimatedChangeCost", 0.45],
    ["dataMigrationRisk", 0.35],
    ["dependencyOperationalRisk", 0.20]
  ].map(([name, weight]) => ({ value: normalizedBranchDimension(dimensions[name]), weight }))
    .filter((entry) => entry.value !== null);
  if (weighted.length < 2) return null;
  const totalWeight = weighted.reduce((total, entry) => total + entry.weight, 0);
  return Number((weighted.reduce((total, entry) => total + entry.value * entry.weight, 0) / totalWeight).toFixed(4));
}

export function hasHeavyDeferredComplexity(branch = {}) {
  const complexity = decisionBranchDeferredComplexity(branch);
  return complexity !== null && complexity >= HEAVY_DEFERRED_COMPLEXITY_THRESHOLD;
}

/**
 * Produces a display-only provenance landscape. It keeps every branch record
 * intact, adds only explicit source-functionality zones, and never infers a
 * historical selection or lifecycle transition from visual prominence.
 */
export function buildDecisionBranchLandscape({ projectId = "", projectName = "Project", branches = [], analysisReport = null } = {}) {
  const ledgerBranches = Array.isArray(branches) ? branches.filter((branch) => branch?.id) : [];
  const reportFunctionalities = Array.isArray(analysisReport?.majorFunctionalities) && analysisReport.majorFunctionalities.length
    ? analysisReport.majorFunctionalities
    : Array.isArray(analysisReport?.functionalities) ? analysisReport.functionalities : [];
  const functionalityById = new Map(reportFunctionalities.filter((item) => item?.id).map((item) => [String(item.id), item]));
  const branchById = new Map(ledgerBranches.map((branch) => [branch.id, branch]));
  const childrenById = new Map(ledgerBranches.map((branch) => [branch.id, []]));
  for (const branch of ledgerBranches) {
    const parentId = String(branch.parentBranchId || "").trim();
    if (parentId && parentId !== branch.id && childrenById.has(parentId)) childrenById.get(parentId).push(branch);
  }
  for (const childList of childrenById.values()) childList.sort(landscapeBranchSort);

  const groupsById = new Map();
  for (const branch of ledgerBranches) {
    const functionalityId = functionalityIdForBranch(branch);
    const functionality = functionalityById.get(functionalityId) || null;
    if (!groupsById.has(functionalityId)) {
      groupsById.set(functionalityId, {
        id: functionalityId,
        functionality,
        branches: []
      });
    }
    groupsById.get(functionalityId).branches.push(branch);
  }

  const groups = Array.from(groupsById.values()).map((group) => {
    const representative = [...group.branches].sort(landscapeBranchSort)[0];
    const fallbackLabel = representative?.candidate?.inferenceRole === "observed_current"
      ? representative.objective?.summary
      : `Architecture record ${group.id}`;
    const functionality = group.functionality || {
      id: group.id,
      label: safeLandscapeLabel(fallbackLabel, "Unclassified architecture record"),
      category: "other",
      evidence: []
    };
    const meta = functionalityMeta(functionality);
    const groupBranchIds = new Set(group.branches.map((branch) => branch.id));
    const roots = group.branches
      .filter((branch) => !groupBranchIds.has(String(branch.parentBranchId || "").trim()))
      .sort(landscapeBranchSort);
    const branchCount = group.branches.length;
    const evidenceCount = new Set([
      ...(Array.isArray(functionality.evidence) ? functionality.evidence.map((item) => item?.id).filter(Boolean) : []),
      ...group.branches.flatMap((branch) => (Array.isArray(branch.evidence) ? branch.evidence.map((item) => item?.id).filter(Boolean) : []))
    ]).size;
    const current = group.branches.find((branch) => decisionBranchVisualKind(branch) === "current") || representative;
    const currentSignal = decisionBranchReviewSignal(current, childrenById.get(current?.id)?.length || 0);
    return {
      ...group,
      functionality,
      meta,
      roots,
      branchCount,
      evidenceCount,
      importance: meta.priority * 12 + currentSignal.score * 3 + Math.min(6, evidenceCount) + Math.min(5, branchCount),
      currentSignal
    };
  }).sort((left, right) => right.importance - left.importance || left.functionality.label.localeCompare(right.functionality.label));

  const groupLayouts = groups.map((group) => {
    const positions = new Map();
    const nodeChildren = new Map(group.branches.map((branch) => [branch.id, (childrenById.get(branch.id) || []).filter((child) => group.branches.some((item) => item.id === child.id))]));
    const subtreeUnits = (branchId, visiting = new Set()) => {
      if (visiting.has(branchId)) return 1;
      const nextVisiting = new Set(visiting);
      nextVisiting.add(branchId);
      const children = nodeChildren.get(branchId) || [];
      if (!children.length) return 1;
      return Math.max(1, children.reduce((total, child) => total + subtreeUnits(child.id, nextVisiting), 0));
    };
    const maxDepth = (branchId, visiting = new Set()) => {
      if (visiting.has(branchId)) return 0;
      const nextVisiting = new Set(visiting);
      nextVisiting.add(branchId);
      const branch = branchById.get(branchId) || {};
      const children = nodeChildren.get(branchId) || [];
      const reviewStageDepth = hasHeavyDeferredComplexity(branch) ? 1 : 0;
      const deepestChild = children.length
        ? 1 + reviewStageDepth + Math.max(...children.map((child) => maxDepth(child.id, nextVisiting)))
        : 0;
      return Math.max(reviewStageDepth, deepestChild);
    };
    const rootUnits = group.roots.reduce((total, root) => total + subtreeUnits(root.id), 0) || 1;
    const unitWidth = 154;
    const padding = 78;
    const width = Math.max(360, Math.min(820, rootUnits * unitWidth + padding * 2));
    const maxTreeDepth = group.roots.length ? Math.max(...group.roots.map((root) => maxDepth(root.id))) : 0;
    const height = Math.max(324, 144 + (maxTreeDepth + 1) * 162);
    const place = (branch, start, depth, visiting = new Set()) => {
      if (visiting.has(branch.id)) return;
      const nextVisiting = new Set(visiting);
      nextVisiting.add(branch.id);
      const units = subtreeUnits(branch.id);
      const visualKind = decisionBranchVisualKind(branch);
      const childCount = (childrenById.get(branch.id) || []).length;
      const signal = decisionBranchReviewSignal(branch, childCount);
      const radius = Math.round(Math.max(19, Math.min(34,
        (visualKind === "current" ? 25 : visualKind === "possibility" ? 22 : visualKind === "dormant" ? 21 : 22)
        + Math.min(3, signal.evidenceCount) * 1.1
        + Math.min(3, childCount) * 1
        + Math.min(4, Math.max(0, group.branchCount - 1) * 0.5)
      )));
      positions.set(branch.id, {
        branch,
        x: padding + ((start + units / 2) / rootUnits) * (width - padding * 2),
        y: 128 + depth * 162,
        radius,
        visualKind,
        signal,
        depth,
        isRoot: depth === 0
      });
      let cursor = start;
      for (const child of nodeChildren.get(branch.id) || []) {
        const childUnits = subtreeUnits(child.id, nextVisiting);
        place(child, cursor, depth + 1 + (hasHeavyDeferredComplexity(branch) ? 1 : 0), nextVisiting);
        cursor += childUnits;
      }
    };
    let cursor = 0;
    for (const root of group.roots) {
      const units = subtreeUnits(root.id);
      place(root, cursor, 0);
      cursor += units;
    }
    return { ...group, width, height, positions };
  });

  const columns = groupLayouts.length <= 2 ? Math.max(1, groupLayouts.length) : groupLayouts.length <= 6 ? 3 : groupLayouts.length <= 12 ? 4 : 5;
  const columnWidth = Math.max(320, ...groupLayouts.map((group) => group.width));
  const gap = 38;
  const margin = 74;
  const rowHeights = [];
  groupLayouts.forEach((group, index) => {
    const row = Math.floor(index / columns);
    rowHeights[row] = Math.max(rowHeights[row] || 0, group.height + Math.min(42, (index % columns) * 14));
  });
  const rowOffsets = [];
  let nextY = 174;
  rowHeights.forEach((rowHeight, index) => {
    rowOffsets[index] = nextY;
    nextY += rowHeight + gap;
  });
  const canvasWidth = Math.max(1200, margin * 2 + columns * columnWidth + Math.max(0, columns - 1) * gap);
  const nodes = [];
  const zones = [];
  groupLayouts.forEach((group, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const emphasisOffset = Math.min(42, column * 14);
    const zoneX = margin + column * (columnWidth + gap) + (columnWidth - group.width) / 2;
    const zoneY = rowOffsets[row] + emphasisOffset;
    const zoneId = `functionality:${group.id}`;
    zones.push({
      id: zoneId,
      x: zoneX,
      y: zoneY,
      width: group.width,
      height: group.height,
      functionalityId: group.id,
      label: safeLandscapeLabel(group.functionality.label, "Unclassified architecture record"),
      category: group.meta.category,
      categoryLabel: group.meta.label,
      glyph: group.meta.glyph,
      tone: group.meta.tone,
      branchCount: group.branchCount,
      evidenceCount: group.evidenceCount,
      importance: group.importance
    });
    for (const position of group.positions.values()) {
      const branch = position.branch;
      nodes.push({
        id: `branch:${branch.id}`,
        branchId: branch.id,
        branch,
        x: zoneX + position.x,
        y: zoneY + position.y,
        radius: position.radius,
        visualKind: position.visualKind,
        signal: position.signal,
        depth: position.depth,
        isRoot: position.isRoot,
        parentBranchId: String(branch.parentBranchId || "").trim(),
        zoneId,
        functionalityId: group.id,
        functionalityLabel: safeLandscapeLabel(group.functionality.label, "Unclassified architecture record"),
        category: group.meta.category,
        categoryLabel: group.meta.label,
        glyph: group.meta.glyph,
        tone: group.meta.tone,
        label: safeLandscapeLabel(
          position.visualKind === "current" ? group.functionality.label : branch.objective?.summary,
          branch.id
        )
      });
    }
  });

  const nodeByBranchId = new Map(nodes.map((node) => [node.branchId, node]));
  const genesis = {
    id: `genesis:${projectId || "project"}`,
    x: canvasWidth / 2,
    y: 77,
    radius: 43,
    label: `${projectName || "Project"} genesis`
  };
  const links = nodes.map((node) => {
    const parent = node.parentBranchId && nodeByBranchId.get(node.parentBranchId);
    return {
      id: `${parent ? parent.id : genesis.id}->${node.id}`,
      source: parent || genesis,
      target: node,
      sourceBranchId: parent?.branchId || "",
      targetBranchId: node.branchId,
      kind: parent ? "lineage" : "genesis",
      visualKind: node.visualKind,
      disabled: node.signal.disabled
    };
  });
  const deferredReviewStages = nodes
    .filter((node) => hasHeavyDeferredComplexity(node.branch))
    .map((node) => {
      const complexity = decisionBranchDeferredComplexity(node.branch);
      return {
        id: `review-stage:${node.branchId}`,
        kind: "deferred-review-stage",
        branchId: "",
        lineageBranchId: node.branchId,
        x: node.x,
        y: node.y + 162,
        radius: 16,
        visualKind: "stage",
        signal: {
          score: 0,
          level: "medium",
          label: "Impact review stage",
          evidenceCount: 0,
          childCount: 0,
          revisitEligible: true,
          disabled: false,
          visualKind: "stage"
        },
        depth: node.depth + 1,
        zoneId: node.zoneId,
        functionalityId: node.functionalityId,
        functionalityLabel: node.functionalityLabel,
        category: node.category,
        categoryLabel: node.categoryLabel,
        glyph: "RISK",
        tone: node.tone,
        label: "Impact review",
        detail: `${Math.round(complexity * 100)}% change / risk complexity`
      };
    });
  for (const stage of deferredReviewStages) {
    const source = nodeByBranchId.get(stage.lineageBranchId);
    if (!source) continue;
    links.push({
      id: `${source.id}->${stage.id}`,
      source,
      target: stage,
      sourceBranchId: source.branchId,
      targetBranchId: "",
      kind: "review-stage",
      visualKind: "stage",
      disabled: false
    });
  }
  nodes.push(...deferredReviewStages);
  return {
    projectId,
    projectName,
    branchCount: ledgerBranches.length,
    disabledCount: ledgerBranches.filter(isDisabledDecisionBranch).length,
    activeCount: ledgerBranches.filter((branch) => !isDisabledDecisionBranch(branch)).length,
    functionalityCount: groupLayouts.length,
    deferredReviewStageCount: deferredReviewStages.length,
    canvas: { width: canvasWidth, height: Math.max(560, nextY + 72) },
    genesis,
    zones,
    nodes,
    links
  };
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function decisionEventsByBranch(graph = null) {
  const nodes = new Map((graph?.nodes || []).filter((node) => node?.id).map((node) => [node.id, node]));
  const events = new Map();
  for (const edge of graph?.edges || []) {
    if (edge.kind !== "recorded_for" || !String(edge.source || "").startsWith("event:") || !String(edge.target || "").startsWith("branch:")) continue;
    const branchId = String(edge.target).slice("branch:".length);
    const event = nodes.get(edge.source);
    if (!event) continue;
    const rows = events.get(branchId) || [];
    rows.push(event);
    events.set(branchId, rows);
  }
  for (const rows of events.values()) rows.sort((left, right) => (timestamp(left.occurredAt) || 0) - (timestamp(right.occurredAt) || 0));
  return events;
}

function timelineEntry(branch, events = []) {
  const firstEvent = events[0] || null;
  const eventTime = timestamp(firstEvent?.occurredAt);
  const createdAt = timestamp(branch.createdAt);
  if (eventTime !== null) {
    return { branch, known: true, time: eventTime, timelineLabel: `Known: ${String(firstEvent.eventType || firstEvent.label || "ledger event").replaceAll("_", " ")}`, eventCount: events.length };
  }
  if (createdAt !== null) {
    return { branch, known: true, time: createdAt, timelineLabel: "Known: branch recorded", eventCount: 0 };
  }
  const role = decisionBranchVisualKind(branch);
  const anticipatedStage = role === "current" ? 0 : role === "possibility" ? 1 : 2;
  return { branch, known: false, time: anticipatedStage, timelineLabel: `Anticipated: ${role === "current" ? "current path" : role === "possibility" ? "evaluate option" : "retain provenance"}`, eventCount: 0 };
}

/**
 * Produces a decision-flow timeline. Exact ledger events (or an immutable
 * branch-record timestamp when the event projection is unavailable) determine
 * sequence. Only records without either are placed in an explicitly labelled
 * anticipated order; this projection never promotes an anticipated step.
 */
export function buildDecisionTimelineFlow({ projectId = "", projectName = "Project", branches = [], analysisReport = null, graph = null } = {}) {
  const ledger = buildDecisionObjectiveLedger({ analysisReport, branches });
  const eventsByBranch = decisionEventsByBranch(graph);
  const objectives = ledger.objectives.length ? ledger.objectives : [{ id: "unmapped", label: "Recorded decisions", functionalities: [] }];
  const laneHeight = 142;
  const objectiveGap = 36;
  const leftRail = 178;
  const startX = 332;
  const stepX = 236;
  const zonePadding = 34;
  const nodes = [];
  const zones = [];
  const links = [];
  let nextY = 108;
  let maxSteps = 1;
  let knownCount = 0;
  let anticipatedCount = 0;

  for (const objective of objectives) {
    const records = objective.functionalities?.length ? objective.functionalities : [];
    if (!records.length) continue;
    const zoneY = nextY;
    const laneEntries = [];
    for (const record of records) {
      const branchRows = [record.selectedPath?.branch, ...record.alternatives.map((item) => item.branch)].filter(Boolean);
      const entries = branchRows.map((branch) => timelineEntry(branch, eventsByBranch.get(branch.id) || []))
        .sort((left, right) => Number(right.known) - Number(left.known)
          || left.time - right.time
          || (decisionBranchVisualKind(left.branch) === "current" ? -1 : 1)
          || String(left.branch.id).localeCompare(String(right.branch.id)));
      laneEntries.push({ record, entries });
    }
    const laneCount = Math.max(1, laneEntries.length);
    const zoneHeight = zonePadding * 2 + laneCount * laneHeight;
    const objectiveNodeIds = [];
    laneEntries.forEach(({ record, entries }, laneIndex) => {
      const y = zoneY + zonePadding + laneIndex * laneHeight + 53;
      entries.forEach((entry, index) => {
        const branch = entry.branch;
        const visualKind = decisionBranchVisualKind(branch);
        const signal = decisionBranchReviewSignal(branch, 0);
        const node = {
          id: `branch:${branch.id}`,
          branchId: branch.id,
          branch,
          x: startX + index * stepX,
          y,
          radius: Math.max(22, Math.min(30, 23 + Math.min(3, signal.evidenceCount) + (visualKind === "current" ? 2 : 0))),
          visualKind,
          signal,
          depth: index,
          isRoot: index === 0,
          parentBranchId: String(branch.parentBranchId || "").trim(),
          zoneId: `objective:${objective.id}`,
          functionalityId: record.functionality.id,
          functionalityLabel: record.functionality.label,
          category: record.functionality.category || "other",
          categoryLabel: functionalityMeta(record.functionality).label,
          glyph: functionalityMeta(record.functionality).glyph,
          tone: functionalityMeta(record.functionality).tone,
          label: safeLandscapeLabel(visualKind === "current" ? record.functionality.label : branch.objective?.summary, branch.id),
          timelineKind: entry.known ? "known" : "anticipated",
          timelineLabel: entry.timelineLabel,
          eventCount: entry.eventCount
        };
        nodes.push(node);
        objectiveNodeIds.push(node.id);
        if (entry.known) knownCount += 1;
        else anticipatedCount += 1;
        maxSteps = Math.max(maxSteps, index + 1);
      });
    });
    zones.push({
      id: `objective:${objective.id}`,
      x: leftRail,
      y: zoneY,
      width: Math.max(780, (maxSteps + 1) * stepX),
      height: zoneHeight,
      functionalityId: objective.id,
      label: safeLandscapeLabel(objective.label, "Source-derived objective"),
      category: "other",
      categoryLabel: "Project objective",
      glyph: "OBJ",
      tone: "violet",
      branchCount: objectiveNodeIds.length,
      evidenceCount: objective.functionalities.reduce((total, item) => total + item.evidenceCount, 0),
      timelineLabel: `${objectiveNodeIds.length} decisions · ${laneEntries.length} major functions`
    });
    nextY += zoneHeight + objectiveGap;
  }

  const nodeByBranchId = new Map(nodes.map((node) => [node.branchId, node]));
  const continuityNodes = nodes
    .filter((node) => isTimelineSelectionNode(node.branch))
    .sort((left, right) => left.x - right.x || left.y - right.y || String(left.branchId).localeCompare(String(right.branchId)));
  const continuityParentByBranchId = new Map();
  for (let index = 1; index < continuityNodes.length; index += 1) {
    continuityParentByBranchId.set(continuityNodes[index].branchId, continuityNodes[index - 1]);
  }
  const firstContinuityNode = continuityNodes[0] || null;
  const genesis = { id: `genesis:${projectId || "project"}`, x: 86, y: Math.max(76, Math.round((nextY - objectiveGap) / 2)), radius: 38, label: `${projectName || "Project"} decision timeline` };
  for (const zone of zones) {
    const zoneNodes = nodes.filter((node) => node.zoneId === zone.id);
    const byFunctionality = new Map();
    for (const node of zoneNodes) {
      const rows = byFunctionality.get(node.functionalityId) || [];
      rows.push(node);
      byFunctionality.set(node.functionalityId, rows);
    }
    for (const lane of byFunctionality.values()) {
      lane.sort((left, right) => left.depth - right.depth || left.branchId.localeCompare(right.branchId));
      lane.forEach((node, index) => {
        const lineageParent = node.parentBranchId && nodeByBranchId.get(node.parentBranchId);
        const continuationParent = continuityParentByBranchId.get(node.branchId) || null;
        const previous = lineageParent && lineageParent.zoneId === node.zoneId
          ? lineageParent
          : continuationParent
            ? continuationParent
            : isTimelineSelectionNode(node.branch) && node === firstContinuityNode
              ? genesis
              : null;
        if (!previous) return;
        links.push({
          id: `${previous.id}->${node.id}`,
          source: previous,
          target: node,
          sourceBranchId: previous.branchId || "",
          targetBranchId: node.branchId,
          kind: previous === genesis ? "genesis" : lineageParent ? "lineage" : continuationParent ? "timeline" : "timeline",
          visualKind: node.visualKind,
          disabled: node.signal.disabled,
          timelineKind: node.timelineKind
        });
      });
    }
  }
  const canvasWidth = Math.max(1200, leftRail + (maxSteps + 2) * stepX);
  zones.forEach((zone) => { zone.width = canvasWidth - leftRail - 54; });
  return {
    projectId,
    projectName,
    layout: "timeline",
    branchCount: nodes.length,
    disabledCount: nodes.filter((node) => node.signal.disabled).length,
    activeCount: nodes.filter((node) => !node.signal.disabled).length,
    functionalityCount: ledger.majorFunctionalityCount,
    deferredReviewStageCount: 0,
    knownCount,
    anticipatedCount,
    canvas: { width: canvasWidth, height: Math.max(480, nextY + 38) },
    genesis,
    zones,
    nodes,
    links
  };
}

/**
 * Builds a display-only lineage tree from authoritative branch records.
 * A virtual project genesis node connects independent roots; it is never
 * written to the decision ledger and cannot be used as lifecycle evidence.
 */
export function buildDecisionBranchTree({ projectId = "", projectName = "Project", branches = [] } = {}) {
  const ledgerBranches = Array.isArray(branches) ? branches.filter((branch) => branch?.id) : [];
  const nodesById = new Map(ledgerBranches.map((branch) => [branch.id, {
    id: branch.id,
    branch,
    disabled: isDisabledDecisionBranch(branch),
    parentMissing: false,
    children: []
  }]));
  const genesis = {
    id: `genesis:${projectId || "project"}`,
    kind: "genesis",
    label: `${projectName || "Project"} genesis`,
    children: []
  };

  for (const node of nodesById.values()) {
    const parentId = String(node.branch.parentBranchId || "").trim();
    const parent = parentId && parentId !== node.id ? nodesById.get(parentId) : null;
    if (parent) parent.children.push(node);
    else {
      node.parentMissing = Boolean(parentId);
      genesis.children.push(node);
    }
  }

  const reachable = new Set();
  const visit = (node, visiting = new Set()) => {
    if (reachable.has(node.id) || visiting.has(node.id)) return;
    reachable.add(node.id);
    const nextVisiting = new Set(visiting);
    nextVisiting.add(node.id);
    node.children = node.children
      .sort(compareBranches)
      .filter((child) => !nextVisiting.has(child.id));
    node.children.forEach((child) => visit(child, nextVisiting));
  };
  genesis.children.sort(compareBranches).forEach((node) => visit(node));

  // Broken historical lineage must remain visible rather than disappearing.
  for (const node of nodesById.values()) {
    if (reachable.has(node.id)) continue;
    node.parentMissing = true;
    node.children = [];
    genesis.children.push(node);
    visit(node);
  }
  genesis.children.sort(compareBranches);

  for (const node of nodesById.values()) {
    node.visualKind = decisionBranchVisualKind(node.branch);
    node.reviewSignal = decisionBranchReviewSignal(node.branch, node.children.length);
  }

  const disabledCount = ledgerBranches.filter(isDisabledDecisionBranch).length;
  return {
    genesis,
    branchCount: ledgerBranches.length,
    disabledCount,
    activeCount: ledgerBranches.length - disabledCount
  };
}
