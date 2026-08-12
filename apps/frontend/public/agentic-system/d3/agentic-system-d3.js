import {
  VIEW_MODES,
  applyGraphFilters,
  buildClusters,
  focusNeighborhood,
  humanize,
  layoutNodeRadius,
  loadPositions,
  nodeId,
  normalizeGraph,
  relationshipStyle,
  savePositions,
  selectRenderStrategy,
  shortName,
  visibleGraphForState
} from "./agentic-system-model.js";

const d3 = window.d3;
const dagre = window.dagre;
const lucide = window.lucide;
const graphEl = document.getElementById("graph");
const statusEl = document.getElementById("status");
const legendEl = document.getElementById("legend");
const insightEl = document.getElementById("insight");
const insightContentEl = document.getElementById("insight-content");
const countsEl = document.getElementById("result-counts");
const breadcrumbEl = document.getElementById("breadcrumb");
const workspaceEl = document.querySelector(".graph-workspace");
const graphStateEl = document.getElementById("graph-state");
const tooltipEl = document.getElementById("node-tooltip");
const searchResultsEl = document.getElementById("search-results");
const entityListPanelEl = document.getElementById("entity-list-panel");
const entityListEl = document.getElementById("graph-entity-list");
const freshnessEl = document.getElementById("data-freshness");
const renderSummaryEl = document.getElementById("render-summary");
const selectionAnnouncementEl = document.getElementById("selection-announcement");
const productVideoDialogEl = document.getElementById("product-video-dialog");
const productVideoShellEl = productVideoDialogEl?.querySelector(".product-video-shell");
const productVideoPlayerEl = document.getElementById("product-video-player");
const params = new URLSearchParams(window.location.search);

if (params.has("embedded")) document.documentElement.classList.add("embedded");
document.documentElement.dataset.theme = params.get("theme") === "light" ? "light" : "dark";
lucide?.createIcons();

const palette = {
  orchestrator: "#7c3aed",
  worker: "#2563eb",
  qagent: "#ec4899",
  reviewer: "#06b6d4",
  human: "#0f766e",
  memory: "#475569",
  cluster: "#111827",
  project: "#9333ea",
  capability: "#64748b",
  service: "#0891b2",
  api: "#f59e0b",
  feature: "#14b8a6",
  workflow: "#64748b",
  page: "#38bdf8",
  validation: "#64748b",
  artifact: "#64748b"
};

const statusPalette = {
  running: "#22c55e",
  waiting: "#f59e0b",
  failed: "#ef4444",
  idle: "#94a3b8"
};

const controls = {
  search: document.getElementById("agent-search"),
  project: document.getElementById("project-filter"),
  agentType: document.getElementById("type-filter"),
  status: document.getElementById("status-filter"),
  relationshipType: document.getElementById("relationship-filter"),
  depth: document.getElementById("depth-filter")
};

