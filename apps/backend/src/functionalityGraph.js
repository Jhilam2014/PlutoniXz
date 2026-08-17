const ignoredMatchWords = new Set([
  "add",
  "and",
  "app",
  "build",
  "create",
  "for",
  "from",
  "generated",
  "implementation",
  "modify",
  "page",
  "project",
  "requested",
  "route",
  "section",
  "the",
  "this",
  "with"
]);

function compact(value, maxLength = 220) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function humanize(value) {
  return compact(value)
    .replace(/^Section:\s*/i, "")
    .replace(/^Route:\s*/i, "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function matchWords(value) {
  return new Set(
    compact(value, 1200)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !ignoredMatchWords.has(word))
  );
}

function matchingScore(action, functionality) {
  const actionWords = matchWords(`${action.label || ""} ${action.reason || ""} ${action.target || ""}`);
  const functionalityWords = matchWords(`${functionality.label || ""} ${functionality.detail || ""}`);
  let score = 0;
  for (const word of functionalityWords) {
    if (actionWords.has(word)) score += 1;
  }
  return score;
}

function actionLabel(action, index) {
  const reason = compact(action.reason, 100).replace(/[.!?]+$/, "");
  const genericReason = /^(changed by|changed-file evidence|required by the selected|recorded changed file)/i.test(reason);
  if (reason && !genericReason) return reason;
  const target = compact(action.target || action.label, 100);
  return target || `Implementation action ${index + 1}`;
}

function requirementSegments(value) {
  const source = compact(value, 50000)
    .replace(/\bBranding colours?:[\s\S]*$/i, "")
    .trim();
  if (!source || (source.length < 180 && !/(?:^|\s)\d+\.\s+|\n/.test(source))) return [source].filter(Boolean);
  const segments = source
    .replace(/(?:^|\s)\d+\.\s+/g, "\n")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((item) => compact(item.replace(/^[\s,;:-]+|[\s,;:-]+$/g, ""), 220))
    .filter((item) => item.length >= 12);
  return segments.length > 1 ? segments.slice(0, 10) : [source];
}

function functionalityParentSourceId(item = {}) {
  return String(item.parentSourceId || item.parentFunctionalityId || item.parentId || "").trim();
}

function flattenFunctionalities(items = [], inheritedParentSourceId = "") {
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const parentSourceId = functionalityParentSourceId(item) || inheritedParentSourceId;
    const sourceId = String(item.id || "").trim();
    const children = Array.isArray(item.children)
      ? item.children
      : Array.isArray(item.subfunctionalities)
        ? item.subfunctionalities
        : [];
    const current = {
      ...item,
      parentSourceId,
      subfunctionalities: undefined,
      children: undefined
    };
    return [current, ...flattenFunctionalities(children, sourceId || parentSourceId)];
  });
}

