function compact(value, maxLength = 240) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizedAgents(agents = []) {
  return agents
    .filter((agent) => agent?.id)
    .map((agent) => ({
      id: agent.id,
      name: compact(agent.name || agent.id, 120),
      role: compact(agent.role || "Agent", 120),
      status: compact(agent.status || "recorded", 40),
      action: compact(agent.action || "", 320)
    }));
}

function cleanInstruction(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\bBranding colours?:[\s\S]*$/i, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12000);
}

function capabilityLabel(value) {
  let label = compact(value, 220)
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "")
    .replace(/^(?:and then|then|also)\s+/i, "")
    .replace(/^create (?:a|an|the)?\s*(?:web|mobile)?\s*(?:app|application|tool|platform|site|website)\s+(?:where|that)\s+(?:i|we|users?)\s+can\s+/i, "")
    .replace(/^after\b.*?\bthen\s+(?:it|the system)\s+should\s+/i, "")
    .replace(/^the system\s+(?:can|should|must)\s+/i, "")
    .replace(/^it\s+(?:can|should|must)\s+/i, "")
    .replace(/^like\s+/i, "")
    .replace(/\s+etc\.?$/i, "");
  if (/^these vc'?s must have\s+/i.test(label)) {
    label = `Filter VCs by ${label.replace(/^these vc'?s must have\s+/i, "")}`;
  }
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : "";
}

function splitRequirementClauses(instruction) {
  const source = cleanInstruction(instruction);
  if (!source) return [];
  const clauses = source
    .replace(/(?:^|\s)\d+[.)]\s+/g, "\n")
    .replace(/(?:^|\n)\s*[-*]\s+/g, "\n")
    .replace(/,\s+(?=(?:After|Then|The|These|Those|Users?)\b)/g, "\n")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
  const seen = new Set();
  return clauses.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 14);
}

const actionVerbPattern =
  "(?:analyse|analyze|approve|capture|choose|connect|create|derive|display|filter|find|generate|get|identify|include|load|prepare|publish|review|save|search|select|send|show|understand|upload|use|verify)";

function listSubfunctionalities(clause) {
  const match = clause.match(
    new RegExp(`\\b(select|choose|capture|enter|provide|include)\\s+(.+?)(?=\\s+(?:then|where|so that|to get|to find|for outreach)\\b|$)`, "i")
  );
  if (!match || !match[2].includes(",")) return [];
  const verb = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  return match[2]
    .replace(/\s+etc\.?$/i, "")
    .split(/\s*,\s*|\s+and\s+/i)
    .map((item) => compact(item.replace(/\([^)]*\)/g, "").replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, ""), 100))
    .filter((item) => item.length > 1)
    .map((item) => `${verb} ${item}`);
}