const state = {
  graph: null,
  filters: {
    search: "",
    project: "all",
    agentType: "all",
    status: "all",
    relationshipType: "all"
  },
  viewMode: "overview",
  depth: 1,
  expandedClusters: new Set(),
  selectedId: "",
  currentZoom: 1,
  transform: d3.zoomIdentity,
  inspectorOpen: false,
  inspectorTab: "overview",
  sheetExpanded: false,
  searchActiveIndex: 0,
  source: "",
  loadedAt: null,
  autoRefreshTimer: null,
  refreshing: false,
  progressiveLimit: 140,
  progressiveTask: null,
  renderMetrics: {
    lastFrameMs: 0,
    mode: "svg"
  },
  canvasGraph: null
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function valueText(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function nodeDescription(node) {
  return (
    node?.description ||
    node?.metadata?.description ||
    node?.metadata?.responsibility ||
    `${node?.label || "This item"} participates in the ${humanize(node?.domain || node?.capability || node?.type)} system surface.`
  );
}

function agentLabel(node) {
  if (node?.kind === "cluster") return "Cluster";
  if (node?.agentType === "qagent") return "QAgent";
  if (node?.agentType === "reviewer") return "Reviewer";
  if (node?.agentType === "worker") return "Worker agent";
  if (node?.agentType === "memory") return "Memory / database";
  if (node?.agentType === "human") return "Human agent";
  return humanize(node?.agentType || node?.type);
}

function visualType(node) {
  if (node?.clusterLevel === "project") return "project";
  if (node?.kind === "cluster") return "cluster";
  return node?.agentType || node?.type || "artifact";
}

function statusMark(node) {
  const status = node?.statusGroup || "idle";
  if (status === "failed") return "!";
  if (status === "waiting") return "?";
  if (status === "running") return "●";
  return "○";
}

function runtimeStatusLabel(node) {
  if (node?.kind === "cluster") return humanize(node.statusGroup);
  return node?.hasRuntimeSignal ? humanize(node.statusGroup) : "No live signal";
}

function glyphFor(node) {
  const type = visualType(node);
  if (type === "orchestrator") return "O";
  if (type === "worker") return "A";
  if (type === "qagent") return "Q";
  if (type === "reviewer") return "Q";
  if (type === "human") return "H";
  if (type === "memory") return "DB";
  if (type === "cluster") return "C";
  if (type === "project") return "P";
  if (type === "api") return "API";
  return "N";
}

function acronymFor(value, max = 4) {
  const words = String(value || "Node")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "N";
  const acronym = words.length === 1 ? words[0].slice(0, max) : words.map((word) => word[0]).join("");
  return acronym.slice(0, max).toUpperCase();
}

function objectiveIconFor(node) {
  const text = [
    node?.label,
    node?.agent_id,
    node?.cluster_id,
    node?.domain,
    node?.capability,
    node?.metadata?.role,
    node?.metadata?.responsibility,
    node?.metadata?.description
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const type = visualType(node);
  if (node?.clusterLevel === "project") return "folder-kanban";
  if (type === "project") return "folder-kanban";
  if (type === "orchestrator" || text.includes("orchestrator") || text.includes("coordinate")) return "network";
  if (type === "reviewer" || text.includes("qagent") || text.includes("review") || text.includes("validation")) return "badge-check";
  if (type === "memory" || text.includes("memory") || text.includes("vector") || text.includes("database")) return "database";
  if (type === "human" || text.includes("human")) return "user-check";
  if (text.includes("ui") || text.includes("react") || text.includes("layout") || text.includes("composition")) return "panel-top";
  if (text.includes("content") || text.includes("data") || text.includes("catalog")) return "table-properties";
  if (text.includes("runtime") || text.includes("docker") || text.includes("package") || text.includes("deploy")) return "container";
  if (text.includes("api") || text.includes("integration") || text.includes("service")) return "plug";
  if (text.includes("commerce") || text.includes("shop") || text.includes("product")) return "shopping-bag";
  if (text.includes("map") || text.includes("geo") || text.includes("location")) return "map";
  if (text.includes("search") || text.includes("finder")) return "search";
  if (text.includes("security") || text.includes("auth")) return "shield-check";
  if (text.includes("media") || text.includes("image") || text.includes("ocr")) return "image";
  if (text.includes("test") || text.includes("quality")) return "flask-conical";
  return "bot";
}

function appendLucideIcon(group, node, options = {}) {
  const size = options.size || 26;
  group
    .append("foreignObject")
    .attr("class", "node-icon-object")
    .attr("x", -size / 2)
    .attr("y", -size / 2)
    .attr("width", size)
    .attr("height", size)
    .append("xhtml:span")
    .attr("class", "node-icon")
    .html(`<i data-lucide="${objectiveIconFor(node)}" aria-hidden="true"></i>`);
}

function metadataRows(node) {
  const metadata = Object.entries(node?.metadata || {}).filter(
    ([key, value]) => !["description", "responsibility", "dynamicProjectGraph"].includes(key) && value !== "" && value != null
  );
  return metadata
    .slice(0, 14)
    .map(([key, value]) => `<div><dt>${escapeHtml(humanize(key))}</dt><dd>${escapeHtml(valueText(value))}</dd></div>`)
    .join("");
}

async function fetchGraph(source, timeoutMs = 5500) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(source, { signal: controller.signal });
    if (!response.ok) throw new Error(`Graph request failed: ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadGraph() {
  const graphUrl = params.get("graphUrl");
  const sources = Array.from(
    new Set([graphUrl, "http://localhost:8080/api/agentic-system/graph", "/topology/d3/agentic-system-graph.json"].filter(Boolean))
  );
  let lastError;
  for (const source of sources) {
    try {
      const data = await fetchGraph(source);
      return {
        data,
        source: source.includes("/topology/") ? "Static topology fallback" : "Runtime graph API",
        loadedAt: new Date()
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function populateControls(model) {
  const projects = Array.from(new Set(model.nodes.map((node) => node.project))).sort();
  const types = Array.from(new Set(model.nodes.map((node) => node.agentType))).sort();
  const statuses = Array.from(new Set(model.nodes.map((node) => node.statusGroup))).sort();
  const relationTypes = Array.from(new Set(model.links.map((link) => relationshipStyle(link).className))).sort();

  controls.project.replaceChildren();
  controls.agentType.replaceChildren();
  controls.status.replaceChildren();
  controls.relationshipType.replaceChildren();
  addOption(controls.project, "all", "All projects");
  addOption(controls.agentType, "all", "All types");
  addOption(controls.status, "all", "All status");
  addOption(controls.relationshipType, "all", "All relations");
  projects.forEach((project) => addOption(controls.project, project, project));
  types.forEach((type) => addOption(controls.agentType, type, humanize(type)));
  statuses.forEach((status) => addOption(controls.status, status, status === "idle" ? "No live signal" : humanize(status)));
  relationTypes.forEach((type) => addOption(controls.relationshipType, type, humanize(type)));
  controls.project.value = projects.includes(state.filters.project) ? state.filters.project : "all";
  controls.agentType.value = types.includes(state.filters.agentType) ? state.filters.agentType : "all";
  controls.status.value = statuses.includes(state.filters.status) ? state.filters.status : "all";
  controls.relationshipType.value = relationTypes.includes(state.filters.relationshipType) ? state.filters.relationshipType : "all";
}

function renderLegend() {
  const nodeLegend = [
    ["orchestrator", "Orchestrator"],
    ["worker", "Worker"],
    ["qagent", "QAgent"],
    ["reviewer", "Reviewer"],
    ["human", "Human"],
    ["memory", "Memory/database"]
  ];
  const statusLegend = [
    ["running", "Running"],
    ["waiting", "Waiting"],
    ["failed", "Failed"],
    ["idle", "Idle"]
  ];
  legendEl.innerHTML = `
    <div class="legend-heading"><span>Legend</span><span>${VIEW_MODES[state.viewMode]}</span></div>
    <div class="legend-group">${nodeLegend
      .map(([type, label]) => `<span><i class="shape-mark ${type}" style="--mark:${palette[type]}"></i>${escapeHtml(label)}</span>`)
      .join("")}</div>
    <div class="legend-group">${statusLegend
      .map(([status, label]) => `<span><i class="status-dot ${status}" style="--mark:${statusPalette[status]}">${statusMark({ statusGroup: status })}</i>${escapeHtml(label)}</span>`)
      .join("")}</div>
    <div class="legend-group relation-legend"><span><i class="line solid"></i>Invocation</span><span><i class="line dashed"></i>Memory/data</span><span><i class="line dotted"></i>Optional</span></div>
  `;
}

function renderCounts(model, visible, telemetry = {}) {
  const filtered = applyGraphFilters(model, state.filters);
  const agents = filtered.nodes.filter((node) => node.type === "agent");
  const failed = agents.filter((node) => node.statusGroup === "failed").length;
  const warning = agents.filter((node) => node.statusGroup === "waiting").length;
  countsEl.innerHTML = `
    <div class="metric"><b>${agents.length}</b><span>Agents</span></div>
    <div class="metric"><b>${visible.items.length}</b><span>Visible</span></div>
    <div class="metric critical"><b>${failed}</b><span>Failed</span></div>
    <div class="metric warning"><b>${warning}</b><span>Warnings</span></div>
  `;
  const sourceClass = state.source.includes("fallback") ? "warning" : "";
  statusEl.className = sourceClass;
  statusEl.innerHTML = `<i class="connection-dot" aria-hidden="true"></i><span>${escapeHtml(state.source || "System topology")} · ${model.nodes.length} entities · ${model.links.length} relationships</span>`;
  freshnessEl.textContent = state.loadedAt ? `Updated ${formatFreshness(state.loadedAt)}` : "Waiting for data";
  const totalItems = visible.totalItemCount || visible.items.length;
  const totalLinks = visible.totalLinkCount || visible.links.length;
  const visibleText = totalItems > visible.items.length ? `${visible.items.length}/${totalItems} visible` : `${visible.items.length} visible`;
  const pathText = totalLinks > visible.links.length ? `${visible.links.length}/${totalLinks} paths` : `${visible.links.length} paths`;
  const renderer = telemetry.mode ? ` · ${humanize(telemetry.mode)}` : "";
  const frame = Number.isFinite(telemetry.frameMs) ? ` · ${telemetry.frameMs.toFixed(1)}ms` : "";
  renderSummaryEl.textContent = `${visibleText} · ${pathText}${renderer}${frame}`;
}

function renderBreadcrumb(visible) {
  const selectedVisible = visible.items.find((item) => item.id === state.selectedId);
  if (selectedVisible?.kind === "cluster") {
    breadcrumbEl.innerHTML = `${escapeHtml(VIEW_MODES[state.viewMode])} <span aria-hidden="true">/</span> <span class="crumb-current">${escapeHtml(selectedVisible.label)}</span>`;
    return;
  }
  if (!state.selectedId || !visible.focus?.breadcrumb?.length) {
    breadcrumbEl.innerHTML = `${escapeHtml(VIEW_MODES[state.viewMode])} <span aria-hidden="true">/</span> <span class="crumb-current">${escapeHtml(state.filters.project === "all" ? "All projects" : state.filters.project)}</span>`;
    return;
  }
  breadcrumbEl.innerHTML = `${visible.focus.breadcrumb.map(escapeHtml).join(' <span aria-hidden="true">/</span> ')} <span class="focus-depth">${state.depth} hop focus</span>`;
}

function formatFreshness(date) {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

let width = Math.max(graphEl.clientWidth, 320);
let height = Math.max(graphEl.clientHeight, 280);
const edgeCanvas = document.createElement("canvas");
edgeCanvas.className = "graph-canvas";
edgeCanvas.hidden = true;
edgeCanvas.setAttribute("aria-hidden", "true");
graphEl.prepend(edgeCanvas);
const edgeContext = edgeCanvas.getContext("2d");
const svg = d3
  .select(graphEl)
  .append("svg")
  .attr("viewBox", [0, 0, width, height])
  .attr("role", "group")
  .attr("aria-label", "Clustered PlutoniX topology");
const viewport = svg.append("g").attr("class", "graph-viewport");
const linkLayer = viewport.append("g").attr("class", "links");
const nodeLayer = viewport.append("g").attr("class", "nodes");
const miniSvg = d3.select("#minimap").append("svg").attr("viewBox", [0, 0, 180, 120]).attr("aria-hidden", "true");

function resizeEdgeCanvas() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  edgeCanvas.width = Math.max(1, Math.round(width * pixelRatio));
  edgeCanvas.height = Math.max(1, Math.round(height * pixelRatio));
  edgeCanvas.style.width = `${width}px`;
  edgeCanvas.style.height = `${height}px`;
}

resizeEdgeCanvas();

const zoom = d3
  .zoom()
  .scaleExtent([0.35, 3.2])
  .on("zoom", (event) => {
    state.transform = event.transform;
    state.currentZoom = event.transform.k;
    viewport.attr("transform", event.transform);
    graphEl.dataset.zoomLevel = zoomLevel(event.transform.k);
    if (state.canvasGraph) drawCanvasLinks(state.canvasGraph.links, state.canvasGraph.nodeById, state.canvasGraph.focusedIds);
  });
svg.call(zoom).on("dblclick.zoom", null);
svg.on("click", (event) => {
  if (event.target !== svg.node()) return;
  hideTooltip();
  state.selectedId = "";
  setInspectorOpen(false);
  render();
});

const defs = svg.append("defs");
defs
  .append("marker")
  .attr("id", "arrow")
  .attr("viewBox", "0 -5 10 10")
  .attr("refX", 16)
  .attr("markerWidth", 5)
  .attr("markerHeight", 5)
  .attr("orient", "auto")
  .append("path")
  .attr("fill", "#94a3b8")
  .attr("d", "M0,-5L10,0L0,5");

function zoomLevel(scale) {
  if (scale < 0.82) return "overview";
  if (scale < 1.45) return "intermediate";
  return "detailed";
}

function linkPath(link, nodeById) {
  const source = nodeById.get(nodeId(link.source));
  const target = nodeById.get(nodeId(link.target));
  if (!source || !target) return "";
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const curve = Math.min(70, Math.hypot(dx, dy) * 0.22);
  return `M${source.x},${source.y} C${source.x + curve},${source.y} ${target.x - curve},${target.y} ${target.x},${target.y}`;
}

function drawCanvasLinks(links, nodeById, focusedIds = new Set()) {
  if (!edgeContext || edgeCanvas.hidden) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  edgeContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  edgeContext.clearRect(0, 0, width, height);
  edgeContext.save();
  edgeContext.translate(state.transform.x, state.transform.y);
  edgeContext.scale(state.transform.k, state.transform.k);

  for (const link of links) {
    const source = nodeById.get(nodeId(link.source));
    const target = nodeById.get(nodeId(link.target));
    if (!source || !target) continue;
    const sourceFocused = focusedIds.has(source.id);
    const targetFocused = focusedIds.has(target.id);
    const isContext = state.selectedId && (source.id === state.selectedId || target.id === state.selectedId);
    const style = relationshipStyle(link).className;
    const muted = focusedIds.size > 0 && (!sourceFocused || !targetFocused);
    const upstream = state.selectedId && target.id === state.selectedId;
    const downstream = state.selectedId && source.id === state.selectedId;
    edgeContext.setLineDash(style === "dashed" ? [8, 6] : style === "dotted" ? [2, 6] : []);
    edgeContext.strokeStyle = muted
      ? "rgba(100, 116, 139, 0.12)"
      : upstream
        ? "rgba(245, 158, 11, 0.88)"
        : downstream
          ? "rgba(34, 197, 94, 0.88)"
          : "rgba(148, 163, 184, 0.48)";
    edgeContext.fillStyle = edgeContext.strokeStyle;
    edgeContext.lineWidth = isContext || upstream || downstream ? 2 : 1;

    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const curve = Math.min(70, Math.hypot(dx, dy) * 0.22);
    edgeContext.beginPath();
    edgeContext.moveTo(source.x, source.y);
    edgeContext.bezierCurveTo(source.x + curve, source.y, target.x - curve, target.y, target.x, target.y);
    edgeContext.stroke();

    const angle = Math.atan2(dy, dx);
    const arrowSize = 4.5;
    edgeContext.beginPath();
    edgeContext.moveTo(target.x, target.y);
    edgeContext.lineTo(target.x - Math.cos(angle - Math.PI / 6) * arrowSize, target.y - Math.sin(angle - Math.PI / 6) * arrowSize);
    edgeContext.lineTo(target.x - Math.cos(angle + Math.PI / 6) * arrowSize, target.y - Math.sin(angle + Math.PI / 6) * arrowSize);
    edgeContext.closePath();
    edgeContext.fill();
  }
  edgeContext.restore();
}

function clusterCard(selection) {
  selection.each(function (node) {
    const group = d3.select(this);
    if (node.clusterLevel === "project") {
      group
        .append("path")
        .attr("class", "project-folder-shape cluster-card")
        .attr("d", "M-58,-26H-22L-14,-16H58Q68,-16 68,-6V42Q68,52 58,52H-58Q-68,52 -68,42V-16Q-68,-26 -58,-26Z");
      appendLucideIcon(group, { ...node, agentType: "project", type: "project", kind: "project" }, { size: 30 });
      group.append("text").attr("class", "project-acronym").attr("x", 0).attr("y", 18).text(acronymFor(node.label));
      group.append("text").attr("class", "project-node-label").attr("x", 0).attr("y", 72).text(shortName(node.label, 24));
      group
        .append("text")
        .attr("class", "project-node-subtitle")
        .attr("x", 0)
        .attr("y", 87)
        .text((item) => `${item.counts.agents} agents · ${item.capabilityClusters?.length || 0} groups`);
      group.append("text").attr("class", "cluster-toggle project-toggle").attr("x", 0).attr("y", 104).text((item) => (state.expandedClusters.has(item.id) ? "Collapse" : "Open"));
      return;
    }
    group
      .append("rect")
      .attr("class", "cluster-card")
      .attr("x", -94)
      .attr("y", -48)
      .attr("width", 188)
      .attr("height", 96)
      .attr("rx", 8);
    group.append("text").attr("class", "cluster-title").attr("x", -76).attr("y", -24).text(shortName(node.label, 25));
    group.append("text").attr("class", "cluster-desc").attr("x", -76).attr("y", -7).text(shortName(node.description, 30));
    group
      .append("text")
      .attr("class", "cluster-counts")
      .attr("x", -76)
      .attr("y", 19)
      .text(
        node.counts.running || node.counts.warning || node.counts.failed
          ? `${node.counts.agents} agents · ${node.counts.running} run · ${node.counts.warning} warn · ${node.counts.failed} fail`
          : `${node.counts.agents} agents · No live signal`
      );
    group.append("text").attr("class", "cluster-toggle").attr("x", 66).attr("y", 35).text(state.expandedClusters.has(node.id) ? "Collapse" : "Open");
  });
}

function agentShape(selection) {
  selection.each(function (node) {
    const group = d3.select(this);
    const type = visualType(node);
    if (type === "orchestrator") {
      group.append("rect").attr("class", "node-shape").attr("x", -32).attr("y", -22).attr("width", 64).attr("height", 44).attr("rx", 8);
    } else if (type === "reviewer") {
      group.append("path").attr("class", "node-shape").attr("d", "M0,-31L31,0L0,31L-31,0Z");
    } else if (type === "memory") {
      group.append("rect").attr("class", "node-shape").attr("x", -31).attr("y", -22).attr("width", 62).attr("height", 44).attr("rx", 6);
    } else {
      group.append("circle").attr("class", "node-shape").attr("r", type === "human" ? 29 : 30);
    }
    appendLucideIcon(group, node);
    group.append("text").attr("class", "node-acronym").attr("text-anchor", "middle").attr("y", 26).text(acronymFor(node.label, 3));
    group.append("circle").attr("class", "node-status-halo").attr("cx", 25).attr("cy", -25).attr("r", 10);
    group.append("text").attr("class", "node-status-text").attr("x", 25).attr("y", -21).text(statusMark(node));
    group.append("text").attr("class", "node-label").attr("x", 0).attr("y", 48).text(shortName(node.label));
    group.append("text").attr("class", "node-subtitle").attr("x", 0).attr("y", 63).text(`${agentLabel(node)} · ${runtimeStatusLabel(node)}`);
  });
}

function drawMinimap(items, links) {
  miniSvg.selectAll("*").remove();
  if (!items.length) return;
  const bounds = items.reduce(
    (acc, item) => ({ minX: Math.min(acc.minX, item.x), maxX: Math.max(acc.maxX, item.x), minY: Math.min(acc.minY, item.y), maxY: Math.max(acc.maxY, item.y) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const sx = 150 / Math.max(1, bounds.maxX - bounds.minX);
  const sy = 90 / Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(sx, sy);
  const nodeById = new Map(items.map((item) => [item.id, item]));
  miniSvg
    .append("g")
    .attr("transform", "translate(15,15)")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("x1", (link) => ((nodeById.get(link.source)?.x || 0) - bounds.minX) * scale)
    .attr("y1", (link) => ((nodeById.get(link.source)?.y || 0) - bounds.minY) * scale)
    .attr("x2", (link) => ((nodeById.get(link.target)?.x || 0) - bounds.minX) * scale)
    .attr("y2", (link) => ((nodeById.get(link.target)?.y || 0) - bounds.minY) * scale);
  miniSvg
    .select("g")
    .selectAll("circle")
    .data(items)
    .join("circle")
    .attr("cx", (item) => (item.x - bounds.minX) * scale)
    .attr("cy", (item) => (item.y - bounds.minY) * scale)
    .attr("r", (item) => (item.kind === "cluster" ? 3.8 : 2.8))
    .attr("fill", (item) => palette[visualType(item)] || "#64748b");
}

function emptyInsightHtml() {
  return `
    <div class="insight-empty">
      <div class="insight-heading">
        <span>Agent details</span>
        <h2>Select an agent</h2>
        <p>Open a cluster or search for an agent to inspect runtime health, dependencies, warnings, and logs.</p>
      </div>
    </div>`;
}

function relationLists(model, selected) {
  const incoming = [];
  const outgoing = [];
  for (const link of model.links) {
    if (link.target === selected.id) incoming.push({ link, node: model.nodeById.get(link.source) });
    if (link.source === selected.id) outgoing.push({ link, node: model.nodeById.get(link.target) });
  }
  return { incoming: incoming.filter((row) => row.node), outgoing: outgoing.filter((row) => row.node) };
}

function scoreValue(node, keys, fallback) {
  for (const key of keys) {
    const value = node?.metadata?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function openWorkspaceDeepLink(workspace, key, target, context = {}) {
  const url = new URL("/", window.location.href);
  url.searchParams.set("workspace", workspace);
  url.searchParams.set(key, target);
  Object.entries(context).forEach(([contextKey, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(contextKey, String(value));
  });
  window.open(url.toString(), "_blank", "noopener");
}

function renderDetails(model, node) {
  if (!node) {
    insightContentEl.innerHTML = emptyInsightHtml();
    return;
  }
  if (node.kind === "cluster") {
    insightContentEl.innerHTML = `
      <div class="insight-heading">
        <span>CLUSTER</span>
        <h2>${escapeHtml(node.label)}</h2>
        <p>${escapeHtml(node.description)}</p>
        <div class="insight-badges">
          <b>${node.counts.agents} agents</b>${node.counts.resources ? `<b>${node.counts.resources} resources</b>` : ""}${
            node.counts.running || node.counts.warning || node.counts.failed
              ? `<b>${node.counts.running} running</b><b class="warn">${node.counts.warning} warnings</b><b class="fail">${node.counts.failed} failed</b>`
              : `<b>No live telemetry</b>`
          }
        </div>
      </div>
      <section class="insight-section connections"><h3>Agents</h3>${node.nodes
        .slice(0, 20)
        .map((agent) => `<button type="button" data-node-id="${escapeHtml(agent.id)}"><span>${escapeHtml(agentLabel(agent))} · ${escapeHtml(runtimeStatusLabel(agent))}</span><strong>${escapeHtml(agent.label)}</strong></button>`)
        .join("")}</section>`;
  } else {
    const { incoming, outgoing } = relationLists(model, node);
    const executionRows = node.metadata?.recentExecutions || node.metadata?.executions || [];
    const issueRows = node.metadata?.errors || node.metadata?.warnings || [];
    const executions = Array.isArray(executionRows) ? executionRows : [];
    const errors = Array.isArray(issueRows) ? issueRows : [];
    const capabilityScore = scoreValue(node, ["capabilityScore", "capability"], "—");
    const reliabilityScore = scoreValue(node, ["reliabilityScore", "reliability"], "—");
    const accuracyScore = scoreValue(node, ["accuracyScore", "accuracy"], "—");
    const currentTask = node.metadata?.currentTask || node.metadata?.task || "No active task reported";
    const issueSummary =
      Array.isArray(errors) && errors.length
        ? errors.map(valueText).join(" · ")
        : node.statusGroup === "failed"
          ? "Failure status reported; open logs for details."
          : "No errors or warnings reported.";
    const tabContent = {
      overview: `
        <section class="operational-callout">
          <span>Current task</span>
          <strong>${escapeHtml(currentTask)}</strong>
        </section>
        <div class="score-row" aria-label="Agent scores">
          <div><span>Capability</span><strong>${escapeHtml(capabilityScore)}</strong></div>
          <div><span>Reliability</span><strong>${escapeHtml(reliabilityScore)}</strong></div>
          <div><span>Accuracy</span><strong>${escapeHtml(accuracyScore)}</strong></div>
        </div>
        <section class="insight-section detail-grid">
          <h3>Operational status</h3>
          <dl>
            <div><dt>Parent orchestrator</dt><dd>${escapeHtml(node.metadata?.parentOrchestrator || node.metadata?.orchestrator || node.cluster_id || "Not declared")}</dd></div>
            <div><dt>Lifecycle</dt><dd>${escapeHtml(humanize(node.metadata?.lifecycle || node.status || "unknown"))}</dd></div>
            <div><dt>Runtime status</dt><dd>${escapeHtml(runtimeStatusLabel(node))}</dd></div>
          </dl>
        </section>`,
      relationships: `
        <section class="insight-section connections"><h3>Incoming <small>${incoming.length}</small></h3>${connectionButtons(incoming, "from")}</section>
        <section class="insight-section connections"><h3>Outgoing <small>${outgoing.length}</small></h3>${connectionButtons(outgoing, "to")}</section>`,
      activity: `
        <section class="insight-section"><h3>Recent executions</h3><p>${escapeHtml(Array.isArray(executions) && executions.length ? executions.map(valueText).join(" · ") : "No recent executions reported in graph metadata.")}</p></section>
        <section class="insight-section"><h3>Errors & warnings</h3><p>${escapeHtml(issueSummary)}</p></section>`,
      configuration: `
        <section class="insight-section detail-grid">
          <h3>Agent configuration</h3>
          <dl>
            <div><dt>Instruction version</dt><dd>${escapeHtml(node.metadata?.instructionVersion || node.metadata?.version || "Current")}</dd></div>
            <div><dt>Agent type</dt><dd>${escapeHtml(agentLabel(node))}</dd></div>
            <div><dt>Project</dt><dd>${escapeHtml(node.project || "Not declared")}</dd></div>
          </dl>
        </section>
        ${metadataRows(node) ? `<section class="insight-section detail-grid"><h3>Technical metadata</h3><dl>${metadataRows(node)}</dl></section>` : ""}`
    };
    if (!tabContent[state.inspectorTab]) state.inspectorTab = "overview";
    insightContentEl.innerHTML = `
      <div class="insight-heading">
        <span>${escapeHtml(agentLabel(node))}</span>
        <h2>${escapeHtml(node.label)}</h2>
        <p>${escapeHtml(nodeDescription(node))}</p>
        <div class="insight-badges">
          <b>${escapeHtml(humanize(node.status || node.statusGroup))}</b>
          <b class="${node.statusGroup === "failed" ? "fail" : node.statusGroup === "waiting" ? "warn" : ""}">${escapeHtml(statusMark(node))} ${escapeHtml(runtimeStatusLabel(node))}</b>
          <b>${escapeHtml(humanize(node.risk_level || "standard"))} risk</b>
        </div>
      </div>
      <div class="inspector-tabs" role="tablist" aria-label="Agent detail sections">
        <button type="button" role="tab" data-inspector-tab="overview" aria-selected="${state.inspectorTab === "overview"}">Overview</button>
        <button type="button" role="tab" data-inspector-tab="relationships" aria-selected="${state.inspectorTab === "relationships"}">Relationships <small>${incoming.length + outgoing.length}</small></button>
        <button type="button" role="tab" data-inspector-tab="activity" aria-selected="${state.inspectorTab === "activity"}">Activity <small>${executions.length + errors.length}</small></button>
        <button type="button" role="tab" data-inspector-tab="configuration" aria-selected="${state.inspectorTab === "configuration"}">Configuration</button>
      </div>
      <div class="inspector-tab-panel" role="tabpanel" tabindex="0" aria-label="${escapeHtml(humanize(state.inspectorTab))}">
        ${tabContent[state.inspectorTab]}
      </div>
      <div class="drawer-actions"><button type="button" id="open-logs">Open Logs</button><button type="button" id="inspect-agent">Inspect Agent</button></div>`;
  }

  insightContentEl.querySelectorAll("[data-inspector-tab]").forEach((button, _index, buttons) => {
    button.tabIndex = button.getAttribute("aria-selected") === "true" ? 0 : -1;
    button.addEventListener("click", () => {
      state.inspectorTab = button.dataset.inspectorTab;
      renderDetails(model, node);
      insightContentEl.querySelector(`[data-inspector-tab="${state.inspectorTab}"]`)?.focus();
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const rows = Array.from(buttons);
      const currentIndex = rows.indexOf(button);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + rows.length) % rows.length;
      rows[nextIndex].click();
    });
  });
  insightContentEl.querySelectorAll("[data-node-id]").forEach((button) => {
    button.addEventListener("click", () => selectItem(button.dataset.nodeId));
  });
  insightContentEl.querySelector("#open-logs")?.addEventListener("click", () => {
    const target = node.agent_id || node.id;
    openWorkspaceDeepLink("builder", "logs", target);
  });
  insightContentEl.querySelector("#inspect-agent")?.addEventListener("click", () => {
    const target = node.agent_id || node.id;
    openWorkspaceDeepLink("agents", "agent", target, {
      agentName: node.label,
      agentType: agentLabel(node),
      project: node.project,
      domain: node.domain || node.capability,
      description: nodeDescription(node)
    });
  });
}

function connectionButtons(rows, direction) {
  if (!rows.length) return "<p>No relationships in this direction.</p>";
  return rows
    .slice(0, 18)
    .map(({ link, node }) => `<button type="button" data-node-id="${escapeHtml(node.id)}"><span>${escapeHtml(direction)} · ${escapeHtml(humanize(link.type))}</span><strong>${escapeHtml(node.label)}</strong></button>`)
    .join("");
}

function setInspectorOpen(open, options = {}) {
  state.inspectorOpen = Boolean(open);
  workspaceEl.classList.toggle("inspector-open", state.inspectorOpen);
  insightEl.setAttribute("aria-hidden", String(!state.inspectorOpen));
  if (!state.inspectorOpen) {
    state.sheetExpanded = false;
    insightEl.classList.remove("is-expanded");
    document.getElementById("sheet-toggle").setAttribute("aria-expanded", "false");
  }
  window.requestAnimationFrame(() => {
    resizeGraph({ fit: options.fit !== false });
    if (state.inspectorOpen && options.focus) document.getElementById("close-insight").focus();
  });
}

function setActiveView(viewMode, options = {}) {
  if (!VIEW_MODES[viewMode]) return;
  if (state.viewMode !== viewMode) resetProgressiveRender();
  state.viewMode = viewMode;
  document.querySelectorAll("[data-view-mode]").forEach((button) => {
    const active = button.dataset.viewMode === viewMode;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  renderLegend();
  if (options.render !== false) {
    render();
    if (state.viewMode === "explore") window.requestAnimationFrame(() => centerExploreView());
    else window.requestAnimationFrame(() => fitSelection());
  }
  updateAutoRefresh();
}

function setProductVideoOpen(open) {
  if (!productVideoDialogEl) return;
  productVideoDialogEl.hidden = !open;
  document.body.classList.toggle("dialog-open", open);
  if (open) {
    productVideoShellEl?.focus();
    return;
  }
  productVideoPlayerEl?.pause();
  if (productVideoPlayerEl) productVideoPlayerEl.currentTime = 0;
  document.getElementById("product-video-view")?.focus();
}

function selectItem(id) {
  if (!state.graph) return;
  const item = state.graph.nodeById.get(id);
  if (state.selectedId !== id) state.inspectorTab = "overview";
  state.selectedId = id;
  state.filters.search = "";
  if (item && state.viewMode === "overview") {
    const cluster = buildClusters(state.graph.nodes, state.graph.links).clusters.find((entry) => entry.nodes.some((node) => node.id === id));
    if (cluster) state.expandedClusters.add(cluster.id);
  }
  setInspectorOpen(true, { fit: false });
  selectionAnnouncementEl.textContent = item ? `${item.label} selected. ${state.depth} hop relationships shown.` : "Selection updated.";
  render();
  if (state.viewMode !== "explore") window.requestAnimationFrame(() => fitSelection());
}

function hideTooltip() {
  tooltipEl.hidden = true;
}

function showTooltip(event, node) {
  const graphBounds = graphEl.getBoundingClientRect();
  const maxLeft = Math.max(8, graphBounds.width - 232);
  const maxTop = Math.max(8, graphBounds.height - 86);
  tooltipEl.innerHTML = `<strong>${escapeHtml(node.label)}</strong><span>${escapeHtml(agentLabel(node))} · ${escapeHtml(runtimeStatusLabel(node))}</span>`;
  tooltipEl.style.left = `${Math.min(maxLeft, Math.max(8, event.clientX - graphBounds.left + 14))}px`;
  tooltipEl.style.top = `${Math.min(maxTop, Math.max(8, event.clientY - graphBounds.top + 14))}px`;
  tooltipEl.hidden = false;
}

function renderEntityList(items) {
  entityListEl.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <button class="entity-list-item" type="button" data-entity-id="${escapeHtml(item.id)}" aria-current="${item.id === state.selectedId}" style="--status-color:${statusPalette[item.statusGroup] || statusPalette.idle}">
              <i class="health-mark" aria-hidden="true"></i>
              <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(agentLabel(item))} · ${escapeHtml(runtimeStatusLabel(item))}</small></span>
              <small>${item.kind === "cluster" ? `${item.counts.agents} agents` : escapeHtml(item.project)}</small>
            </button>`
        )
        .join("")
    : `<p class="search-empty">No entities match the current filters.</p>`;
  entityListEl.querySelectorAll("[data-entity-id]").forEach((button) => {
    button.addEventListener("click", () => selectItem(button.dataset.entityId));
  });
}

function closeSearchResults() {
  searchResultsEl.hidden = true;
  controls.search.setAttribute("aria-expanded", "false");
  controls.search.removeAttribute("aria-activedescendant");
}

function matchingSearchResults(query) {
  if (!state.graph || !query.trim()) return [];
  const normalized = query.trim().toLowerCase();
  return state.graph.nodes
    .filter((node) => node.searchable.includes(normalized))
    .sort((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(normalized) ? 0 : 1;
      const bStarts = b.label.toLowerCase().startsWith(normalized) ? 0 : 1;
      return aStarts - bStarts || a.label.localeCompare(b.label);
    })
    .slice(0, 8);
}

function renderSearchResults(query) {
  const results = matchingSearchResults(query);
  state.searchActiveIndex = Math.min(state.searchActiveIndex, Math.max(0, results.length - 1));
  if (!query.trim()) {
    closeSearchResults();
    return;
  }
  searchResultsEl.innerHTML = results.length
    ? results
        .map(
          (node, index) => `
          <button id="search-result-${index}" class="search-result" type="button" role="option" data-search-id="${escapeHtml(node.id)}" aria-selected="${index === state.searchActiveIndex}">
            <i aria-hidden="true">${escapeHtml(glyphFor(node))}</i>
            <span><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.project)} · ${escapeHtml(agentLabel(node))}</small></span>
            <small>${escapeHtml(runtimeStatusLabel(node))}</small>
          </button>`
        )
        .join("")
    : `<p class="search-empty">No agents or entities found for “${escapeHtml(query)}”.</p>`;
  searchResultsEl.hidden = false;
  controls.search.setAttribute("aria-expanded", "true");
  if (results.length) controls.search.setAttribute("aria-activedescendant", `search-result-${state.searchActiveIndex}`);
  searchResultsEl.querySelectorAll("[data-search-id]").forEach((button) => {
    button.addEventListener("click", () => commitSearchResult(button.dataset.searchId));
  });
}

function commitSearchResult(id) {
  const node = state.graph?.nodeById.get(id);
  if (!node) return;
  controls.search.value = node.label;
  closeSearchResults();
  if (node.type === "agent") setActiveView("dependency", { render: false });
  else setActiveView("explore", { render: false });
  selectItem(id);
}

function cancelProgressiveRender() {
  if (state.progressiveTask == null) return;
  if (window.cancelIdleCallback) window.cancelIdleCallback(state.progressiveTask);
  else window.clearTimeout(state.progressiveTask);
  state.progressiveTask = null;
}

function resetProgressiveRender() {
  cancelProgressiveRender();
  state.progressiveLimit = 140;
}

function scheduleProgressiveRender(totalItems, batchSize) {
  if (state.progressiveTask != null || state.progressiveLimit >= totalItems) return;
  const revealNextBatch = () => {
    state.progressiveTask = null;
    state.progressiveLimit = Math.min(totalItems, state.progressiveLimit + batchSize);
    render();
  };
  state.progressiveTask = window.requestIdleCallback
    ? window.requestIdleCallback(revealNextBatch, { timeout: 120 })
    : window.setTimeout(revealNextBatch, 24);
}

function applyProgressiveWindow(fullVisible, strategy) {
  if (!strategy.progressive || fullVisible.items.length <= state.progressiveLimit) {
    cancelProgressiveRender();
    return fullVisible;
  }
  const focusIds = fullVisible.focus?.ids || new Set();
  const ordered = fullVisible.items
    .map((item, index) => ({
      item,
      index,
      priority:
        item.id === state.selectedId
          ? 0
          : focusIds.has(item.id) || item.clusterParentId === state.selectedId
            ? 1
            : 2
    }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .slice(0, Math.max(strategy.initialNodeLimit, state.progressiveLimit))
    .map((row) => row.item);
  const renderedIds = new Set(ordered.map((item) => item.id));
  const links = fullVisible.links.filter((link) => renderedIds.has(nodeId(link.source)) && renderedIds.has(nodeId(link.target)));
  scheduleProgressiveRender(fullVisible.items.length, strategy.batchSize);
  return {
    ...fullVisible,
    items: ordered,
    links,
    totalItemCount: fullVisible.items.length,
    totalLinkCount: fullVisible.links.length
  };
}

function render() {
  const renderStartedAt = performance.now();
  const model = state.graph;
  if (!model) return;
  const fullVisible = visibleGraphForState(model, { ...state, storage: window.localStorage }, width, height, dagre);
  const strategy = selectRenderStrategy({
    nodeCount: fullVisible.items.length,
    linkCount: fullVisible.links.length,
    lastFrameMs: state.renderMetrics.lastFrameMs
  });
  const visible = applyProgressiveWindow(fullVisible, strategy);
  const nodeById = new Map(visible.items.map((item) => [item.id, item]));
  const focus = state.selectedId ? focusNeighborhood(model, state.selectedId, state.depth) : null;
  const selectedRenderable = nodeById.get(state.selectedId) || model.nodeById.get(state.selectedId) || visible.items.find((item) => item.id === state.selectedId);
  const visibleIds = new Set(visible.items.map((item) => item.id));
  const focusedIds = new Set(focus?.ids || []);
  if (selectedRenderable?.kind === "cluster") {
    focusedIds.add(selectedRenderable.id);
    visible.items.forEach((item) => {
      let parentId = item.clusterParentId;
      while (parentId) {
        if (parentId === selectedRenderable.id) {
          focusedIds.add(item.id);
          break;
        }
        parentId = nodeById.get(parentId)?.clusterParentId;
      }
    });
  }
  const linkKey = (link) => link.id || `${link.source}->${link.target}:${link.type || "relationship"}`;

  if (!visible.items.length) {
    graphStateEl.className = "graph-state";
    graphStateEl.innerHTML =
      state.viewMode === "live"
        ? `<strong>No live execution signal</strong><span>The current topology snapshot does not report an active runtime execution. Refresh to check again.</span><button type="button" id="graph-state-action">Refresh runtime</button>`
        : `<strong>No matching entities</strong><span>Adjust the active filters or clear them to return to the full topology.</span><button type="button" id="graph-state-action">Clear filters</button>`;
    graphStateEl.hidden = false;
    graphStateEl.querySelector("#graph-state-action")?.addEventListener("click", () => {
      if (state.viewMode === "live") refreshGraph();
      else clearFilters();
    });
  } else {
    graphStateEl.hidden = true;
  }

  if (strategy.canvasEdges) {
    linkLayer.selectAll("path.link").remove();
    edgeCanvas.hidden = false;
    state.canvasGraph = { links: visible.links, nodeById, focusedIds };
    drawCanvasLinks(visible.links, nodeById, focusedIds);
  } else {
    edgeCanvas.hidden = true;
    state.canvasGraph = null;
    const link = linkLayer.selectAll("path.link").data(visible.links, linkKey);
    link.exit().remove();
    link
      .enter()
      .append("path")
      .attr("class", "link")
      .attr("marker-end", "url(#arrow)")
      .merge(link)
      .attr("class", (row) => `link relation-${relationshipStyle(row).className} ${focus?.links?.includes(row) ? "focus-link" : ""}`)
      .classed("context-link", (row) => state.selectedId && (row.source === state.selectedId || row.target === state.selectedId))
      .classed("muted", (row) => focusedIds.size && (!focusedIds.has(row.source) || !focusedIds.has(row.target)))
      .classed("upstream", (row) => state.selectedId && row.target === state.selectedId)
      .classed("downstream", (row) => state.selectedId && row.source === state.selectedId)
      .attr("d", (row) => linkPath(row, nodeById));
  }

  const node = nodeLayer.selectAll("g.node").data(visible.items, (row) => row.id);
  node.exit().remove();
  const entered = node
    .enter()
    .append("g")
    .attr("class", "node")
    .attr("tabindex", -1)
    .attr("role", "button")
    .attr("aria-label", (row) => `${row.label}, ${agentLabel(row)}, ${runtimeStatusLabel(row)}`);
  entered.filter((row) => row.kind === "cluster").call(clusterCard);
  entered.filter((row) => row.kind !== "cluster").call(agentShape);

  const merged = entered.merge(node);
  merged
    .attr("class", (row) => `node ${row.kind === "cluster" ? "cluster-node" : "agent-node"} type-${visualType(row)} status-${row.statusGroup}`)
    .classed("project-node", (row) => row.clusterLevel === "project")
    .classed("orbit-anchor", (row) => Boolean(row.orbitAnchor))
    .classed("orbit-peripheral", (row) => Boolean(row.orbitParentId))
    .classed("selected", (row) => row.id === state.selectedId)
    .classed("focus-upstream", (row) => focus?.upstream?.has(row.id))
    .classed("focus-downstream", (row) => focus?.downstream?.has(row.id))
    .classed("muted", (row) => focusedIds.size && !focusedIds.has(row.id) && row.id !== state.selectedId)
    .style("--node-color", (row) => palette[visualType(row)] || "#64748b")
    .style("--status-color", (row) => statusPalette[row.statusGroup] || statusPalette.idle)
    .attr("transform", (row) => `translate(${row.x},${row.y})`)
    .attr("aria-pressed", (row) => String(row.id === state.selectedId))
    .attr("aria-expanded", (row) => (row.kind === "cluster" ? String(state.expandedClusters.has(row.id)) : null))
    .on("click", (event, row) => {
      event.stopPropagation();
      if (state.selectedId !== row.id) state.inspectorTab = "overview";
      if (row.kind === "cluster") {
        if (state.expandedClusters.has(row.id)) state.expandedClusters.delete(row.id);
        else state.expandedClusters.add(row.id);
        state.selectedId = row.id;
      } else {
        state.selectedId = row.id;
      }
      setInspectorOpen(true, { fit: false });
      selectionAnnouncementEl.textContent = `${row.label} selected. ${state.depth} hop relationships shown.`;
      try {
        savePositions(window.localStorage, state.filters.project, state.viewMode, visible.items);
      } catch {
        statusEl.className = "warning";
      }
      render();
      if (state.viewMode !== "explore") window.requestAnimationFrame(() => fitSelection());
    })
    .on("keydown", (event, row) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.currentTarget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        focusGraphItem(row, event.key, visible.items);
      }
    })
    .on("focus", (_event, row) => {
      merged.classed("keyboard-focus", (item) => item.id === row.id);
    })
    .on("blur", () => merged.classed("keyboard-focus", false))
    .on("mouseenter", (event, row) => showTooltip(event, row))
    .on("mousemove", (event, row) => showTooltip(event, row))
    .on("mouseleave", hideTooltip)
    .call(
      d3
        .drag()
        .on("start", function () {
          d3.select(this).raise().classed("dragging", true);
        })
        .on("drag", function (event, row) {
          row.x = event.x;
          row.y = event.y;
          d3.select(this).attr("transform", `translate(${row.x},${row.y})`);
          nodeById.set(row.id, row);
          linkLayer.selectAll("path.link").attr("d", (linkRow) => linkPath(linkRow, nodeById));
          if (state.canvasGraph) drawCanvasLinks(state.canvasGraph.links, nodeById, state.canvasGraph.focusedIds);
          drawMinimap(visible.items, visible.links);
        })
        .on("end", function () {
          d3.select(this).classed("dragging", false);
          try {
            savePositions(window.localStorage, state.filters.project, state.viewMode, visible.items);
          } catch {
            statusEl.className = "warning";
          }
        })
    );

  if (state.selectedId && selectedRenderable) renderDetails(model, selectedRenderable);
  else renderDetails(model, null);
  renderBreadcrumb(visible);
  drawMinimap(visible.items, visible.links);
  renderEntityList(visible.items);
  graphEl.dataset.zoomLevel = zoomLevel(state.currentZoom);
  graphEl.dataset.viewMode = state.viewMode;
  graphEl.dataset.large = strategy.progressive ? "true" : "false";
  graphEl.dataset.renderEngine = strategy.mode;

  if (state.viewMode === "explore" && !strategy.progressive && visible.items.length <= 180) {
    runLightExploreLayout(visible.items, visible.links);
  }
  lucide?.createIcons({
    attrs: {
      "stroke-width": 2.2,
      width: 20,
      height: 20
    }
  });
  if (!visibleIds.has(state.selectedId) && state.selectedId && model.nodeById.has(state.selectedId)) renderDetails(model, model.nodeById.get(state.selectedId));
  const frameMs = performance.now() - renderStartedAt;
  state.renderMetrics = { lastFrameMs: frameMs, mode: strategy.mode };
  graphEl.dataset.renderMs = frameMs.toFixed(1);
  renderCounts(model, visible, { mode: strategy.mode, frameMs });
}

function focusGraphItem(current, key, items) {
  if (!items.length) return;
  let target;
  if (key === "Home") target = items[0];
  else if (key === "End") target = items[items.length - 1];
  else {
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    }[key];
    target = items
      .filter((item) => item.id !== current.id)
      .map((item) => {
        const dx = item.x - current.x;
        const dy = item.y - current.y;
        const directional = dx * direction[0] + dy * direction[1];
        const cross = Math.abs(dx * direction[1] - dy * direction[0]);
        return { item, directional, score: Math.hypot(dx, dy) + cross * 1.8 };
      })
      .filter((candidate) => candidate.directional > 4)
      .sort((a, b) => a.score - b.score)[0]?.item;
  }
  if (!target) return;
  nodeLayer
    .selectAll("g.node")
    .filter((item) => item.id === target.id)
    .node()
    ?.focus();
}

function runLightExploreLayout(items, links) {
  const degree = new Map(items.map((item) => [item.id, 0]));
  links.forEach((link) => {
    if (degree.has(link.source)) degree.set(link.source, (degree.get(link.source) || 0) + 1);
    if (degree.has(link.target)) degree.set(link.target, (degree.get(link.target) || 0) + 1);
  });
  const nodes = items.map((item) => ({
    ...item,
    targetX: item.x,
    targetY: item.y,
    fx: item.projectClusterCenter ? item.x : null,
    fy: item.projectClusterCenter ? item.y : null
  }));
  const simNodeById = new Map(nodes.map((node) => [node.id, node]));
  const simLinks = links.filter((link) => simNodeById.has(link.source) && simNodeById.has(link.target)).map((link) => ({ ...link }));
  const simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(simLinks)
        .id((node) => node.id)
        .distance((link) => (simNodeById.get(link.source.id || link.source)?.orbitAnchor || simNodeById.get(link.target.id || link.target)?.orbitAnchor ? 230 : 285))
        .strength(0.18)
    )
    .force("charge", d3.forceManyBody().strength((node) => (node.orbitAnchor ? -920 : -330 - Math.min(5, degree.get(node.id) || 0) * 34)))
    .force("x", d3.forceX((node) => node.targetX).strength((node) => (node.projectClusterCenter ? 1 : node.orbitAnchor ? 0.6 : 0.2)))
    .force("y", d3.forceY((node) => node.targetY).strength((node) => (node.projectClusterCenter ? 1 : node.orbitAnchor ? 0.6 : 0.2)))
    .force("collision", d3.forceCollide().radius((node) => layoutNodeRadius(node) + 20).iterations(6))
    .stop();
  for (let index = 0; index < 96; index += 1) simulation.tick();
  const positionById = new Map(nodes.map((node) => [node.id, node]));
  items.forEach((item) => {
    const next = positionById.get(item.id);
    if (next) {
      item.x = next.x;
      item.y = next.y;
    }
  });
  nodeLayer.selectAll("g.node").data(items, (row) => row.id).attr("transform", (row) => `translate(${row.x},${row.y})`);
  const nodeById = new Map(items.map((item) => [item.id, item]));
  linkLayer.selectAll("path.link").attr("d", (row) => linkPath(row, nodeById));
  if (state.canvasGraph) {
    state.canvasGraph.nodeById = nodeById;
    drawCanvasLinks(state.canvasGraph.links, nodeById, state.canvasGraph.focusedIds);
  }
  drawMinimap(items, links);
}

