const graphEl = document.getElementById("graph");
const statusEl = document.getElementById("status");

async function loadGraph() {
  const response = await fetch("../../topology/d3/agentic-system-graph.json");
  if (!response.ok) throw new Error(`Unable to load graph: ${response.status}`);
  return response.json();
}

function color(type) {
  return {
    agent: "#2f6fed",
    project: "#0f766e",
    workflow: "#8a5cf6",
    cluster: "#d97706",
    graph_store: "#475569",
    vector_store: "#16a34a",
    page: "#db2777",
    validation: "#64748b"
  }[type] || "#64748b";
}

function roleHaystack(node) {
  return [
    node?.label,
    node?.type,
    node?.group,
    node?.cluster_id,
    node?.agent_id,
    node?.metadata?.role,
    node?.metadata?.responsibility,
    node?.metadata?.description
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function nodeCategory(node) {
  const haystack = roleHaystack(node);
  if (node?.type === "project") return "project";
  if (node?.type === "agent") {
    if (node?.metadata?.supportAgent || haystack.includes("qagent")) return "qagent";
    if (haystack.includes("orchestrator") || haystack.includes("plutomix-fullstack") || haystack.includes("global-plutomix")) return "orchestrator";
    return "normal-agent";
  }
  if (node?.type === "system") return "system";
  return node?.type || "other";
}

function nodeFill(node) {
  const category = nodeCategory(node);
  if (category === "orchestrator") return "#7c3aed";
  if (category === "qagent") return "#f59e0b";
  if (category === "normal-agent") return "#2563eb";
  if (category === "system") return "#334155";
  return color(node?.type);
}

function nodeStroke(node) {
  const category = nodeCategory(node);
  if (category === "orchestrator") return "#c4b5fd";
  if (category === "qagent") return "#fde68a";
  if (category === "normal-agent") return "#bfdbfe";
  return "#ffffff";
}

function nodeSymbolType(node) {
  const category = nodeCategory(node);
  if (category === "orchestrator") return d3.symbolDiamond;
  if (category === "qagent") return d3.symbolTriangle;
  if (category === "system") return d3.symbolSquare;
  return d3.symbolCircle;
}

function nodeSymbolSize(node) {
  const category = nodeCategory(node);
  if (category === "orchestrator") return 1380;
  if (category === "qagent") return 1240;
  if (category === "project") return 1180;
  if (category === "normal-agent") return 1080;
  return 880;
}

function nodeRoleLabel(node) {
  const category = nodeCategory(node);
  return {
    "normal-agent": "agent",
    orchestrator: "orchestrator",
    qagent: "QAgent",
    project: "project",
    system: "system"
  }[category] || node?.type || "node";
}

function seedPeripheralLayout(nodes, links, width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const degree = new Map(nodes.map(node => [node.id, 0]));
  const neighborsById = new Map(nodes.map(node => [node.id, new Set()]));
  links.forEach(link => {
    const source = typeof link.source === "object" ? link.source.id : link.source;
    const target = typeof link.target === "object" ? link.target.id : link.target;
    if (!nodeById.has(source) || !nodeById.has(target)) return;
    degree.set(source, (degree.get(source) || 0) + 1);
    degree.set(target, (degree.get(target) || 0) + 1);
    neighborsById.get(source).add(target);
    neighborsById.get(target).add(source);
  });
  const main = nodes
    .filter(node => ["project", "orchestrator", "qagent"].includes(nodeCategory(node)))
    .sort((left, right) => (degree.get(right.id) || 0) - (degree.get(left.id) || 0));
  const fallback = [...nodes].sort((left, right) => (degree.get(right.id) || 0) - (degree.get(left.id) || 0));
  const anchorLimit = Math.max(1, Math.min(8, Math.ceil(Math.sqrt(nodes.length || 1))));
  const anchorIds = new Set();
  for (const node of [...main, ...fallback]) {
    anchorIds.add(node.id);
    if (anchorIds.size >= anchorLimit) break;
  }
  const anchors = nodes.filter(node => anchorIds.has(node.id));
  const assignments = new Map(anchors.map(anchor => [anchor.id, []]));

  anchors.forEach((anchor, index) => {
    const angle = anchors.length === 1 ? -Math.PI / 2 : -Math.PI / 2 + (Math.PI * 2 * index) / anchors.length;
    const radius = anchors.length === 1 ? 0 : Math.max(170, Math.min(width, height) * 0.26);
    anchor.x = centerX + Math.cos(angle) * radius;
    anchor.y = centerY + Math.sin(angle) * radius;
    anchor.fx = anchor.x;
    anchor.fy = anchor.y;
    anchor.orbitAnchor = true;
  });

  nodes.filter(node => !anchorIds.has(node.id)).forEach((node, index) => {
    const linkedAnchor = [...(neighborsById.get(node.id) || [])].find(id => anchorIds.has(id));
    const anchor = nodeById.get(linkedAnchor) || anchors[index % anchors.length];
    assignments.get(anchor.id).push(node);
  });

  anchors.forEach(anchor => {
    const children = assignments.get(anchor.id) || [];
    const outward = Math.atan2(anchor.y - centerY, anchor.x - centerX) || -Math.PI / 2;
    children.forEach((child, index) => {
      const ring = Math.floor(index / 10);
      const ringIndex = index % 10;
      const ringSize = Math.min(10, children.length - ring * 10);
      const spread = anchors.length === 1 ? Math.PI * 2 : Math.PI * 1.34;
      const angle = outward - spread / 2 + (spread * (ringIndex + 0.5)) / Math.max(1, ringSize);
      const radius = 145 + ring * 92;
      child.x = anchor.x + Math.cos(angle) * radius;
      child.y = anchor.y + Math.sin(angle) * radius;
      child.targetX = child.x;
      child.targetY = child.y;
    });
  });
}

function render(data) {
  graphEl.innerHTML = "";
  const width = graphEl.clientWidth || 960;
  const height = Math.max(680, window.innerHeight - 112);
  seedPeripheralLayout(data.nodes, data.links, width, height);
  const svg = d3.select(graphEl).append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("width", "100%")
    .attr("height", height);

  const simulation = d3.forceSimulation(data.nodes)
    .force("link", d3.forceLink(data.links).id(d => d.id).distance(132).strength(0.22))
    .force("charge", d3.forceManyBody().strength(d => d.orbitAnchor ? -560 : -220))
    .force("x", d3.forceX(d => d.targetX || d.x || width / 2).strength(d => d.orbitAnchor ? 0.9 : 0.18))
    .force("y", d3.forceY(d => d.targetY || d.y || height / 2).strength(d => d.orbitAnchor ? 0.9 : 0.18))
    .force("collide", d3.forceCollide(d => d.orbitAnchor ? 56 : 42));

  const link = svg.append("g")
    .selectAll("line")
    .data(data.links)
    .join("line")
    .attr("class", "link")
    .attr("stroke-width", d => Math.max(1, d.weight || 1));

  const node = svg.append("g")
    .selectAll("g")
    .data(data.nodes)
    .join("g")
    .attr("class", "node")
    .call(d3.drag()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      }));

  node.append("path")
    .attr("class", "node-shape")
    .attr("d", d => d3.symbol().type(nodeSymbolType(d)).size(nodeSymbolSize(d))())
    .attr("fill", nodeFill)
    .attr("stroke", nodeStroke)
    .attr("stroke-width", d => nodeCategory(d) === "orchestrator" ? 3 : 2);

  node.filter(d => ["orchestrator", "qagent", "normal-agent"].includes(nodeCategory(d)))
    .append("circle")
    .attr("class", "node-role-ring")
    .attr("r", d => nodeCategory(d) === "orchestrator" ? 31 : nodeCategory(d) === "qagent" ? 30 : 28)
    .attr("stroke", nodeStroke)
    .attr("stroke-dasharray", d => nodeCategory(d) === "qagent" ? "4 4" : nodeCategory(d) === "normal-agent" ? "2 5" : null);

  node.append("title")
    .text(d => `${d.label}\n${nodeRoleLabel(d)}\n${d.status}`);

  node.append("text")
    .attr("x", 28)
    .attr("y", 4)
    .text(d => d.label);

  simulation.on("tick", () => {
    link
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  statusEl.textContent = `${data.nodes.length} nodes, ${data.links.length} links. Neo4j: ${data.metadata.neo4j_status}. Vector: ${data.metadata.vector_provider} (${data.metadata.vector_status}).`;
}

loadGraph().then(render).catch(error => {
  statusEl.textContent = error.message;
});