function atomicSubfunctionalities(clause) {
  const sequential = clause
    .split(
      new RegExp(
        `\\s+(?:and then|then|also)\\s+|\\s+and\\s+(?=${actionVerbPattern}\\b)|\\s+to\\s+(?=${actionVerbPattern}\\b)`,
        "i"
      )
    )
    .map(capabilityLabel)
    .filter((item) => item.length >= 8);
  const listItems = listSubfunctionalities(clause);
  const constraints = [];
  const countryMatch = clause.match(
    /\bin\s+([A-Z][A-Za-z ]+(?:\s+and\s+[A-Z][A-Za-z ]+)+?)(?=\s+(?:where|to|that|who|with|between)\b|[,.]|$)/
  );
  if (countryMatch) constraints.push(`Limit results to ${countryMatch[1]}`);
  const seen = new Set();
  return [...sequential, ...listItems, ...constraints]
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

export function extractInstructionFunctionalityHierarchy(instruction = "") {
  return splitRequirementClauses(instruction).map((clause, index) => {
    const label = capabilityLabel(clause) || `Requirement ${index + 1}`;
    const atomic = atomicSubfunctionalities(clause);
    const subfunctionalities = atomic.filter((item) => item.toLowerCase() !== label.toLowerCase());
    return {
      id: `initial-functionality-${index + 1}`,
      label,
      detail: `Original requirement: ${compact(clause, 380)}`,
      sourceText: compact(clause, 380),
      subfunctionalities
    };
  });
}

function requirementSegments(flowPath = {}) {
  const source = cleanInstruction(flowPath.sourceInstruction || flowPath.instruction || "");
  if (!source) {
    const productDecision = flowPath.productDecision || {};
    return [
      ...(productDecision.requiredCapabilities || []).map((item) => String(item).replaceAll("_", " ")),
      ...(productDecision.requiredSurfaces || [])
    ].slice(0, 8);
  }
  return extractInstructionFunctionalityHierarchy(source).map((item) => item.label);
}

function recordedActionLabel(item, index) {
  const reason = compact(item.reason || "", 120).replace(/[.!?]+$/, "");
  const genericReason = /^(changed by|changed-file evidence|required by the selected|recorded changed file)/i.test(reason);
  if (reason && !genericReason) return reason;
  return compact(item.label || item.target || `Action ${index + 1}`, 120);
}

function legacyGraph(flowPath = {}, projectId = "") {
  const agents = normalizedAgents(flowPath.activeAgents || []);
  const builder = agents.find((agent) => agent.id === "plutonix-fullstack-agent");
  const reviewer = agents.find((agent) => /reviewer|qagent/i.test(`${agent.id} ${agent.role}`));
  const executor = agents.find(
    (agent) => agent.id !== builder?.id && agent.id !== reviewer?.id && !/reviewer|qagent/i.test(`${agent.id} ${agent.role}`)
  );
  const executorId = executor?.id || builder?.id || "";
  const rootId = "functionality-project-root";
  const root = {
    id: rootId,
    type: "project",
    label: compact(flowPath.projectName || "Project", 100),
    detail: compact(flowPath.summary || "Project functionality map.", 320),
    state: flowPath.status || "ready",
    parentId: "",
    responsibleAgentIds: [builder?.id].filter(Boolean),
    evidence: ["Legacy project flow"]
  };
  const recordedFunctionalities = flowPath.functionalities?.length
    ? flowPath.functionalities
    : requirementSegments(flowPath).map((label, index) => ({
        id: `legacy-requirement-${index + 1}`,
        label,
        detail: "Recovered from the recorded project instruction.",
        state: flowPath.status || "recorded"
      }));
  const functionalities = recordedFunctionalities.map((item, index) => ({
    id: `functionality-node-${index + 1}`,
    sourceId: item.id || "",
    type: "functionality",
    label: compact(item.label || `Functionality ${index + 1}`, 120),
    detail: compact(item.detail || "Recorded project functionality.", 320),
    state: item.state || flowPath.status || "recorded",
    parentId: rootId,
    responsibleAgentIds: [executorId].filter(Boolean),
    evidence: [item.detail || "", item.id ? `Flow record: ${item.id}` : ""].filter(Boolean)
  }));
  const fallbackParentId = functionalities[0]?.id || rootId;
  const recordedActions = flowPath.featureActions?.length
    ? flowPath.featureActions
    : (flowPath.changedFiles || []).map((target, index) => ({
        id: `legacy-change-${index + 1}`,
        label: `Recorded change: ${target}`,
        target,
        reason: "Changed-file evidence from the latest project execution.",
        status: flowPath.status || "recorded"
      }));
  const subfunctionalities = recordedActions.map((item, index) => {
    const responsibleId = /review|validate|test/i.test(`${item.label || ""} ${item.reason || ""}`)
      ? reviewer?.id || executorId
      : executorId;
    return {
      id: `subfunction-node-${index + 1}`,
      sourceId: item.id || "",
      type: "subfunctionality",
      label: recordedActionLabel(item, index),
      detail: compact([item.target ? `Target: ${item.target}.` : "", item.reason || ""].filter(Boolean).join(" "), 360),
      state: item.status || flowPath.status || "recorded",
      parentId: fallbackParentId,
      responsibleAgentIds: [responsibleId].filter(Boolean),
      evidence: [item.target ? `Target: ${item.target}` : "", item.reason || ""].filter(Boolean)
    };
  });
  const nodes = [root, ...functionalities, ...subfunctionalities];
  return {
    version: 0,
    projectId,
    projectName: root.label,
    rootId,
    status: flowPath.status || "ready",
    nodes,
    links: nodes
      .filter((node) => node.parentId)
      .map((node) => ({
        id: `${node.parentId}->${node.id}`,
        source: node.parentId,
        target: node.id,
        type: node.type === "subfunctionality" ? "contains_subfunctionality" : "contains_functionality"
      })),
    agents,
    summary: {
      functionalityCount: functionalities.length,
      subfunctionalityCount: subfunctionalities.length,
      assignedNodeCount: nodes.filter((node) => node.responsibleAgentIds.length).length
    }
  };
}

function initialInstructionGraph(flowPath = {}, projectId = "") {
  const hierarchy = extractInstructionFunctionalityHierarchy(flowPath.initialInstruction || "");
  if (!hierarchy.length) return null;
  const initialFlowPath = flowPath.initialFlowPath || {};
  const agents = normalizedAgents(initialFlowPath.activeAgents || []);
  const builder = agents.find((agent) => agent.id === "plutonix-fullstack-agent");
  const reviewer = agents.find((agent) => /reviewer|qagent/i.test(`${agent.id} ${agent.role}`));
  const executor = agents.find(
    (agent) => agent.id !== builder?.id && agent.id !== reviewer?.id && !/reviewer|qagent/i.test(`${agent.id} ${agent.role}`)
  );
  const executorId = executor?.id || builder?.id || "";
  const rootId = "functionality-project-root";
  const root = {
    id: rootId,
    type: "project",
    label: compact(flowPath.projectName || initialFlowPath.projectName || "Project", 100),
    detail: "Functionality baseline from the project's first instruction.",
    state: initialFlowPath.status || flowPath.status || "recorded",
    parentId: "",
    responsibleAgentIds: [builder?.id].filter(Boolean),
    evidence: ["First project instruction"],
    origin: "initial_instruction"
  };
  const functionalityNodes = hierarchy.map((item) => ({
    id: item.id,
    sourceId: item.id,
    type: "functionality",
    label: compact(item.label, 140),
    detail: compact(item.detail, 380),
    state: initialFlowPath.status || "recorded",
    parentId: rootId,
    responsibleAgentIds: [executorId].filter(Boolean),
    evidence: ["First project instruction", item.sourceText].filter(Boolean),
    origin: "initial_instruction"
  }));
  const subfunctionalityNodes = hierarchy.flatMap((item, functionalityIndex) =>
    item.subfunctionalities.map((label, subIndex) => ({
      id: `initial-subfunctionality-${functionalityIndex + 1}-${subIndex + 1}`,
      sourceId: item.id,
      type: "subfunctionality",
      label: compact(label, 120),
      detail: `Atomic capability extracted from the first project instruction under "${compact(item.label, 120)}".`,
      state: initialFlowPath.status || "recorded",
      parentId: item.id,
      responsibleAgentIds: [executorId].filter(Boolean),
      evidence: ["First project instruction", item.sourceText].filter(Boolean),
      origin: "initial_instruction"
    }))
  );
  const nodes = [root, ...functionalityNodes, ...subfunctionalityNodes];
  return {
    version: 1,
    projectId,
    projectName: root.label,
    rootId,
    status: flowPath.status || initialFlowPath.status || "recorded",
    nodes,
    links: nodes
      .filter((node) => node.parentId)
      .map((node) => ({
        id: `${node.parentId}->${node.id}`,
        source: node.parentId,
        target: node.id,
        type: node.type === "subfunctionality" ? "contains_subfunctionality" : "contains_functionality"
      })),
    agents,
    summary: {
      functionalityCount: functionalityNodes.length,
      subfunctionalityCount: subfunctionalityNodes.length,
      assignedNodeCount: nodes.filter((node) => node.responsibleAgentIds.length).length,
      initialFunctionalityCount: functionalityNodes.length
    }
  };
}

function normalizedProvidedGraph(flowPath = {}, projectId = "") {
  const source = flowPath.functionalityGraph;
  if (!source?.nodes?.length) return legacyGraph(flowPath, projectId);
  const nodeIds = new Set(source.nodes.map((node) => node?.id).filter(Boolean));
  const nodes = source.nodes
    .filter((node) => node?.id)
    .map((node) => ({
      ...node,
      label: compact(node.label || node.id, 120),
      detail: compact(node.detail || "", 380),
      parentId: nodeIds.has(node.parentId) ? node.parentId : "",
      responsibleAgentIds: Array.isArray(node.responsibleAgentIds)
        ? [...new Set(node.responsibleAgentIds.filter(Boolean))]
        : [],
      evidence: Array.isArray(node.evidence) ? node.evidence.map((item) => compact(item, 280)).filter(Boolean) : [],
      origin: node.origin || "execution"
    }));
  return {
    ...source,
    projectId: source.projectId || projectId,
    nodes,
    links: (source.links || []).filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target)),
    agents: normalizedAgents(source.agents || flowPath.activeAgents || [])
  };
}