function centerExploreView(duration = 260) {
  const visible = currentVisible();
  if (!visible.items.length) return;
  const center = visible.items.reduce(
    (acc, item) => ({ x: acc.x + item.x, y: acc.y + item.y }),
    { x: 0, y: 0 }
  );
  center.x /= visible.items.length;
  center.y /= visible.items.length;
  const scale = Math.min(1, Math.max(0.72, state.currentZoom || 1));
  const x = width / 2 - scale * center.x;
  const y = height / 2 - scale * center.y;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  svg.transition().duration(reduceMotion ? 0 : duration).call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(scale));
}

function fitAfterPassiveUpdate() {
  if (state.viewMode === "explore") centerExploreView();
  else fitSelection();
}

function fitItems(items, duration = 420) {
  if (!items?.length) return;
  const bounds = items.reduce(
    (acc, item) => {
      const halfWidth = item.kind === "cluster" ? 102 : 42;
      const halfHeight = item.kind === "cluster" ? 56 : 48;
      return {
        minX: Math.min(acc.minX, item.x - halfWidth),
        maxX: Math.max(acc.maxX, item.x + halfWidth),
        minY: Math.min(acc.minY, item.y - halfHeight),
        maxY: Math.max(acc.maxY, item.y + halfHeight)
      };
    },
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const padding = 52;
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX + padding);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY + padding);
  const reservedRight = width > 900 ? 212 : width > 560 ? 164 : 124;
  const availableWidth = Math.max(220, width - reservedRight);
  const scale = Math.min(1.05, availableWidth / contentWidth, height / contentHeight);
  const x = availableWidth / 2 - scale * ((bounds.minX + bounds.maxX) / 2);
  const y = height / 2 - scale * ((bounds.minY + bounds.maxY) / 2);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  svg.transition().duration(reduceMotion ? 0 : duration).call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(scale));
}