function uniqueFunctionalities(functionalities = [], structuredRequest = {}) {
  const candidates = functionalities.length
    ? functionalities
    : [
        {
          id: "requested-objective",
          label:
            structuredRequest.rawTextBoxInstruction ||
            structuredRequest.sourceInstruction ||
            structuredRequest.objective ||
            "Requested project functionality",
          detail: structuredRequest.objective || "Requested project functionality."
        },
        ...(structuredRequest.sections || [])
          .filter((section) => section && section !== "direct-task")
          .map((section) => ({
            id: `section-${section}`,
            label: humanize(section),
            detail: `Recorded project section: ${humanize(section)}.`
          })),
        ...(structuredRequest.routePlan || []).map((route, index) => ({
          id: `route-${route.key || index + 1}`,
          label: route.title || route.key || route.path,
          detail: route.description || `Recorded route ${route.path || route.key || index + 1}.`
        }))
      ];
  const expandedCandidates = candidates.flatMap((item, index) => {
    if (index !== 0) return [item];
    const segments = requirementSegments(item?.label);
    if (segments.length <= 1) return [item];
    return segments.map((label, segmentIndex) => ({
      ...item,
      id: `${item.id || "requested-objective"}-${segmentIndex + 1}`,
      label,
      detail: "Recorded requirement selected for implementation."
    }));
  });
  const flattenedCandidates = flattenFunctionalities(expandedCandidates);
  const seen = new Set();
  return flattenedCandidates.filter((item) => {
    const key = compact(item?.label).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function agentOwnership(activeAgents = []) {
  const builder = activeAgents.find((agent) => agent.id === "plutonix-fullstack-agent");
  const reviewer = activeAgents.find((agent) => /reviewer|qagent/i.test(`${agent.id || ""} ${agent.role || ""}`));
  const executor = activeAgents.find(
    (agent) =>
      agent.id &&
      agent.id !== builder?.id &&
      agent.id !== reviewer?.id &&
      !/reviewer|qagent/i.test(`${agent.id} ${agent.role || ""}`)
  );
  return {
    builderId: builder?.id || "",
    executorId: executor?.id || builder?.id || "",
    reviewerId: reviewer?.id || ""
  };
}

export function buildFunctionalityGraph({
  projectId = "",
  projectName = "Project",
  structuredRequest = {},
  functionalities = [],
  actions = [],
  activeAgents = [],
  status = "ready"
} = {}) {
  const ownership = agentOwnership(activeAgents);
  const sourceFunctionalities = uniqueFunctionalities(functionalities, structuredRequest);
  const rootId = "functionality-project-root";
  const nodes = [
    {
      id: rootId,
      type: "project",
      label: compact(projectName, 100) || "Project",
      detail: compact(structuredRequest.objective || "Project functionality map.", 280),
      state: status,
      parentId: "",
      responsibleAgentIds: [ownership.builderId].filter(Boolean),
      evidence: ["Project flow path"]
    }
  ];

  const functionalityNodes = sourceFunctionalities.map((item, index) => ({
    id: `functionality-node-${index + 1}`,
    sourceId: item.id || "",
    type: "functionality",
    label: compact(item.label, 120),
    detail: compact(item.detail || "Recorded project functionality.", 320),
    state: item.state || status,
    parentId: rootId,
    responsibleAgentIds: [ownership.executorId].filter(Boolean),
    evidence: [
      item.id ? `Flow record: ${item.id}` : "",
      item.detail || ""
    ].filter(Boolean)
  }));
  const functionalityIdBySourceId = new Map(
    functionalityNodes
      .filter((node) => node.sourceId)
      .map((node) => [node.sourceId, node.id])
  );
  functionalityNodes.forEach((node, index) => {
    const parentSourceId = functionalityParentSourceId(sourceFunctionalities[index]);
    const parentId = functionalityIdBySourceId.get(parentSourceId);
    if (parentId && parentId !== node.id) {
      node.parentId = parentId;
      node.type = "subfunctionality";
    }
  });
  nodes.push(...functionalityNodes);

  const primaryFunctionality = functionalityNodes.find((node) => node.parentId === rootId);
  const fallbackParentId = primaryFunctionality?.id || rootId;
  const specificFunctionalities = functionalityNodes.filter((node) => node.id !== fallbackParentId);
  const hasNestedFunctionalities = functionalityNodes.some((node) => node.parentId !== rootId);
  const implementationNode = hasNestedFunctionalities && actions.length
    ? {
        id: "subfunction-group-implementation",
        sourceId: "implementation-work",
        type: "subfunctionality",
        label: "Implementation work",
        detail: "Recorded implementation actions that do not map to a more specific child functionality.",
        state: status,
        parentId: fallbackParentId,
        responsibleAgentIds: [ownership.executorId].filter(Boolean),
        evidence: ["Derived from recorded implementation actions"]
      }
    : null;
  if (implementationNode) nodes.push(implementationNode);
  const actionNodes = actions.map((action, index) => {
    const scored = specificFunctionalities
      .map((node) => ({ node, score: matchingScore(action, node) }))
      .sort((left, right) => right.score - left.score);
    const explicitParentId = functionalityIdBySourceId.get(
      String(action.parentSourceId || action.parentFunctionalityId || action.parentId || "").trim()
    );
    const parentId = explicitParentId || (scored[0]?.score > 0 ? scored[0].node.id : implementationNode?.id || fallbackParentId);
    const needsReviewer = /review|validate|verification|quality|test/i.test(
      `${action.label || ""} ${action.reason || ""} ${action.target || ""}`
    );
    const responsibleAgentId = needsReviewer && ownership.reviewerId
      ? ownership.reviewerId
      : ownership.executorId;
    return {
      id: `subfunction-node-${index + 1}`,
      sourceId: action.id || "",
      type: "subfunctionality",
      label: actionLabel(action, index),
      detail: compact(
        [
          action.type ? `${humanize(action.type)} operation.` : "",
          action.target ? `Target: ${action.target}.` : "",
          action.reason || ""
        ].filter(Boolean).join(" "),
        380
      ),
      state: action.status || status,
      parentId,
      responsibleAgentIds: [responsibleAgentId].filter(Boolean),
      evidence: [
        action.target ? `Target: ${action.target}` : "",
        action.reason || ""
      ].filter(Boolean)
    };
  });
  nodes.push(...actionNodes);

  const links = nodes
    .filter((node) => node.parentId)
    .map((node) => ({
      id: `${node.parentId}->${node.id}`,
      source: node.parentId,
      target: node.id,
      type: node.type === "subfunctionality" ? "contains_subfunctionality" : "contains_functionality"
    }));

  return {
    version: 1,
    projectId,
    projectName: compact(projectName, 100) || "Project",
    rootId,
    status,
    nodes,
    links,
    agents: activeAgents.map((agent) => ({
      id: agent.id,
      name: agent.name || agent.id,
      role: agent.role || "Agent",
      status: agent.status || "recorded",
      action: agent.action || ""
    })),
    summary: {
      functionalityCount: functionalityNodes.filter((node) => node.type === "functionality").length,
      subfunctionalityCount: nodes.filter((node) => node.type === "subfunctionality").length,
      maximumDepth: nodes.reduce((maximum, node) => {
        let depth = 0;
        let parentId = node.parentId;
        const visited = new Set([node.id]);
        while (parentId && !visited.has(parentId)) {
          visited.add(parentId);
          depth += 1;
          parentId = nodes.find((candidate) => candidate.id === parentId)?.parentId || "";
        }
        return Math.max(maximum, depth);
      }, 0),
      assignedNodeCount: nodes.filter((node) => node.responsibleAgentIds.length).length
    }
  };
}