function normalizedLabel(value) {
  return compact(value, 200)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mergeFunctionalityGraphs(baseline, current) {
  if (!baseline) return current;
  const rootId = baseline.rootId;
  const nodes = baseline.nodes.map((node) => ({ ...node }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const labelIndex = new Map(
    nodes
      .filter((node) => node.type !== "project")
      .map((node) => [`${node.type}:${normalizedLabel(node.label)}`, node.id])
  );
  const idMap = new Map([[current.rootId, rootId]]);
  const currentNodes = (current.nodes || [])
    .filter((node) => node.type !== "project")
    .sort((left, right) => {
      const order = { functionality: 1, subfunctionality: 2 };
      return (order[left.type] || 3) - (order[right.type] || 3);
    });

  for (const sourceNode of currentNodes) {
    const duplicateId = labelIndex.get(`${sourceNode.type}:${normalizedLabel(sourceNode.label)}`);
    if (duplicateId) {
      const duplicate = nodesById.get(duplicateId);
      duplicate.evidence = [...new Set([...(duplicate.evidence || []), ...(sourceNode.evidence || [])])];
      duplicate.responsibleAgentIds = [
        ...new Set([...(duplicate.responsibleAgentIds || []), ...(sourceNode.responsibleAgentIds || [])])
      ];
      if (sourceNode.state) duplicate.state = sourceNode.state;
      duplicate.changeKind = sourceNode.origin === "previous_execution" ? "updated_previous" : "updated_latest";
      idMap.set(sourceNode.id, duplicateId);
      continue;
    }
    let nextId = sourceNode.id;
    if (nodesById.has(nextId)) nextId = `execution-${nextId}`;
    const parentId = idMap.get(sourceNode.parentId) || (sourceNode.type === "functionality" ? rootId : rootId);
    const nextNode = {
      ...sourceNode,
      id: nextId,
      parentId,
      origin: sourceNode.origin || "execution",
      changeKind: sourceNode.origin === "previous_execution" ? "created_previous" : "created_latest"
    };
    nodes.push(nextNode);
    nodesById.set(nextId, nextNode);
    labelIndex.set(`${nextNode.type}:${normalizedLabel(nextNode.label)}`, nextId);
    idMap.set(sourceNode.id, nextId);
  }

  const agentsById = new Map(
    [...(baseline.agents || []), ...(current.agents || [])]
      .filter((agent) => agent?.id)
      .map((agent) => [agent.id, agent])
  );
  const root = nodesById.get(rootId);
  root.state = current.status || root.state;
  root.evidence = [...new Set([...(root.evidence || []), ...((current.nodes || []).find((node) => node.type === "project")?.evidence || [])])];
  const functionalityCount = nodes.filter((node) => node.type === "functionality").length;
  const subfunctionalityCount = nodes.filter((node) => node.type === "subfunctionality").length;
  const treeLinks = nodes
    .filter((node) => node.parentId)
    .map((node) => ({
      id: `${node.parentId}->${node.id}`,
      source: node.parentId,
      target: node.id,
      type: node.type === "subfunctionality" ? "contains_subfunctionality" : "contains_functionality"
    }));
  const runtimeLinks = (current.links || [])
    .map((link) => ({
      id: link.id || `${link.source}->${link.target}`,
      source: idMap.get(link.source) || link.source,
      target: idMap.get(link.target) || link.target,
      type: link.type || "runtime_relation"
    }))
    .filter((link) => nodesById.has(link.source) && nodesById.has(link.target));
  const links = [...treeLinks, ...runtimeLinks].filter((link, index, rows) =>
    rows.findIndex((item) => item.source === link.source && item.target === link.target && item.type === link.type) === index
  );
  return {
    ...current,
    version: Math.max(Number(baseline.version || 0), Number(current.version || 0)),
    rootId,
    projectId: current.projectId || baseline.projectId,
    projectName: current.projectName || baseline.projectName,
    nodes,
    links,
    agents: [...agentsById.values()],
    summary: {
      functionalityCount,
      subfunctionalityCount,
      assignedNodeCount: nodes.filter((node) => node.responsibleAgentIds?.length).length,
      initialFunctionalityCount: baseline.summary?.functionalityCount || 0
    }
  };
}

function withGraphOrigin(graph = {}, origin = "execution") {
  return {
    ...graph,
    nodes: (graph.nodes || []).map((node) => ({
      ...node,
      origin: node.type === "project" ? node.origin || origin : origin
    }))
  };
}

export function normalizeFunctionalityGraph(flowPath = {}, projectId = "") {
  const baseline = initialInstructionGraph(flowPath, projectId);
  const previousFlowPaths = Array.isArray(flowPath.previousFlowPaths) ? flowPath.previousFlowPaths : [];
  const historicalGraph = previousFlowPaths.reduce((graph, previousFlowPath) => {
    const previous = normalizedProvidedGraph(
      {
        ...previousFlowPath,
        initialInstruction: "",
        initialFlowPath: null,
        previousFlowPaths: []
      },
      projectId
    );
    return mergeFunctionalityGraphs(graph, withGraphOrigin(previous, "previous_execution"));
  }, baseline);
  const sameInstruction =
    cleanInstruction(flowPath.initialInstruction) &&
    cleanInstruction(flowPath.initialInstruction) === cleanInstruction(flowPath.sourceInstruction || flowPath.instruction);
  const currentFlow = sameInstruction && !flowPath.functionalityGraph?.nodes?.length && !flowPath.functionalities?.length
    ? { ...flowPath, sourceInstruction: "", instruction: "", productDecision: null }
    : flowPath;
  const current = normalizedProvidedGraph(currentFlow, projectId);
  return mergeFunctionalityGraphs(historicalGraph, current);
}

function radiusForNode(node) {
  if (node.type === "project") return 40;
  if (node.type === "functionality") return 30;
  return 22;
}

function collisionRadiusForNode(node) {
  if (node.type === "project") return 96;
  if (node.type === "functionality") return 86;
  return 74;
}

function initialFunctionalityPositions(nodes, graph, width, height) {
  const center = { x: width / 2, y: height / 2 };
  const positions = new Map();
  const root = nodes.find((node) => node.id === graph.rootId || node.type === "project");
  const functionalities = nodes.filter((node) => node.type === "functionality");
  const subfunctionalities = nodes.filter((node) => node.type === "subfunctionality");
  if (root) positions.set(root.id, { ...root, x: center.x, y: center.y, vx: 0, vy: 0, radius: radiusForNode(root), angle: 0, fixed: true });

  const innerRadius = Math.max(220, Math.min(width, height) * 0.24);
  const outerStep = 150;
  functionalities.forEach((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, functionalities.length);
    positions.set(node.id, {
      ...node,
      x: center.x + Math.cos(angle) * innerRadius,
      y: center.y + Math.sin(angle) * innerRadius,
      vx: 0,
      vy: 0,
      radius: radiusForNode(node),
      angle
    });
  });

  const childrenByParent = new Map();
  subfunctionalities.forEach((node) => {
    const siblings = childrenByParent.get(node.parentId) || [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  });
  subfunctionalities.forEach((node, index) => {
    const parent = positions.get(node.parentId) || positions.get(root?.id);
    const siblings = childrenByParent.get(node.parentId) || subfunctionalities;
    const siblingIndex = Math.max(0, siblings.findIndex((item) => item.id === node.id));
    const angle = parent?.angle ?? (-Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, subfunctionalities.length));
    const fan = siblings.length === 1 ? 0 : (-0.9 + (1.8 * siblingIndex) / Math.max(1, siblings.length - 1));
    const radius = outerStep + Math.floor(siblingIndex / 5) * 120;
    positions.set(node.id, {
      ...node,
      x: (parent?.x || center.x) + Math.cos(angle + fan) * radius,
      y: (parent?.y || center.y) + Math.sin(angle + fan) * radius,
      vx: 0,
      vy: 0,
      radius: radiusForNode(node),
      angle: angle + fan
    });
  });
  return positions;
}

function resolveNodeCollisions(items, iterations = 90) {
  for (let pass = 0; pass < iterations; pass += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
        const left = items[leftIndex];
        const right = items[rightIndex];
        const minDistance = collisionRadiusForNode(left) + collisionRadiusForNode(right);
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;
        if (!distance) {
          const angle = ((leftIndex * 83 + rightIndex * 47) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = ((minDistance - distance) / distance) * 0.52;
        const leftWeight = left.fixed ? 0 : right.fixed ? 1 : 0.5;
        const rightWeight = right.fixed ? 0 : left.fixed ? 1 : 0.5;
        left.x -= dx * push * leftWeight;
        left.y -= dy * push * leftWeight;
        right.x += dx * push * rightWeight;
        right.y += dy * push * rightWeight;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function runFunctionalityForceSimulation(items, links, width, height) {
  const root = items.find((node) => node.fixed);
  const center = { x: width / 2, y: height / 2 };
  const linkPairs = links
    .map((link) => ({
      source: items.find((node) => node.id === link.source),
      target: items.find((node) => node.id === link.target),
      distance: link.type === "contains_subfunctionality" ? 190 : 250
    }))
    .filter((link) => link.source && link.target);

  for (let tick = 0; tick < 220; tick += 1) {
    const alpha = 1 - tick / 220;
    for (const link of linkPairs) {
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = ((distance - link.distance) / distance) * 0.08 * alpha;
      const sourceWeight = link.source.fixed ? 0 : 0.42;
      const targetWeight = link.target.fixed ? 0 : 0.58;
      link.source.x += dx * force * sourceWeight;
      link.source.y += dy * force * sourceWeight;
      link.target.x -= dx * force * targetWeight;
      link.target.y -= dy * force * targetWeight;
    }

    for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
        const left = items[leftIndex];
        const right = items[rightIndex];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distanceSq = dx * dx + dy * dy;
        if (distanceSq < 1) {
          dx = 1;
          dy = 0;
          distanceSq = 1;
        }
        const force = Math.min(4.2, 6800 / distanceSq) * alpha;
        const distance = Math.sqrt(distanceSq);
        const leftWeight = left.fixed ? 0 : right.fixed ? 1 : 0.5;
        const rightWeight = right.fixed ? 0 : left.fixed ? 1 : 0.5;
        left.x -= (dx / distance) * force * leftWeight;
        left.y -= (dy / distance) * force * leftWeight;
        right.x += (dx / distance) * force * rightWeight;
        right.y += (dy / distance) * force * rightWeight;
      }
    }

    for (const node of items) {
      if (node.fixed) {
        node.x = center.x;
        node.y = center.y;
        continue;
      }
      const parent = items.find((item) => item.id === node.parentId) || root;
      const targetX = parent ? parent.x : center.x;
      const targetY = parent ? parent.y : center.y;
      const strength = node.type === "functionality" ? 0.012 : 0.018;
      node.x += (targetX - node.x) * strength * alpha;
      node.y += (targetY - node.y) * strength * alpha;
    }
    resolveNodeCollisions(items, 2);
  }
  resolveNodeCollisions(items, 120);
}

function normalizeLayoutBounds(items, width, height) {
  const padding = 130;
  const bounds = items.reduce(
    (acc, node) => ({
      minX: Math.min(acc.minX, node.x - collisionRadiusForNode(node)),
      maxX: Math.max(acc.maxX, node.x + collisionRadiusForNode(node)),
      minY: Math.min(acc.minY, node.y - collisionRadiusForNode(node)),
      maxY: Math.max(acc.maxY, node.y + collisionRadiusForNode(node))
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const nextWidth = Math.max(width, Math.ceil(bounds.maxX - bounds.minX + padding * 2));
  const nextHeight = Math.max(height, Math.ceil(bounds.maxY - bounds.minY + padding * 2));
  const offsetX = padding - bounds.minX;
  const offsetY = padding - bounds.minY;
  return {
    width: nextWidth,
    height: nextHeight,
    nodes: items.map((node) => ({
      ...node,
      x: Math.round(node.x + offsetX),
      y: Math.round(node.y + offsetY),
      fixed: undefined,
      vx: undefined,
      vy: undefined
    }))
  };
}

export function layoutFunctionalityGraph(graph = {}, width = 900, height = 560) {
  const nodes = graph.nodes || [];
  const requestedWidth = Math.max(width, Math.ceil(Math.sqrt(Math.max(1, nodes.length)) * 360));
  const requestedHeight = Math.max(height, Math.ceil(Math.sqrt(Math.max(1, nodes.length)) * 285));
  const positions = initialFunctionalityPositions(nodes, graph, requestedWidth, requestedHeight);
  const positionedNodes = nodes.map((node) => positions.get(node.id)).filter(Boolean);
  runFunctionalityForceSimulation(positionedNodes, graph.links || [], requestedWidth, requestedHeight);
  const normalized = normalizeLayoutBounds(positionedNodes, requestedWidth, requestedHeight);
  const nodePositions = new Map(normalized.nodes.map((node) => [node.id, node]));

  return {
    width: normalized.width,
    height: normalized.height,
    nodes: normalized.nodes,
    links: (graph.links || [])
      .map((link) => ({
        ...link,
        sourceNode: nodePositions.get(link.source),
        targetNode: nodePositions.get(link.target)
      }))
      .filter((link) => link.sourceNode && link.targetNode)
  };
}

export function functionalityNodeInsights(graph = {}, nodeId = "") {
  const node = (graph.nodes || []).find((item) => item.id === nodeId) || null;
  if (!node) return { node: null, agents: [], children: [] };
  const agentIds = new Set(node.responsibleAgentIds || []);
  return {
    node,
    agents: (graph.agents || []).filter((agent) => agentIds.has(agent.id)),
    children: (graph.nodes || []).filter((item) => item.parentId === node.id)
  };
}