function currentVisible() {
  return visibleGraphForState(state.graph, { ...state, storage: window.localStorage }, width, height, dagre);
}

function fitSelection() {
  const visible = currentVisible();
  if (state.selectedId) {
    const focus = focusNeighborhood(state.graph, state.selectedId, state.depth);
    const itemById = new Map(visible.items.map((item) => [item.id, item]));
    const isDescendant = (item) => {
      let parentId = item.clusterParentId;
      while (parentId) {
        if (parentId === state.selectedId) return true;
        parentId = itemById.get(parentId)?.clusterParentId;
      }
      return false;
    };
    const selectedItems = visible.items.filter((item) => focus.ids.has(item.id) || item.id === state.selectedId || isDescendant(item));
    fitItems(selectedItems.length ? selectedItems : visible.items);
  } else {
    fitItems(visible.items);
  }
}

function resetView() {
  state.filters.search = "";
  state.filters.project = "all";
  state.filters.agentType = "all";
  state.filters.status = "all";
  state.filters.relationshipType = "all";
  state.viewMode = "overview";
  state.depth = 1;
  state.selectedId = "";
  state.expandedClusters.clear();
  setInspectorOpen(false, { fit: false });
  controls.search.value = "";
  controls.project.value = "all";
  controls.agentType.value = "all";
  controls.status.value = "all";
  controls.relationshipType.value = "all";
  controls.depth.value = "1";
  closeSearchResults();
  setActiveView("overview", { render: false });
  updateFilterCount();
  render();
  window.requestAnimationFrame(() => fitSelection());
}

function updateFilterCount() {
  const count = [
    state.filters.project !== "all",
    state.filters.agentType !== "all",
    state.filters.status !== "all",
    state.filters.relationshipType !== "all",
    state.depth !== 1
  ].filter(Boolean).length;
  const countEl = document.getElementById("filter-count");
  countEl.textContent = String(count);
  countEl.hidden = count === 0;
}

function clearFilters() {
  resetProgressiveRender();
  state.filters.project = "all";
  state.filters.agentType = "all";
  state.filters.status = "all";
  state.filters.relationshipType = "all";
  state.depth = 1;
  controls.project.value = "all";
  controls.agentType.value = "all";
  controls.status.value = "all";
  controls.relationshipType.value = "all";
  controls.depth.value = "1";
  updateFilterCount();
  render();
  window.requestAnimationFrame(() => fitAfterPassiveUpdate());
}

function resizeGraph(options = {}) {
  const nextWidth = Math.max(graphEl.clientWidth, 320);
  const nextHeight = Math.max(graphEl.clientHeight, 280);
  if (nextWidth === width && nextHeight === height) return;
  width = nextWidth;
  height = nextHeight;
  svg.attr("viewBox", [0, 0, width, height]);
  resizeEdgeCanvas();
  if (state.graph) {
    render();
    if (options.fit !== false) window.requestAnimationFrame(() => fitAfterPassiveUpdate());
  }
}

async function refreshGraph(options = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  const refreshButton = document.getElementById("refresh-graph");
  refreshButton.classList.add("is-loading");
  refreshButton.disabled = true;
  if (!state.graph) graphStateEl.hidden = false;
  try {
    const result = await loadGraph();
    state.graph = normalizeGraph(result.data);
    resetProgressiveRender();
    state.source = result.source;
    state.loadedAt = result.loadedAt;
    populateControls(state.graph);
    renderLegend();
    render();
    if (!options.background) window.requestAnimationFrame(() => fitAfterPassiveUpdate());
  } catch (error) {
    if (!state.graph) {
      graphStateEl.className = "graph-state error";
      graphStateEl.innerHTML = `<strong>Topology unavailable</strong><span>${escapeHtml(error.message)}. Check the runtime service and try refreshing.</span><button type="button" id="graph-state-action">Retry runtime</button>`;
      graphStateEl.querySelector("#graph-state-action")?.addEventListener("click", () => refreshGraph());
      graphStateEl.hidden = false;
    }
    statusEl.className = "error";
    statusEl.innerHTML = `<i class="connection-dot" aria-hidden="true"></i><span>${escapeHtml(error.message)}</span>`;
  } finally {
    state.refreshing = false;
    refreshButton.classList.remove("is-loading");
    refreshButton.disabled = false;
    lucide?.createIcons();
  }
}

function updateAutoRefresh() {
  window.clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
  if (state.viewMode === "live") {
    state.autoRefreshTimer = window.setInterval(() => refreshGraph({ background: true }), 15000);
  }
}

function bindControls() {
  controls.search.addEventListener("input", () => {
    state.searchActiveIndex = 0;
    renderSearchResults(controls.search.value);
  });
  controls.search.addEventListener("keydown", (event) => {
    const results = matchingSearchResults(controls.search.value);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      state.searchActiveIndex = (state.searchActiveIndex + delta + results.length) % Math.max(1, results.length);
      renderSearchResults(controls.search.value);
    } else if (event.key === "Enter" && results.length) {
      event.preventDefault();
      commitSearchResult(results[state.searchActiveIndex]?.id || results[0].id);
    } else if (event.key === "Escape") {
      closeSearchResults();
    }
  });
  controls.project.addEventListener("change", () => {
    resetProgressiveRender();
    state.filters.project = controls.project.value;
    updateFilterCount();
    render();
  });
  controls.agentType.addEventListener("change", () => {
    resetProgressiveRender();
    state.filters.agentType = controls.agentType.value;
    updateFilterCount();
    render();
  });
  controls.status.addEventListener("change", () => {
    resetProgressiveRender();
    state.filters.status = controls.status.value;
    updateFilterCount();
    render();
  });
  controls.relationshipType.addEventListener("change", () => {
    resetProgressiveRender();
    state.filters.relationshipType = controls.relationshipType.value;
    updateFilterCount();
    render();
  });
  controls.depth.addEventListener("change", () => {
    state.depth = Number(controls.depth.value);
    updateFilterCount();
    render();
    window.requestAnimationFrame(() => fitAfterPassiveUpdate());
  });

  document.querySelectorAll("[data-view-mode]").forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.viewMode));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(document.querySelectorAll("[data-view-mode]"));
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const target = buttons[(buttons.indexOf(button) + direction + buttons.length) % buttons.length];
      target.focus();
      setActiveView(target.dataset.viewMode);
    });
  });
  document.getElementById("filter-toggle").addEventListener("click", (event) => {
    const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
    event.currentTarget.setAttribute("aria-expanded", String(!expanded));
    document.getElementById("advanced-filters").hidden = expanded;
    window.requestAnimationFrame(() => resizeGraph());
  });
  document.getElementById("clear-filters").addEventListener("click", clearFilters);
  document.getElementById("collapse-all").addEventListener("click", () => {
    state.expandedClusters.clear();
    render();
  });
  document.getElementById("fit-selection").addEventListener("click", fitSelection);
  document.getElementById("reset-view").addEventListener("click", resetView);
  document.getElementById("refresh-graph").addEventListener("click", () => refreshGraph());
  document.getElementById("list-view").addEventListener("click", (event) => {
    const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
    event.currentTarget.setAttribute("aria-expanded", String(!expanded));
    event.currentTarget.classList.toggle("is-active", !expanded);
    entityListPanelEl.hidden = expanded;
    if (!expanded) entityListEl.querySelector("button")?.focus();
  });
  document.getElementById("product-video-view")?.addEventListener("click", () => setProductVideoOpen(true));
  document.getElementById("close-product-video")?.addEventListener("click", () => setProductVideoOpen(false));
  productVideoDialogEl?.querySelector("[data-close-product-video]")?.addEventListener("click", () => setProductVideoOpen(false));
  document.getElementById("close-entity-list").addEventListener("click", () => {
    entityListPanelEl.hidden = true;
    const button = document.getElementById("list-view");
    button.setAttribute("aria-expanded", "false");
    button.classList.remove("is-active");
    button.focus();
  });
  document.getElementById("close-insight").addEventListener("click", () => {
    setInspectorOpen(false);
    graphEl.focus();
  });
  document.getElementById("sheet-toggle").addEventListener("click", (event) => {
    state.sheetExpanded = !state.sheetExpanded;
    insightEl.classList.toggle("is-expanded", state.sheetExpanded);
    event.currentTarget.setAttribute("aria-expanded", String(state.sheetExpanded));
    event.currentTarget.setAttribute("aria-label", state.sheetExpanded ? "Collapse agent details" : "Expand agent details");
  });
  document.getElementById("fullscreen-view").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.querySelector(".graph-page").requestFullscreen?.();
    } catch {
      statusEl.className = "warning";
      statusEl.innerHTML = `<i class="connection-dot" aria-hidden="true"></i><span>Fullscreen is not available in this browser context.</span>`;
    }
  });
  document.getElementById("zoom-in").addEventListener("click", () => svg.transition().duration(180).call(zoom.scaleBy, 1.25));
  document.getElementById("zoom-out").addEventListener("click", () => svg.transition().duration(180).call(zoom.scaleBy, 0.8));
  graphEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.inspectorOpen) setInspectorOpen(false);
      else {
        state.selectedId = "";
        render();
      }
    }
    if (event.key.toLowerCase() === "f") fitSelection();
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) && event.target === graphEl) {
      event.preventDefault();
      const items = currentVisible().items;
      nodeLayer.selectAll("g.node").filter((item) => item.id === (state.selectedId || items[0]?.id)).node()?.focus();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && productVideoDialogEl && !productVideoDialogEl.hidden) {
      event.preventDefault();
      setProductVideoOpen(false);
      return;
    }
    if (event.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      controls.search.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".search-control")) closeSearchResults();
  });
  document.addEventListener("fullscreenchange", () => {
    const button = document.getElementById("fullscreen-view");
    const active = Boolean(document.fullscreenElement);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
    window.requestAnimationFrame(() => resizeGraph());
  });
}

const resizeObserver = new ResizeObserver(() => {
  window.clearTimeout(resizeGraph.timer);
  resizeGraph.timer = window.setTimeout(() => resizeGraph({ fit: false }), 80);
});
resizeObserver.observe(graphEl);

bindControls();
setActiveView("overview", { render: false });
refreshGraph();
