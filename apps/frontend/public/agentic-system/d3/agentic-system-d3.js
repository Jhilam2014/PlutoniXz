import {
  VIEW_MODES,
  NODE_TYPE_REGISTRY,
  architectureNodeRadius,
  applyGraphFilters,
  buildClusters,
  createArchitectureEdgePlan,
  focusNeighborhood,
  humanize,
  isHierarchyLink,
  layoutNodeBounds,
  loadPositions,
  nodeId,
  nodeTypeLabel,
  nodeVisualType,
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
const architecturePanelEl = document.getElementById("architecture-panel");
const architectureSelectionEl = document.getElementById("architecture-selection");
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
const flowFeatureControlsEl = document.getElementById("flow-feature-controls");
const flowFeatureSelectEl = document.getElementById("flow-feature-select");
const flowFeaturePreviousEl = document.getElementById("flow-feature-previous");
const flowFeatureNextEl = document.getElementById("flow-feature-next");
const flowFeaturePositionEl = document.getElementById("flow-feature-position");
const params = new URLSearchParams(window.location.search);
const requestedView = VIEW_MODES[params.get("view")] ? params.get("view") : "overview";
const requestedProject = params.get("project")?.trim() || "";

if (params.has("embedded")) document.documentElement.classList.add("embedded");
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}
applyTheme(params.get("theme"));
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.data?.type !== "plutomix:set-theme") return;
  applyTheme(event.data.theme);
});
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
  functionality: "#14b8a6",
  subfunctionality: "#38bdf8",
  branch: "#f97316",
  architectureCategory: "#3b82f6",
  architectureBranchSummary: "#0f766e",
  deadBranchSummary: "#9ca3af",
  workflow: "#64748b",
  page: "#38bdf8",
  validation: "#64748b",
  investigation: "#6366f1",
  knowledge: "#0f766e",
  milestone: "#a855f7",
  "approval-gate": "#f59e0b",
  "monetary-approval": "#d97706",
  objective: "#6366f1",
  pattern: "#14b8a6",
  promotion: "#ec4899",
  proposal: "#f97316",
  "research-budget": "#64748b",
  system: "#334155",
  "tool-plan": "#0ea5e9",
  artifact: "#64748b"
};

const statusPalette = {
  running: "#22c55e",
  waiting: "#f59e0b",
  failed: "#ef4444",
  idle: "#94a3b8"
};

const architectureZonePalette = {
  ui: { stroke: "#38bdf8", fill: "rgba(14, 116, 144, 0.13)" },
  api: { stroke: "#f59e0b", fill: "rgba(180, 83, 9, 0.13)" },
  data: { stroke: "#22c55e", fill: "rgba(21, 128, 61, 0.13)" },
  integration: { stroke: "#a78bfa", fill: "rgba(109, 40, 217, 0.14)" },
  security: { stroke: "#f472b6", fill: "rgba(190, 24, 93, 0.13)" },
  test: { stroke: "#2dd4bf", fill: "rgba(15, 118, 110, 0.13)" },
  runtime: { stroke: "#60a5fa", fill: "rgba(37, 99, 235, 0.13)" },
  agents: { stroke: "#fbbf24", fill: "rgba(146, 64, 14, 0.13)" },
  unmapped_evidence: { stroke: "#94a3b8", fill: "rgba(71, 85, 105, 0.14)" },
  other: { stroke: "#818cf8", fill: "rgba(79, 70, 229, 0.12)" }
};

const controls = {
  search: document.getElementById("agent-search"),
  project: document.getElementById("project-filter"),
  agentType: document.getElementById("type-filter"),
  status: document.getElementById("status-filter"),
  relationshipType: document.getElementById("relationship-filter")
};

const state = {
  graph: null,
  filters: {
    search: "",
    project: "",
    agentType: "all",
    status: "all",
    relationshipType: "all"
  },
  viewMode: "overview",
  expandedClusters: new Set(),
  expandedSubfunctionalities: new Set(),
  selectedId: "",
  flowMajorFeatureId: "",
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

// Explore now owns the source-backed architecture canvas. Keeping the check
// centralized prevents the retired Architecture Branches view from gaining a
// second rendering path again.
const isExploreArchitecture = () => state.viewMode === "explore";
const isFunctionalityFlow = () => state.viewMode === "flow";

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
    node?.metadata?.observedCurrent?.description ||
    node?.metadata?.observed_current?.description ||
    node?.metadata?.functionality?.description ||
    node?.metadata?.description ||
    node?.metadata?.responsibility ||
    `${node?.label || "This item"} participates in the ${humanize(node?.domain || node?.capability || node?.type)} system surface.`
  );
}

function agentLabel(node) {
  if (node?.kind === "cluster") return nodeTypeLabel(node);
  if (node?.agentType === "qagent") return "QAgent";
  if (node?.agentType === "reviewer") return "Reviewer";
  if (node?.agentType === "worker") return "Worker agent";
  if (node?.agentType === "memory") return "Memory / database";
  if (node?.agentType === "human") return "Human agent";
  if (node?.agentType === "functionality") return "Application functionality";
  if (node?.agentType === "subfunctionality") return "Cited code unit";
  if (node?.agentType === "branch") {
    if (node?.metadata?.disabled) return "Rejected / disabled architecture branch";
    if (node?.metadata?.futureEnhancement) return "Future enhancement branch";
    return node?.metadata?.inferenceRole === "observed_current" ? "Observed implementation" : "Deferred architecture branch";
  }
  if (node?.agentType === "architectureCategory") return "Functionality analysis group";
  if (node?.agentType === "architectureBranchSummary") return "Architecture branch summary";
  if (node?.agentType === "deadBranchSummary") return "Disabled branch summary";
  return nodeTypeLabel(node);
}

function visualType(node) {
  return nodeVisualType(node);
}

function nodeColor(node) {
  const type = visualType(node);
  if (!node?.metadata?.architectureLens || !["orchestrator", "worker", "qagent", "reviewer", "human"].includes(type)) {
    return palette[type] || "#64748b";
  }
  const scope = node.metadata?.assignmentScope;
  const scopedPalette = {
    "project-exclusive": {
      orchestrator: "#7c3aed", worker: "#2563eb", qagent: "#ec4899", reviewer: "#06b6d4", human: "#0f766e"
    },
    shared: {
      orchestrator: "#a855f7", worker: "#0ea5e9", qagent: "#f97316", reviewer: "#14b8a6", human: "#65a30d"
    }
  };
  return scopedPalette[scope]?.[type] || palette[type] || "#64748b";
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

function nodeSubtitle(node) {
  const type = visualType(node);
  if (node.metadata?.deliveryOrder) {
    const basis = node.metadata?.timelineInferred ? "inferred" : "recorded";
    return `Step ${node.metadata.deliveryOrder} · ${node.metadata.deliveryPhase || "delivery sequence"} · ${basis}`;
  }
  if (node.metadata?.architectureLens && ["orchestrator", "worker", "qagent", "reviewer", "human"].includes(type)) {
    return `${agentLabel(node)} · ${node.metadata?.assignmentScope === "shared" ? "shared" : "project-exclusive"}`;
  }
  if (type === "project" && node.metadata?.architectureLens) {
    return `${node.metadata?.functionalityCount || 0} functions · complexity ${Math.round(Number(node.metadata?.complexity || 0) * 100)}%`;
  }
  if (type === "functionality" && node.metadata?.architectureLens) {
    const complexity = Number(node.metadata?.cyclomaticComplexity || 0);
    return complexity
      ? `CC ${complexity} · ${node.metadata?.branchCount || 0} branches · ${node.metadata?.implementingAgentCount || 0} owners`
      : `${node.metadata?.branchCount || 0} connected branches · ${node.metadata?.implementingAgentCount || 0} owners`;
  }
  if (node.metadata?.architectureLens && node.metadata?.applicationTopology) {
    const sourceHints = node.metadata?.sourceHints || {};
    const reference = node.metadata?.sourceReference || "cited source";
    if (type === "page") return `UI surface · ${reference}`;
    if (type === "api") return `${sourceHints.route?.method || "API"} route · ${sourceHints.route?.path || reference}`;
    if (type === "database") return sourceHints.database?.table ? `Database table · ${sourceHints.database.table}` : `Database connection · ${reference}`;
  }
  if (type === "subfunctionality" && node.metadata?.architectureLens) {
    return `${humanize(node.metadata?.sourceKind || "source unit")} · ${node.metadata?.sourceReference || "cited source"}`;
  }
  if (type === "branch" && node.metadata?.architectureLens) {
    return node.metadata?.disabled ? "rejected / disabled" : humanize(node.status || node.statusGroup);
  }
  return `${agentLabel(node)} · ${runtimeStatusLabel(node)}`;
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
  if (type === "database") return "DB";
  if (type === "page") return "UI";
  if (type === "functionality") return "FN";
  if (type === "subfunctionality") return "CU";
  if (type === "branch") return "BR";
  if (type === "architectureCategory") return "FX";
  if (type === "architectureBranchSummary") return "ALT";
  if (type === "deadBranchSummary") return "OFF";
  if (type === "service") return "SVC";
  if (type === "workflow") return "WF";
  if (type === "page") return "PG";
  if (type === "validation") return "OK";
  return acronymFor(NODE_TYPE_REGISTRY[type]?.label || "Node", 3);
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
    node?.metadata?.category,
    node?.metadata?.role,
    node?.metadata?.responsibility,
    node?.metadata?.description
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const type = visualType(node);
  const category = String(node?.metadata?.category || "").toLowerCase();
  const registeredIcon = NODE_TYPE_REGISTRY[type]?.icon;
  if (node?.clusterLevel === "project") return "folder-kanban";
  if (type === "project") return "folder-kanban";
  if (type === "architectureCategory" || (type === "functionality" && node?.metadata?.architectureLens)) {
    if (category.includes("ui")) return "panels-top-left";
    if (category.includes("api")) return "route";
    if (category.includes("data")) return "database";
    if (category.includes("integration")) return "plug";
    if (category.includes("security")) return "shield-check";
    if (category.includes("test")) return "flask-conical";
    if (category.includes("runtime") || category.includes("deploy")) return "container";
    return "boxes";
  }
  if (type === "architectureBranchSummary") return "git-fork";
  if (type === "deadBranchSummary") return "archive-x";
  if (type === "functionality") return "component";
  if (type === "branch") return "git-fork";
  if (type === "service" || type === "api" || type === "workflow" || type === "page" || type === "validation" || type === "database") return registeredIcon;
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
  return registeredIcon || "bot";
}

function appendLucideIcon(group, node, options = {}) {
  const size = options.size || 26;
  group
    .append("foreignObject")
    .attr("class", ["node-icon-object", options.className].filter(Boolean).join(" "))
    .attr("x", options.x ?? -size / 2)
    .attr("y", options.y ?? -size / 2)
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
  addOption(controls.project, "", "All projects");
  addOption(controls.agentType, "all", "All types");
  addOption(controls.status, "all", "All status");
  addOption(controls.relationshipType, "all", "All relations");
  projects.forEach((project) => addOption(controls.project, project, project));
  types.forEach((type) => addOption(controls.agentType, type, humanize(type)));
  statuses.forEach((status) => addOption(controls.status, status, status === "idle" ? "No live signal" : humanize(status)));
  relationTypes.forEach((type) => addOption(controls.relationshipType, type, humanize(type)));
  controls.project.value = projects.includes(state.filters.project) ? state.filters.project : "";
  controls.agentType.value = types.includes(state.filters.agentType) ? state.filters.agentType : "all";
  controls.status.value = statuses.includes(state.filters.status) ? state.filters.status : "all";
  controls.relationshipType.value = relationTypes.includes(state.filters.relationshipType) ? state.filters.relationshipType : "all";
}

function renderLegend() {
  const architectureLens = isExploreArchitecture();
  const dependencyLens = state.viewMode === "dependency";
  const nodeLegend = Array.from(new Set((state.graph?.nodes || []).map(visualType)))
    .filter((type) => NODE_TYPE_REGISTRY[type])
    .sort((left, right) => NODE_TYPE_REGISTRY[left].label.localeCompare(NODE_TYPE_REGISTRY[right].label))
    .map((type) => [type, NODE_TYPE_REGISTRY[type].label]);
  const statusLegend = architectureLens ? [
    ["running", "Current source evidence"],
    ["waiting", "Deferred alternative"],
    ["idle", "Disabled provenance"]
  ] : [
    ["running", "Running"],
    ["waiting", "Waiting"],
    ["failed", "Failed"],
    ["idle", "Idle"]
  ];
  legendEl.innerHTML = `
    <div class="legend-heading"><span>Legend</span><span>${VIEW_MODES[state.viewMode]}</span></div>
    <div class="legend-subheading">Node type</div>
    <div class="legend-group">${nodeLegend
      .map(([type, label]) => `<span><i class="shape-mark ${type}" style="--mark:${palette[type]}"></i>${escapeHtml(label)}</span>`)
      .join("")}</div>
    <div class="legend-subheading">Status</div>
    <div class="legend-group">${statusLegend
      .map(([status, label]) => `<span><i class="status-dot ${status}" style="--mark:${statusPalette[status]}">${statusMark({ statusGroup: status })}</i>${escapeHtml(label)}</span>`)
      .join("")}</div>
    <div class="legend-subheading">Connection kind</div>
    <div class="legend-group relation-legend">${architectureLens ? "<span><i class=\"line architecture\"></i>Feature relationship</span><span>Feature clusters group source-backed functionality. Select a node to inspect ownership, evidence, and connection details.</span><span>Thin connectors gain emphasis only for the selected node.</span>" : isFunctionalityFlow() ? "<span><i class=\"line solid\"></i>Recorded source relationship</span><span>Read left to right as an application map; ownership is contextual, not a causal step.</span><span>Control transitions appear only when their source relationship is recorded.</span>" : dependencyLens ? "<span><i class=\"line solid\"></i>Directed dependency</span><span>Left = upstream providers · centre = focus / cycles · right = downstream and descendants</span><span>Feature rows use delivery order when source dependencies support it; inferred imported-project order is labelled in Insight.</span>" : "<span><i class=\"line solid\"></i>Invocation</span><span><i class=\"line architecture\"></i>Architecture</span><span><i class=\"line dashed\"></i>Memory/data</span><span><i class=\"line dotted\"></i>Optional</span>"}</div>
  `;
}

function agentProfileHref(agent, context = {}) {
  const target = agent?.agent_id || agent?.id;
  if (!target) return "";
  const url = new URL("/", window.location.href);
  url.searchParams.set("workspace", "agents");
  url.searchParams.set("agent", target);
  Object.entries(context).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function renderArchitecturePanel(node) {
  const active = isExploreArchitecture();
  architecturePanelEl.hidden = !active;
  workspaceEl.classList.toggle("architecture-mode", active);
  if (!active) return;
  if (!node?.metadata?.architectureLens) {
    architectureSelectionEl.innerHTML = `<p>Select a circle to inspect its feature hierarchy, chronology, complexity, connectors, owner, and source evidence.</p>`;
    return;
  }
  const assignedAgents = Array.isArray(node.metadata?.assignedAgents) ? node.metadata.assignedAgents : [];
  const type = node.metadata?.applicationTopology
      ? nodeTypeLabel(node)
      : node.agentType === "functionality"
      ? "Functionality"
      : node.agentType === "subfunctionality"
        ? "Cited code unit"
      : node.metadata?.disabled
        ? "Rejected branch"
        : node.metadata?.futureEnhancement
          ? "Future enhancement"
        : "Architecture branch";
  const status = node.metadata?.disabled ? "disabled" : humanize(node.status || node.statusGroup);
  const surface = node.metadata?.surfaceLabel || node.metadata?.category || "project architecture";
  const cyclomaticComplexity = Number(node.metadata?.cyclomaticComplexity || 0);
  architectureSelectionEl.innerHTML = `
    <div class="architecture-selection-kicker"><span>${escapeHtml(type)}</span><b class="${node.metadata?.disabled ? "disabled" : ""}">${escapeHtml(status)}</b></div>
    <h2>${escapeHtml(node.label)}</h2>
    <p>${escapeHtml(nodeDescription(node))}</p>
    <dl>
      <div><dt>Surface</dt><dd>${escapeHtml(surface)}</dd></div>
      <div><dt>Functions</dt><dd>${node.metadata?.surfaceFunctionalityCount || node.metadata?.functionalityCount || 0}</dd></div>
      ${node.agentType === "functionality" ? `<div><dt>Code units</dt><dd>${node.metadata?.subfunctionalityCount || 0}</dd></div>` : ""}
      ${node.metadata?.applicationTopology ? `<div><dt>Source</dt><dd>${escapeHtml(node.metadata?.sourceReference || "cited source")}</dd></div>` : ""}
      ${node.metadata?.applicationTopology ? `<div><dt>Hierarchy depth</dt><dd>${Number(node.metadata?.architectureHierarchyDepth ?? node.metadata?.architectureLevel ?? 1)}</dd></div><div><dt>Chronology</dt><dd>#${Number(node.metadata?.chronologyOrder ?? 0) + 1}</dd></div><div><dt>Connectors</dt><dd>${Number(node.metadata?.connectorCount || 0)}</dd></div>` : ""}
      ${node.agentType === "subfunctionality" ? `<div><dt>Source</dt><dd>${escapeHtml(node.metadata?.sourceReference || "cited source")}</dd></div><div><dt>Kind</dt><dd>${escapeHtml(humanize(node.metadata?.sourceKind || "source unit"))}</dd></div>` : ""}
      ${cyclomaticComplexity ? `<div><dt>Code complexity</dt><dd>CC ${cyclomaticComplexity}</dd></div>` : ""}
      <div><dt>Branches</dt><dd>${node.metadata?.branchCount || 0}</dd></div>
    </dl>
    ${assignedAgents.length ? `<div class="architecture-selection-owners"><strong>Assigned</strong><span>${assignedAgents.map((agent) => `<a href="${escapeHtml(agentProfileHref(agent, { agentName: agent.name, agentType: agent.role, project: node.project }))}" target="_blank" rel="noopener">${escapeHtml(agent.name)}</a>`).join(" · ")}</span></div>` : ""}`;
}

function renderCounts(model, visible, telemetry = {}) {
  const filtered = applyGraphFilters(model, state.filters);
  const agents = filtered.nodes.filter((node) => node.type === "agent");
  const failed = agents.filter((node) => node.statusGroup === "failed").length;
  const warning = agents.filter((node) => node.statusGroup === "waiting").length;
  if (isExploreArchitecture()) {
    const functionalities = visible.items.filter((item) => item.agentType === "functionality" || item.metadata?.applicationTopology);
    const subfunctionalities = visible.items.filter((item) => item.agentType === "subfunctionality");
    const active = visible.items
      .filter((item) => item.agentType === "functionality" || item.metadata?.applicationTopology)
      .reduce((total, item) => total + Number(item.metadata?.observedCount || 0) + Number(item.metadata?.deferredCount || 0), 0);
    const disabled = visible.items
      .filter((item) => item.agentType === "functionality" || item.metadata?.applicationTopology)
      .reduce((total, item) => total + Number(item.metadata?.disabledCount || 0), 0);
    countsEl.innerHTML = `
      <div class="metric"><b>${functionalities.length}</b><span>Project features</span></div>
      <div class="metric"><b>${subfunctionalities.length}</b><span>Code units shown</span></div>
      <div class="metric"><b>${active}</b><span>Current / deferred</span></div>
      <div class="metric warning"><b>${disabled}</b><span>Disabled records</span></div>
      <div class="metric"><b>${visible.items.length}</b><span>Lens nodes</span></div>
    `;
  } else if (state.viewMode === "dependency") {
    const anchorId = visible.lens?.anchorId || "";
    const incoming = visible.links.filter((link) => link.target === anchorId).length;
    const outgoing = visible.links.filter((link) => link.source === anchorId).length;
    const reachableDepth = Math.max(0, ...visible.items.map((item) => Number.isFinite(item.dependencyDepth) ? item.dependencyDepth : 0));
    countsEl.innerHTML = `
      <div class="metric"><b>${visible.items.length}</b><span>Lens entities</span></div>
      <div class="metric"><b>${incoming}</b><span>Direct inputs</span></div>
      <div class="metric"><b>${outgoing}</b><span>Direct outputs</span></div>
      <div class="metric"><b>${reachableDepth}</b><span>Max dependency depth</span></div>
    `;
  } else if (isFunctionalityFlow()) {
    const stages = new Set(visible.items.map((item) => item.functionalityFlowStage).filter(Boolean));
    const relationships = visible.links.length;
    const majorFeatureCount = visible.flow?.majorFeatures?.length || 0;
    const controlTransitions = visible.flow?.controlRelationshipCount || 0;
    countsEl.innerHTML = `
      <div class="metric"><b>${majorFeatureCount}</b><span>Major features</span></div>
      <div class="metric"><b>${visible.items.length}</b><span>Feature view entities</span></div>
      <div class="metric"><b>${stages.size}</b><span>Map stages</span></div>
      <div class="metric"><b>${controlTransitions}/${relationships}</b><span>Recorded control links</span></div>
    `;
  } else {
    countsEl.innerHTML = `
      <div class="metric"><b>${agents.length}</b><span>Agents</span></div>
      <div class="metric"><b>${visible.items.length}</b><span>Visible</span></div>
      <div class="metric critical"><b>${failed}</b><span>Failed</span></div>
      <div class="metric warning"><b>${warning}</b><span>Warnings</span></div>
    `;
  }
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
  if (state.viewMode === "dependency" && visible.lens?.anchorId) {
    const anchor = visible.items.find((item) => item.id === visible.lens.anchorId);
    breadcrumbEl.innerHTML = `${escapeHtml(VIEW_MODES[state.viewMode])} <span aria-hidden="true">/</span> <span class="crumb-current">${escapeHtml(anchor?.label || "Dependency focus")}</span> <span class="focus-depth">complete reachable dependency chain</span>`;
    return;
  }
  if (isExploreArchitecture()) {
    breadcrumbEl.innerHTML = `${escapeHtml(VIEW_MODES[state.viewMode])} <span aria-hidden="true">/</span> <span class="crumb-current">Feature clusters &amp; agent ownership</span>`;
    return;
  }
  if (isFunctionalityFlow()) {
    const selectedFeature = visible.flow?.majorFeatures?.find((item) => item.id === visible.flow?.selectedMajorFeatureId);
    breadcrumbEl.innerHTML = `${escapeHtml(VIEW_MODES[state.viewMode])} <span aria-hidden="true">/</span> <span class="crumb-current">${escapeHtml(selectedFeature?.label || "Major feature")}</span> <span class="focus-depth">${escapeHtml(visible.flow?.evidenceLabel || "Source-derived application map")}</span>`;
    return;
  }
  const selectedVisible = visible.items.find((item) => item.id === state.selectedId);
  if (selectedVisible?.kind === "cluster") {
    breadcrumbEl.innerHTML = `${escapeHtml(VIEW_MODES[state.viewMode])} <span aria-hidden="true">/</span> <span class="crumb-current">${escapeHtml(selectedVisible.label)}</span>`;
    return;
  }
  if (!state.selectedId || !visible.focus?.breadcrumb?.length) {
    breadcrumbEl.innerHTML = `${escapeHtml(VIEW_MODES[state.viewMode])} <span aria-hidden="true">/</span> <span class="crumb-current">${escapeHtml(state.filters.project || "Select project")}</span>`;
    return;
  }
  breadcrumbEl.innerHTML = `${visible.focus.breadcrumb.map(escapeHtml).join(' <span aria-hidden="true">/</span> ')} <span class="focus-depth">related nodes</span>`;
}

function renderFlowFeatureControls(flow) {
  if (!flowFeatureControlsEl) return;
  const majorFeatures = flow?.majorFeatures || [];
  const active = isFunctionalityFlow() && majorFeatures.length > 0;
  flowFeatureControlsEl.hidden = !active;
  if (!active) return;

  const selectedId = flow.selectedMajorFeatureId || majorFeatures[0].id;
  const selectedIndex = Math.max(0, majorFeatures.findIndex((feature) => feature.id === selectedId));
  if (state.flowMajorFeatureId !== selectedId) state.flowMajorFeatureId = selectedId;
  const optionsChanged = flowFeatureSelectEl.options.length !== majorFeatures.length
    || Array.from(flowFeatureSelectEl.options).some((option, index) => option.value !== majorFeatures[index]?.id);
  if (optionsChanged) {
    const options = document.createDocumentFragment();
    majorFeatures.forEach((feature) => {
      const option = document.createElement("option");
      option.value = feature.id;
      option.textContent = feature.label;
      options.append(option);
    });
    flowFeatureSelectEl.replaceChildren(options);
  }
  flowFeatureSelectEl.value = selectedId;
  flowFeaturePreviousEl.disabled = selectedIndex === 0;
  flowFeatureNextEl.disabled = selectedIndex === majorFeatures.length - 1;
  flowFeaturePositionEl.textContent = `${selectedIndex + 1} of ${majorFeatures.length}`;
}

function selectFlowMajorFeature(featureId) {
  if (!featureId || state.flowMajorFeatureId === featureId) return;
  state.flowMajorFeatureId = featureId;
  state.selectedId = "";
  state.inspectorTab = "overview";
  render();
  window.requestAnimationFrame(() => fitSelection());
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
  .attr("aria-label", "Clustered PlutoMix topology");
const viewport = svg.append("g").attr("class", "graph-viewport");
const lensLayer = viewport.append("g").attr("class", "lens-scaffold").attr("aria-hidden", "true");
const perimeterLayer = viewport.append("g").attr("class", "architecture-perimeter").attr("aria-hidden", "true");
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
  .scaleExtent([0.14, 4.2])
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

function architectureZonesFor(items) {
  const zones = new Map();
  for (const item of items) {
    const bounds = item.metadata?.architectureZoneBounds;
    if (!bounds?.id) continue;
    const zone = zones.get(bounds.id) || {
      ...bounds,
      members: [],
      colour: architectureZonePalette[bounds.key] || architectureZonePalette.other
    };
    zone.members.push(item);
    zones.set(bounds.id, zone);
  }
  return [...zones.values()]
    .map((zone) => {
      const padding = 68;
      const memberBounds = zone.members.reduce(
        (current, item) => {
          const visual = layoutNodeBounds(item);
          return {
            minX: Math.min(current.minX, item.x - visual.halfWidth - padding),
            maxX: Math.max(current.maxX, item.x + visual.halfWidth + padding),
            minY: Math.min(current.minY, item.y - visual.halfHeight - padding),
            maxY: Math.max(current.maxY, item.y + visual.halfHeight + padding)
          };
        },
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
      );
      const minX = Math.min(zone.x, memberBounds.minX);
      const maxX = Math.max(zone.x + zone.width, memberBounds.maxX);
      const minY = Math.min(zone.y, memberBounds.minY);
      const maxY = Math.max(zone.y + zone.height, memberBounds.maxY);
      return {
        ...zone,
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY)
      };
    })
    .sort((left, right) => left.index - right.index || left.label.localeCompare(right.label));
}

function renderArchitectureScaffold(items, edgePlan) {
  const railByZoneId = new Map(
    (edgePlan?.visualLinks || [])
      .filter((link) => link.kind === "zone-rail")
      .map((link) => [link.zoneId, link])
  );
  const zones = isExploreArchitecture()
    ? architectureZonesFor(items).map((zone) => ({ ...zone, rail: railByZoneId.get(zone.id) }))
    : [];
  const selection = perimeterLayer.selectAll("g.architecture-zone-scaffold").data(zones, (zone) => zone.id);
  selection.exit().remove();
  const entered = selection.enter().append("g").attr("class", "architecture-zone-scaffold");
  entered.append("rect").attr("class", "architecture-zone-board");
  entered.append("path").attr("class", "architecture-zone-gate");
  entered.append("text").attr("class", "architecture-zone-title");
  entered.append("text").attr("class", "architecture-zone-caption");
  entered.append("text").attr("class", "architecture-zone-count");
  entered.merge(selection)
    .style("--zone-color", (zone) => zone.colour.stroke)
    .style("--zone-fill", (zone) => zone.colour.fill)
    .each(function (zone) {
      const group = d3.select(this);
      const inset = 14;
      const titleX = zone.x + 26;
      const titleY = zone.y + 34;
      group.select(".architecture-zone-board")
        .attr("x", zone.x + inset)
        .attr("y", zone.y + inset)
        .attr("width", Math.max(1, zone.width - inset * 2))
        .attr("height", Math.max(1, zone.height - inset * 2))
        .attr("rx", 22);
      const gateTop = zone.y + 62;
      const gateBottom = zone.y + zone.height - 38;
      const gateX = zone.x + 28;
      group.select(".architecture-zone-gate")
        .attr("d", `M${gateX + 22},${gateTop} C${gateX - 10},${zone.y + zone.height * 0.28} ${gateX - 10},${zone.y + zone.height * 0.72} ${gateX + 22},${gateBottom}M${gateX + 22},${gateTop}H${Math.min(zone.x + zone.width - 34, titleX + 218)}`);
      group.select(".architecture-zone-title")
        .attr("x", titleX)
        .attr("y", titleY)
        .text(zone.label);
      group.select(".architecture-zone-caption")
        .attr("x", titleX)
        .attr("y", titleY + 18)
        .text(zone.rail?.metadata?.unresolvedEvidence ? "Retained unresolved evidence" : "Source-backed feature group");
      group.select(".architecture-zone-count")
        .attr("x", zone.x + zone.width - 26)
        .attr("y", titleY)
        .attr("text-anchor", "end")
        .text(zone.rail?.label || `${zone.functionalityCount} functions`);
    });
}

function renderLensScaffold(items) {
  lensLayer.selectAll("*").remove();
  if (isFunctionalityFlow()) {
    const stages = [...new Map(items
      .filter((item) => item.functionalityFlow)
      .map((item) => [item.functionalityFlowStage, item])).values()]
      .sort((left, right) => left.functionalityFlowStageIndex - right.functionalityFlowStageIndex);
    const group = lensLayer.append("g").attr("class", "functionality-flow-stages");
    const virtualHeight = Math.max(height, ...items.map((item) => item.functionalityFlowVirtualHeight || 0));
    const stage = group.selectAll("g.functionality-flow-stage").data(stages).join("g").attr("class", "functionality-flow-stage");
    stage.append("rect")
      .attr("x", (item) => item.x - 112)
      .attr("y", 18)
      .attr("width", 224)
      .attr("height", Math.max(0, virtualHeight - 36))
      .attr("rx", 16);
    stage.append("text").attr("x", (item) => item.x).attr("y", 46).attr("text-anchor", "middle")
      .text((item) => item.functionalityFlowStageLabel);
    return;
  }
  if (state.viewMode === "dependency") {
    const virtualWidth = Math.max(width, ...items.map((item) => item.dependencyVirtualWidth || 0));
    const virtualHeight = Math.max(height, ...items.map((item) => item.dependencyVirtualHeight || 0));
    const checkpoints = items
      .filter((item) => item.dependencyLayout === "feature-timeline" && item.dependencyTimelineCheckpoint)
      .slice()
      .sort((left, right) => left.x - right.x);
    if (checkpoints.length >= 2) {
      const group = lensLayer.append("g").attr("class", "dependency-feature-timeline");
      const lineY = checkpoints[0].y;
      group.append("line")
        .attr("class", "dependency-timeline-rail")
        .attr("x1", checkpoints[0].x)
        .attr("y1", lineY)
        .attr("x2", checkpoints.at(-1).x)
        .attr("y2", lineY);
      const checkpoint = group.selectAll("g.dependency-timeline-checkpoint").data(checkpoints).join("g")
        .attr("class", "dependency-timeline-checkpoint");
      checkpoint.append("circle").attr("cx", (item) => item.x).attr("cy", (item) => item.y).attr("r", 35);
      checkpoint.append("text").attr("x", (item) => item.x).attr("y", (item) => item.y - 52).attr("text-anchor", "middle")
        .text((item) => `Step ${item.dependencyTimelineStep}`);
      checkpoint.append("text").attr("class", "dependency-timeline-phase").attr("x", (item) => item.x).attr("y", (item) => item.y + 58).attr("text-anchor", "middle")
        .text((item) => item.deliveryPhase || "Feature checkpoint");
      group.append("text").attr("class", "dependency-timeline-title").attr("x", 24).attr("y", 34)
        .text("Feature delivery timeline · associated agents, APIs, services, and data surround each checkpoint");
      return;
    }
    const fallbackWidth = virtualWidth / 3;
    const roleDefinition = [
      ["upstream", "Upstream providers", "What it needs"],
      ["focus", "Selected focus & cycles", "Inspect an entity"],
      ["downstream", "Downstream & descendants", "What it enables"]
    ];
    const roles = roleDefinition.map(([id, label, note], index) => {
      const members = items.filter((item) => (item.dependencyColumn || item.dependencyRole || "focus") === id);
      if (!members.length) return { id, label, note, x: index * fallbackWidth + 12, width: Math.max(132, fallbackWidth - 24) };
      const minX = Math.min(...members.map((item) => item.x - layoutNodeBounds(item).halfWidth)) - 32;
      const maxX = Math.max(...members.map((item) => item.x + layoutNodeBounds(item).halfWidth)) + 32;
      const timelineMembers = members.filter((item) => item.deliveryOrder);
      const timelineNote = timelineMembers.length
        ? `Delivery sequence ${Math.min(...timelineMembers.map((item) => item.deliveryOrder))}–${Math.max(...timelineMembers.map((item) => item.deliveryOrder))}`
        : note;
      return { id, label, note: timelineNote, x: Math.max(8, minX), width: Math.max(132, maxX - minX) };
    });
    const group = lensLayer.append("g").attr("class", "dependency-lanes");
    const lane = group.selectAll("g.dependency-lane").data(roles).join("g").attr("class", (row) => `dependency-lane ${row.id}`);
    lane.append("rect").attr("x", (row) => row.x).attr("y", 16).attr("width", (row) => row.width).attr("height", Math.max(0, virtualHeight - 32)).attr("rx", 12);
    lane.append("text").attr("x", (row) => row.x + 16).attr("y", 42).text((row) => row.label);
    lane.append("text").attr("x", (row) => row.x + 16).attr("y", 60).attr("class", "dependency-lane-note").text((row) => row.note);
    return;
  }
}

function linkEndpoints(source, target) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const sourceRadius = source.metadata?.architectureLens ? architectureNodeRadius(source) : 0;
  const targetRadius = target.metadata?.architectureLens ? architectureNodeRadius(target) : 0;
  return {
    sourceX: source.x + (dx / distance) * sourceRadius,
    sourceY: source.y + (dy / distance) * sourceRadius,
    targetX: target.x - (dx / distance) * targetRadius,
    targetY: target.y - (dy / distance) * targetRadius
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function architectureBoundaryPoint(node, toward) {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const radius = architectureNodeRadius(node);
  return {
    x: node.x + (dx / distance) * radius,
    y: node.y + (dy / distance) * radius
  };
}

function roundedPolyline(points, radius = 12) {
  const usable = points.filter((point, index, array) => !index || Math.hypot(point.x - array[index - 1].x, point.y - array[index - 1].y) > 0.5);
  if (!usable.length) return "";
  if (usable.length === 1) return `M${usable[0].x},${usable[0].y}`;
  if (usable.length === 2) return `M${usable[0].x},${usable[0].y}L${usable[1].x},${usable[1].y}`;
  let path = `M${usable[0].x},${usable[0].y}`;
  for (let index = 1; index < usable.length - 1; index += 1) {
    const previous = usable[index - 1];
    const current = usable[index];
    const next = usable[index + 1];
    const incoming = Math.max(1, Math.hypot(current.x - previous.x, current.y - previous.y));
    const outgoing = Math.max(1, Math.hypot(next.x - current.x, next.y - current.y));
    const corner = Math.min(radius, incoming / 2, outgoing / 2);
    const start = {
      x: current.x - ((current.x - previous.x) / incoming) * corner,
      y: current.y - ((current.y - previous.y) / incoming) * corner
    };
    const end = {
      x: current.x + ((next.x - current.x) / outgoing) * corner,
      y: current.y + ((next.y - current.y) / outgoing) * corner
    };
    path += `L${start.x},${start.y}Q${current.x},${current.y} ${end.x},${end.y}`;
  }
  const finalPoint = usable[usable.length - 1];
  return `${path}L${finalPoint.x},${finalPoint.y}`;
}

function smoothArchitectureRail(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const control = Math.min(210, Math.max(56, distance * 0.32));
  const normal = { x: -dy / distance, y: dx / distance };
  const bend = Math.min(46, distance * 0.08);
  return `M${from.x},${from.y}C${from.x + (dx / distance) * control + normal.x * bend},${from.y + (dy / distance) * control + normal.y * bend} ${to.x - (dx / distance) * control + normal.x * bend},${to.y - (dy / distance) * control + normal.y * bend} ${to.x},${to.y}`;
}

function targetEnvelope(targets, padding = 0) {
  const left = Math.min(...targets.map((target) => target.x - layoutNodeBounds(target).halfWidth)) - padding;
  const right = Math.max(...targets.map((target) => target.x + layoutNodeBounds(target).halfWidth)) + padding;
  const top = Math.min(...targets.map((target) => target.y - layoutNodeBounds(target).halfHeight)) - padding;
  const bottom = Math.max(...targets.map((target) => target.y + layoutNodeBounds(target).halfHeight)) + padding;
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function groupedTargetRails(targets, axis, side) {
  const grouped = [];
  const sorted = targets.slice().sort((left, right) => (axis === "vertical" ? left.x - right.x : left.y - right.y) || left.label.localeCompare(right.label));
  for (const target of sorted) {
    const coordinate = axis === "vertical" ? target.x : target.y;
    const previous = grouped[grouped.length - 1];
    if (!previous || Math.abs(previous.center - coordinate) > 28) grouped.push({ center: coordinate, targets: [target] });
    else previous.targets.push(target);
  }
  return grouped.map((group) => {
    if (axis === "vertical") {
      const coordinate = side === "left"
        ? Math.min(...group.targets.map((target) => target.x - layoutNodeBounds(target).halfWidth - 22))
        : Math.max(...group.targets.map((target) => target.x + layoutNodeBounds(target).halfWidth + 22));
      return {
        ...group,
        coordinate,
        start: Math.min(...group.targets.map((target) => target.y - layoutNodeBounds(target).halfHeight - 14)),
        end: Math.max(...group.targets.map((target) => target.y + layoutNodeBounds(target).halfHeight + 14))
      };
    }
    const coordinate = side === "top"
      ? Math.min(...group.targets.map((target) => target.y - layoutNodeBounds(target).halfHeight - 22))
      : Math.max(...group.targets.map((target) => target.y + layoutNodeBounds(target).halfHeight + 22));
    return {
      ...group,
      coordinate,
      start: Math.min(...group.targets.map((target) => target.x - layoutNodeBounds(target).halfWidth - 14)),
      end: Math.max(...group.targets.map((target) => target.x + layoutNodeBounds(target).halfWidth + 14))
    };
  });
}

function architectureRailNetwork(source, targets, bounds, options = {}) {
  if (!source || !targets.length) return { rail: "", spine: "", stubFor: () => "" };
  const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const dx = centre.x - source.x;
  const dy = centre.y - source.y;
  const horizontalAccess = Math.abs(dx) >= Math.abs(dy);
  if (horizontalAccess) {
    const side = dx >= 0 ? "left" : "right";
    const minimumY = bounds.y + Math.min(72, Math.max(26, bounds.height * 0.12));
    const maximumY = bounds.y + bounds.height - Math.min(72, Math.max(26, bounds.height * 0.12));
    const ingress = {
      x: side === "left" ? bounds.x + (options.innerInset ?? 30) : bounds.x + bounds.width - (options.innerInset ?? 30),
      y: clamp(source.y, Math.min(minimumY, maximumY), Math.max(minimumY, maximumY))
    };
    const sourcePort = architectureBoundaryPoint(source, ingress);
    const rails = groupedTargetRails(targets, "vertical", side);
    const minRail = Math.min(...rails.map((rail) => rail.coordinate));
    const maxRail = Math.max(...rails.map((rail) => rail.coordinate));
    const headerStart = { x: ingress.x, y: ingress.y };
    const headerEnd = { x: side === "left" ? maxRail : minRail, y: ingress.y };
    const spinePaths = [roundedPolyline([headerStart, headerEnd], 10)];
    rails.forEach((rail) => {
      spinePaths.push(roundedPolyline([{ x: rail.coordinate, y: ingress.y }, { x: rail.coordinate, y: rail.start }, { x: rail.coordinate, y: rail.end }], 8));
    });
    return {
      rail: smoothArchitectureRail(sourcePort, ingress),
      spine: spinePaths.join(""),
      stubFor(target) {
        const rail = rails.find((candidate) => candidate.targets.includes(target));
        if (!rail) return "";
        const start = { x: rail.coordinate, y: target.y };
        const end = architectureBoundaryPoint(target, start);
        return roundedPolyline([start, end], 7);
      }
    };
  }
  const side = dy >= 0 ? "top" : "bottom";
  const minimumX = bounds.x + Math.min(72, Math.max(26, bounds.width * 0.12));
  const maximumX = bounds.x + bounds.width - Math.min(72, Math.max(26, bounds.width * 0.12));
  const ingress = {
    x: clamp(source.x, Math.min(minimumX, maximumX), Math.max(minimumX, maximumX)),
    y: side === "top" ? bounds.y + (options.innerInset ?? 30) : bounds.y + bounds.height - (options.innerInset ?? 30)
  };
  const sourcePort = architectureBoundaryPoint(source, ingress);
  const rails = groupedTargetRails(targets, "horizontal", side);
  const minRail = Math.min(...rails.map((rail) => rail.coordinate));
  const maxRail = Math.max(...rails.map((rail) => rail.coordinate));
  const headerEnd = { x: ingress.x, y: side === "top" ? maxRail : minRail };
  const spinePaths = [roundedPolyline([ingress, headerEnd], 10)];
  rails.forEach((rail) => {
    spinePaths.push(roundedPolyline([{ x: ingress.x, y: rail.coordinate }, { x: rail.start, y: rail.coordinate }, { x: rail.end, y: rail.coordinate }], 8));
  });
  return {
    rail: smoothArchitectureRail(sourcePort, ingress),
    spine: spinePaths.join(""),
    stubFor(target) {
      const rail = rails.find((candidate) => candidate.targets.includes(target));
      if (!rail) return "";
      const start = { x: target.x, y: rail.coordinate };
      const end = architectureBoundaryPoint(target, start);
      return roundedPolyline([start, end], 7);
    }
  };
}

function localArchitecturePath(source, target) {
  const endpoints = linkEndpoints(source, target);
  const dx = endpoints.targetX - endpoints.sourceX;
  const dy = endpoints.targetY - endpoints.sourceY;
  if (Math.abs(dy) >= Math.abs(dx)) {
    const hingeY = endpoints.sourceY + dy / 2;
    return roundedPolyline([
      { x: endpoints.sourceX, y: endpoints.sourceY },
      { x: endpoints.sourceX, y: hingeY },
      { x: endpoints.targetX, y: hingeY },
      { x: endpoints.targetX, y: endpoints.targetY }
    ], 11);
  }
  const hingeX = endpoints.sourceX + dx / 2;
  return roundedPolyline([
    { x: endpoints.sourceX, y: endpoints.sourceY },
    { x: hingeX, y: endpoints.sourceY },
    { x: hingeX, y: endpoints.targetY },
    { x: endpoints.targetX, y: endpoints.targetY }
  ], 11);
}

function evidenceGutterPath(source, target) {
  const sourceBounds = layoutNodeBounds(source);
  const targetBounds = layoutNodeBounds(target);
  const gutterX = Math.max(source.x + sourceBounds.halfWidth, target.x + targetBounds.halfWidth) + 48;
  const start = architectureBoundaryPoint(source, { x: gutterX, y: source.y });
  const end = architectureBoundaryPoint(target, { x: gutterX, y: target.y });
  return roundedPolyline([start, { x: gutterX, y: start.y }, { x: gutterX, y: end.y }, end], 13);
}

function linkPath(link, nodeById) {
  const source = nodeById.get(nodeId(link.source));
  const target = nodeById.get(nodeId(link.target));
  if (!source || !target) return "";
  if (link.kind === "functionality-flow") return localArchitecturePath(source, target);
  if (source.metadata?.architectureLens && target.metadata?.architectureLens) {
    if (link.kind === "zone-rail" || link.kind === "zone-spine" || link.kind === "zone-stub") {
      const targets = (link.targetIds || [link.target]).map((id) => nodeById.get(nodeId(id))).filter(Boolean);
      const bounds = link.zoneBounds || targetEnvelope(targets, 46);
      const network = architectureRailNetwork(source, targets, bounds, { innerInset: 34 });
      if (link.kind === "zone-rail") return network.rail;
      if (link.kind === "zone-spine") return network.spine;
      const targetInsideZone = target.x >= bounds.x - 34 && target.x <= bounds.x + bounds.width + 34 && target.y >= bounds.y - 34 && target.y <= bounds.y + bounds.height + 34;
      return targetInsideZone ? network.stubFor(target) : localArchitecturePath(source, target);
    }
    if (link.kind === "fanout-rail" || link.kind === "fanout-spine" || link.kind === "fanout-stub") {
      const targets = (link.targetIds || [link.target]).map((id) => nodeById.get(nodeId(id))).filter(Boolean);
      const network = architectureRailNetwork(source, targets, targetEnvelope(targets, 42), { innerInset: -20 });
      if (link.kind === "fanout-rail") return network.rail;
      if (link.kind === "fanout-spine") return network.spine;
      return network.stubFor(target);
    }
    if (link.kind === "evidence-flow") return evidenceGutterPath(source, target);
    return localArchitecturePath(source, target);
  }
  const endpoints = linkEndpoints(source, target);
  const curve = Math.min(84, Math.hypot(endpoints.targetX - endpoints.sourceX, endpoints.targetY - endpoints.sourceY) * 0.24);
  return `M${endpoints.sourceX},${endpoints.sourceY} C${endpoints.sourceX + curve},${endpoints.sourceY} ${endpoints.targetX - curve},${endpoints.targetY} ${endpoints.targetX},${endpoints.targetY}`;
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
    const isContext = state.selectedId && (source.id === state.selectedId || target.id === state.selectedId);
    const style = relationshipStyle(link).className;
    const upstream = state.selectedId && target.id === state.selectedId;
    const downstream = state.selectedId && source.id === state.selectedId;
    const architectureLink = isExploreArchitecture() && source.metadata?.architectureLens && target.metadata?.architectureLens;
    const architectureSelectedLink = architectureLink && isContext;
    const architecturePrimaryLink = architectureLink && Math.min(
      Number(source.metadata?.interactionPriority ?? 99),
      Number(target.metadata?.interactionPriority ?? 99)
    ) <= 1;
    const architectureInactive = false;
    edgeContext.setLineDash(architectureLink ? [] : style === "dashed" ? [8, 6] : style === "dotted" ? [2, 6] : []);
    edgeContext.strokeStyle = architectureInactive
      ? "rgba(100, 116, 139, 0.22)"
      : architectureSelectedLink
        ? (target.metadata?.disabled ? "rgba(203, 213, 225, 0.96)" : target.agentType === "branch" ? "rgba(94, 234, 212, 0.98)" : "rgba(196, 181, 253, 0.98)")
      : architecturePrimaryLink
        ? "rgba(167, 139, 250, 0.8)"
      : upstream
        ? "rgba(245, 158, 11, 0.88)"
        : downstream
          ? "rgba(34, 197, 94, 0.88)"
          : "rgba(148, 163, 184, 0.48)";
    edgeContext.fillStyle = edgeContext.strokeStyle;
    edgeContext.lineWidth = architectureSelectedLink ? 4.2 : architecturePrimaryLink ? 1.35 : isContext || upstream || downstream ? 1.1 : 0.7;

    const endpoints = linkEndpoints(source, target);
    const dx = endpoints.targetX - endpoints.sourceX;
    const dy = endpoints.targetY - endpoints.sourceY;
    const curve = Math.min(84, Math.hypot(dx, dy) * 0.24);
    edgeContext.beginPath();
    edgeContext.moveTo(endpoints.sourceX, endpoints.sourceY);
    let targetControlX = endpoints.targetX - curve;
    let targetControlY = endpoints.targetY;
    if (source.metadata?.architectureLens && target.metadata?.architectureLens) {
      const direction = Math.sign(dx) || 1;
      const sourceControlX = endpoints.sourceX + direction * curve;
      targetControlX = endpoints.targetX - direction * curve;
      targetControlY = endpoints.targetY;
      edgeContext.bezierCurveTo(sourceControlX, endpoints.sourceY, targetControlX, targetControlY, endpoints.targetX, endpoints.targetY);
    } else {
      edgeContext.bezierCurveTo(endpoints.sourceX + curve, endpoints.sourceY, endpoints.targetX - curve, endpoints.targetY, endpoints.targetX, endpoints.targetY);
    }
    edgeContext.stroke();

    if (!isExploreArchitecture()) {
      const angle = Math.atan2(endpoints.targetY - targetControlY, endpoints.targetX - targetControlX);
      const arrowSize = 4.5 / Math.max(0.015, state.transform.k);
      edgeContext.beginPath();
      edgeContext.moveTo(endpoints.targetX, endpoints.targetY);
      edgeContext.lineTo(endpoints.targetX - Math.cos(angle - Math.PI / 6) * arrowSize, endpoints.targetY - Math.sin(angle - Math.PI / 6) * arrowSize);
      edgeContext.lineTo(endpoints.targetX - Math.cos(angle + Math.PI / 6) * arrowSize, endpoints.targetY - Math.sin(angle + Math.PI / 6) * arrowSize);
      edgeContext.closePath();
      edgeContext.fill();
    }
  }
  edgeContext.restore();
}

function sourceLinkIdsForVisualLink(link) {
  if (Array.isArray(link.sourceLinkIds) && link.sourceLinkIds.length) return link.sourceLinkIds;
  if (link.sourceLinkId) return [link.sourceLinkId];
  return link.id ? [link.id] : [];
}

function visualLinkMatchesNode(link, id, sourceLinkById) {
  if (!id) return false;
  if (nodeId(link.source) === id || nodeId(link.target) === id) return true;
  return sourceLinkIdsForVisualLink(link).some((linkId) => {
    const sourceLink = sourceLinkById.get(linkId);
    return sourceLink?.source === id || sourceLink?.target === id;
  });
}

function visualLinkMatchesFocus(link, focusLinkKeys, sourceLinkById) {
  const keyFor = (sourceLink) => `${nodeId(sourceLink.source)}->${nodeId(sourceLink.target)}:${sourceLink.type || "relationship"}`;
  if (focusLinkKeys.has(keyFor(link))) return true;
  return sourceLinkIdsForVisualLink(link).some((linkId) => {
    const sourceLink = sourceLinkById.get(linkId);
    return sourceLink && focusLinkKeys.has(keyFor(sourceLink));
  });
}

function visualRelationshipStyle(link, sourceLinkById) {
  const firstSourceLink = sourceLinkIdsForVisualLink(link)
    .map((linkId) => sourceLinkById.get(linkId))
    .find(Boolean);
  return relationshipStyle(firstSourceLink || link);
}

function visualLinkDescription(link, sourceLinkById) {
  const sourceLinkIds = sourceLinkIdsForVisualLink(link);
  const sourceLink = sourceLinkIds.map((linkId) => sourceLinkById.get(linkId)).find(Boolean);
  if (link.kind === "zone-rail") return link.metadata?.unresolvedEvidence
    ? `${link.label}. This rail retains unresolved branch evidence without assigning it to a guessed functionality.`
    : `${link.label}. ${sourceLinkIds.length} source-backed containment relationships share this zone rail.`;
  if (link.kind === "fanout-rail") return `${link.label}. Each child relationship remains available from its local stub.`;
  if (link.kind === "zone-stub" || link.kind === "fanout-stub") return `Source-backed relationship: ${sourceLink?.type || link.type || "architecture relationship"}.`;
  return `${visualRelationshipStyle(link, sourceLinkById).label}: ${sourceLink?.source || link.source} to ${sourceLink?.target || link.target}.`;
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
        .text((item) => `${item.inventory?.features || 0} features · ${item.inventory?.apis || 0} APIs · ${item.inventory?.dataStores || 0} data`);
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
    if (node.metadata?.architectureLens) {
      const radius = architectureNodeRadius(node);
      const iconSize = Math.max(24, Math.min(38, Math.round(radius * 0.48)));
      const labelY = radius + 18;
      const subtitleY = radius + 34;
      // Architecture is a single visual language: the graph communicates
      // hierarchy through forward flow, radius, icon, rim grammar, and status
      // rather than mixing folders, hexagons, and chevrons in one tree.
      group.append("circle").attr("class", "node-shape architecture-tree-shape").attr("r", radius);
      if (type === "project") {
        group.append("circle").attr("class", "architecture-node-rim architecture-project-rim").attr("r", Math.max(10, radius - 7));
      } else if (type === "subfunctionality") {
        group.append("circle").attr("class", "architecture-node-rim architecture-code-rim").attr("r", Math.max(9, radius - 5));
      } else if (type === "branch") {
        group.append("circle").attr("class", "architecture-node-rim architecture-branch-rim").attr("r", Math.max(12, radius - 5));
      }
      appendLucideIcon(group, node, { size: iconSize, x: -iconSize / 2, y: -iconSize / 2, className: "architecture-node-icon" });
      group.append("circle").attr("class", "node-status-halo").attr("cx", radius * 0.7).attr("cy", -radius * 0.68).attr("r", 10);
      group.append("text").attr("class", "node-status-text").attr("x", radius * 0.7).attr("y", -radius * 0.68 + 4).text(statusMark(node));
      group.append("text").attr("class", "node-label architecture-tree-label").attr("x", 0).attr("y", labelY).text(shortName(node.label, radius > 76 ? 24 : 18));
      group.append("text").attr("class", "node-subtitle architecture-tree-subtitle").attr("x", 0).attr("y", subtitleY).text(nodeSubtitle(node));
      return;
    }
    if (type === "project") {
      group.append("path").attr("class", "node-shape project-folder-shape").attr("d", "M-42,-24H-12L-4,-14H42Q50,-14 50,-6V28Q50,36 42,36H-42Q-50,36 -50,28V-16Q-50,-24 -42,-24Z");
    } else if (type === "orchestrator" || type === "system") {
      group.append("rect").attr("class", "node-shape").attr("x", -32).attr("y", -22).attr("width", 64).attr("height", 44).attr("rx", 8);
    } else if (type === "architectureCategory") {
      group.append("path").attr("class", "node-shape architecture-category-shape").attr("d", "M-52,-27L-26,-42H26L52,-27V27L26,42H-26L-52,27Z");
    } else if (type === "architectureBranchSummary" || type === "deadBranchSummary") {
      group.append("path").attr("class", "node-shape architecture-branch-summary-shape").attr("d", "M-104,-31H78L104,0L78,31H-104L-82,0Z");
    } else if (["functionality", "subfunctionality", "feature", "api"].includes(type)) {
      group.append("path").attr("class", "node-shape functionality-shape").attr("d", "M-30,-18L0,-34L30,-18L30,18L0,34L-30,18Z");
    } else if (["branch", "workflow", "promotion"].includes(type)) {
      group.append("path").attr("class", "node-shape branch-shape").attr("d", "M-31,-20H12L31,0L12,20H-31L-13,0Z");
    } else if (type === "qagent" || type === "milestone") {
      group.append("path").attr("class", "node-shape").attr("d", "M0,-31L31,0L0,31L-31,0Z");
    } else if (["reviewer", "validation", "approval-gate", "monetary-approval"].includes(type)) {
      group.append("path").attr("class", "node-shape").attr("d", "M0,-33L28,-21V0C28,19 15,31 0,38C-15,31 -28,19 -28,0V-21Z");
    } else if (type === "human") {
      group.append("circle").attr("class", "node-shape").attr("cy", -13).attr("r", 11);
      group.append("path").attr("class", "node-shape").attr("d", "M-27,31C-25,6 25,6 27,31Z");
    } else if (["memory", "knowledge", "research-budget"].includes(type)) {
      group.append("path").attr("class", "node-shape").attr("d", "M-32,-18C-32,-28 32,-28 32,-18V19C32,29 -32,29 -32,19ZM-32,-18C-32,-8 32,-8 32,-18M-32,1C-32,11 32,11 32,1");
    } else if (type === "service") {
      group.append("rect").attr("class", "node-shape service-shape").attr("x", -44).attr("y", -21).attr("width", 88).attr("height", 42).attr("rx", 21);
    } else if (["page", "investigation", "objective", "pattern", "proposal", "tool-plan"].includes(type)) {
      group.append("rect").attr("class", "node-shape panel-shape").attr("x", -35).attr("y", -25).attr("width", 70).attr("height", 50).attr("rx", 5);
      group.append("path").attr("class", "node-panel-rule").attr("d", "M-26,-12H26");
    } else {
      group.append("circle").attr("class", "node-shape").attr("r", 30);
    }
    appendLucideIcon(group, node);
    const summary = ["architectureCategory", "architectureBranchSummary", "deadBranchSummary"].includes(type);
    const wide = summary || type === "service";
    group.append("text").attr("class", "node-acronym").attr("text-anchor", "middle").attr("y", summary ? 27 : 26).text(acronymFor(node.label, summary ? 4 : 3));
    group.append("circle").attr("class", "node-status-halo").attr("cx", summary ? 91 : wide ? 39 : 25).attr("cy", summary ? -24 : -25).attr("r", 10);
    group.append("text").attr("class", "node-status-text").attr("x", summary ? 91 : wide ? 39 : 25).attr("y", summary ? -20 : -21).text(statusMark(node));
    group.append("text").attr("class", "node-label").attr("x", 0).attr("y", summary ? 58 : 48).text(shortName(node.label, summary ? 31 : wide ? 24 : 18));
    group.append("text").attr("class", "node-subtitle").attr("x", 0).attr("y", summary ? 73 : 63).text(nodeSubtitle(node));
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
    const value = node?.metadata?.[key] ?? node?.metadata?.metrics?.[key] ?? node?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function isAgentRecord(node) {
  return node?.type === "agent" || Boolean(node?.agent_id);
}

function isFunctionalityRecord(node) {
  return ["application_functionality", "application_subfunctionality", "page", "api", "database"].includes(node?.type)
    || ["functionality", "subfunctionality", "page", "api", "database"].includes(node?.agentType)
    || Boolean(node?.metadata?.applicationTopology);
}

function uniqueRelationshipRows(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.node?.id || ""}:${row.link?.type || ""}:${row.link?.source || ""}:${row.link?.target || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(row.node);
  });
}

function inspectorRelationships(model, node) {
  const { incoming, outgoing } = relationLists(model, node);
  const all = uniqueRelationshipRows([...incoming, ...outgoing]);
  const children = outgoing.filter((row) => isHierarchyLink(row.link) && isFunctionalityRecord(row.node));
  const parents = incoming.filter((row) => isHierarchyLink(row.link) && isFunctionalityRecord(row.node));
  const connectedAgents = uniqueRelationshipRows(all.filter((row) => isAgentRecord(row.node)));
  const services = uniqueRelationshipRows(all.filter((row) => ["api", "service", "database"].includes(nodeVisualType(row.node))));
  return { incoming, outgoing, children, parents, connectedAgents, services };
}

function efficiencyDetail(node) {
  const value = scoreValue(node, ["efficiencyScore", "efficiency"], null);
  if (value === null) return { value: "Efficiency not reported", context: "" };
  const source = scoreValue(node, ["efficiencySource", "telemetrySource", "source"], "");
  const freshness = scoreValue(node, ["efficiencyFreshness", "efficiencyUpdatedAt", "lastRunAt", "updatedAt"], "");
  const context = [source && `source: ${source}`, freshness && `updated: ${freshness}`].filter(Boolean).join(" · ");
  return { value: valueText(value), context };
}

function agentProfileLink(agent, label = "Open agent profile") {
  if (!isAgentRecord(agent)) return "";
  const href = agentProfileHref(agent, {
    agentName: agent.label || agent.name,
    agentType: agentLabel(agent),
    project: agent.project,
    domain: agent.domain || agent.capability,
    description: nodeDescription(agent)
  });
  return href ? `<a class="agent-profile-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>` : "";
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
  if (node.metadata?.architectureLens) {
    const functionalityRows = Array.isArray(node.metadata?.functionalityDetails) ? node.metadata.functionalityDetails : [];
    const assignedAgents = Array.isArray(node.metadata?.assignedAgents) ? node.metadata.assignedAgents : [];
    const branchRows = Array.isArray(node.metadata?.branchDetails) ? node.metadata.branchDetails : [];
    const { incoming, outgoing, children, parents, services } = inspectorRelationships(model, node);
    const efficiency = efficiencyDetail(node);
    const nodeType = node.agentType === "functionality"
      ? "Application functionality"
      : node.agentType === "branch"
        ? node.metadata?.disabled ? "Rejected / disabled branch" : "Architecture branch"
        : "Architecture entity";
    insightContentEl.innerHTML = `
      <div class="insight-heading architecture-insight-heading">
        <span>${escapeHtml(nodeType)}</span>
        <h2>${escapeHtml(node.label)}</h2>
        <p>${escapeHtml(nodeDescription(node))}</p>
        <div class="insight-badges">
          <b>${escapeHtml(runtimeStatusLabel(node))}</b>
          <b>${node.metadata?.functionalityCount || 0} functionality node${Number(node.metadata?.functionalityCount || 0) === 1 ? "" : "s"}</b>
          <b>${node.metadata?.branchCount || 0} branch record${Number(node.metadata?.branchCount || 0) === 1 ? "" : "s"}</b>
          <b>complexity ${Math.round(Number(node.metadata?.complexity || 0) * 100)}%</b>
        </div>
      </div>
      <section class="insight-section architecture-detail-list">
        <h3>Exact functionalities <small>${functionalityRows.length}</small></h3>
        ${functionalityRows.length ? `<ol>${functionalityRows.map((functionality) => `<li><i data-lucide="${objectiveIconFor({ metadata: { category: functionality.category }, label: functionality.label, type: "application_functionality" })}" aria-hidden="true"></i><div><strong>${escapeHtml(functionality.label)}</strong><small>${escapeHtml(functionality.id)} · ${escapeHtml(functionality.category)} · ${functionality.evidenceCount || 0} cited evidence</small><p>${escapeHtml(functionality.description)}</p></div></li>`).join("")}</ol>` : "<p>No active functionality node is attached to this evidence group.</p>"}
      </section>
      <section class="insight-section detail-grid">
        <h3>Functionality hierarchy</h3>
        <dl><div><dt>Parent functionality</dt><dd>${parents.length}</dd></div><div><dt>Child functionality</dt><dd>${children.length}</dd></div></dl>
      </section>
      ${children.length ? `<section class="insight-section connections"><h3>Child functionality <small>${children.length}</small></h3>${connectionButtons(children, "child")}</section>` : ""}
      ${parents.length ? `<section class="insight-section connections"><h3>Parent functionality <small>${parents.length}</small></h3>${connectionButtons(parents, "parent")}</section>` : ""}
      <section class="insight-section architecture-detail-list">
        <h3>Connected agents <small>${assignedAgents.length}</small></h3>
        ${assignedAgents.length ? `<ol class="architecture-agent-list">${assignedAgents.map((agent) => `<li><i data-lucide="bot" aria-hidden="true"></i><div><a class="agent-profile-link" href="${escapeHtml(agentProfileHref(agent, { agentName: agent.name, agentType: agent.role, project: node.project }))}" target="_blank" rel="noopener">${escapeHtml(agent.name)}</a><small>${escapeHtml(agent.role)}</small></div></li>`).join("")}</ol>` : "<p>No implementation agent is assigned in the current topology.</p>"}
      </section>
      <section class="insight-section connections"><h3>Connected APIs, services & data <small>${services.length}</small></h3>${services.length ? connectionButtons(services, "related") : "<p>No direct application dependency is recorded in this topology.</p>"}</section>
      <section class="insight-section connections"><h3>Relationship details <small>${incoming.length + outgoing.length}</small></h3><h4>Incoming</h4>${connectionButtons(incoming, "from")}<h4>Outgoing</h4>${connectionButtons(outgoing, "to")}</section>
      <section class="insight-section efficiency-telemetry"><h3>Efficiency & telemetry</h3><div class="score-row" aria-label="Operational scores"><div><span>Efficiency</span><strong>${escapeHtml(efficiency.value)}</strong>${efficiency.context ? `<small>${escapeHtml(efficiency.context)}</small>` : ""}</div></div></section>
      ${branchRows.length ? `<section class="insight-section architecture-detail-list"><h3>Branch records <small>${branchRows.length}</small></h3><ol>${branchRows.map((branch) => `<li class="${node.metadata?.disabled ? "is-disabled" : ""}"><i data-lucide="git-fork" aria-hidden="true"></i><div><strong>${escapeHtml(branch.label)}</strong><small>${escapeHtml(branch.id)} · ${escapeHtml(humanize(branch.status))} · ${branch.evidenceCount || 0} cited evidence</small></div></li>`).join("")}</ol></section>` : ""}`;
    lucide?.createIcons({ attrs: { "stroke-width": 2.2, width: 16, height: 16 } });
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
    const { incoming, outgoing, children, parents, connectedAgents, services } = inspectorRelationships(model, node);
    const executionRows = node.metadata?.recentExecutions || node.metadata?.executions || [];
    const issueRows = node.metadata?.errors || node.metadata?.warnings || [];
    const executions = Array.isArray(executionRows) ? executionRows : [];
    const errors = Array.isArray(issueRows) ? issueRows : [];
    const capabilityScore = scoreValue(node, ["capabilityScore", "capability"], "—");
    const reliabilityScore = scoreValue(node, ["reliabilityScore", "reliability"], "—");
    const accuracyScore = scoreValue(node, ["accuracyScore", "accuracy"], "—");
    const efficiency = efficiencyDetail(node);
    const currentTask = node.metadata?.currentTask || node.metadata?.task || "No active task reported";
    const issueSummary =
      Array.isArray(errors) && errors.length
        ? errors.map(valueText).join(" · ")
        : node.statusGroup === "failed"
          ? "Failure status reported; open logs for details."
          : "No errors or warnings reported.";
    const deliveryOrder = Number(node.metadata?.deliveryOrder || 0);
    const deliveryTimeline = deliveryOrder
      ? `<section class="insight-section detail-grid"><h3>Feature delivery timeline</h3><dl><div><dt>Sequence</dt><dd>Step ${deliveryOrder}</dd></div><div><dt>Phase</dt><dd>${escapeHtml(node.metadata?.deliveryPhase || "Dependency sequence")}</dd></div><div><dt>Basis</dt><dd>${escapeHtml(node.metadata?.timelineInferred ? `Inferred from observed dependencies${node.metadata?.projectOrigin === "imported" ? " (imported project)" : ""}` : node.metadata?.chronologyBasis || "Recorded")}</dd></div><div><dt>Confidence</dt><dd>${node.metadata?.timelineInferred ? `${Math.round(Number(node.metadata?.timelineConfidence || 0) * 100)}%` : "Recorded"}</dd></div></dl></section>`
      : "";
    const tabContent = {
      overview: `
        <section class="insight-section purpose-summary">
          <h3>Purpose & functional description</h3>
          <p>${escapeHtml(nodeDescription(node))}</p>
        </section>
        <section class="operational-callout">
          <span>Current task</span>
          <strong>${escapeHtml(currentTask)}</strong>
        </section>
        ${deliveryTimeline}
        <section class="insight-section detail-grid">
          <h3>Functionality hierarchy</h3>
          <dl>
            <div><dt>Parent functionality</dt><dd>${parents.length}</dd></div>
            <div><dt>Child functionality</dt><dd>${children.length}</dd></div>
          </dl>
        </section>
        ${children.length ? `<section class="insight-section connections"><h3>Child functionality <small>${children.length}</small></h3>${connectionButtons(children, "child")}</section>` : ""}
        ${parents.length ? `<section class="insight-section connections"><h3>Parent functionality <small>${parents.length}</small></h3>${connectionButtons(parents, "parent")}</section>` : ""}
        <section class="insight-section connections"><h3>Connected agents <small>${connectedAgents.length}</small></h3>${connectedAgents.length ? connectionButtons(connectedAgents, "agent") : "<p>No direct agent relationship is recorded in this topology.</p>"}</section>
        <section class="insight-section connections"><h3>Connected APIs, services & data <small>${services.length}</small></h3>${services.length ? connectionButtons(services, "related") : "<p>No direct application dependency is recorded in this topology.</p>"}</section>
        <section class="insight-section efficiency-telemetry">
          <h3>Efficiency & telemetry</h3>
          <div class="score-row" aria-label="Operational scores">
            <div><span>Efficiency</span><strong>${escapeHtml(efficiency.value)}</strong>${efficiency.context ? `<small>${escapeHtml(efficiency.context)}</small>` : ""}</div>
            <div><span>Capability</span><strong>${escapeHtml(capabilityScore)}</strong></div>
            <div><span>Reliability</span><strong>${escapeHtml(reliabilityScore)}</strong></div>
            <div><span>Accuracy</span><strong>${escapeHtml(accuracyScore)}</strong></div>
          </div>
        </section>
        <section class="insight-section detail-grid">
          <h3>Operational status</h3>
          <dl>
            <div><dt>Parent orchestrator</dt><dd>${escapeHtml(node.metadata?.parentOrchestrator || node.metadata?.orchestrator || node.cluster_id || "Not declared")}</dd></div>
            <div><dt>Lifecycle</dt><dd>${escapeHtml(humanize(node.metadata?.lifecycle || node.status || "unknown"))}</dd></div>
            <div><dt>Runtime status</dt><dd>${escapeHtml(runtimeStatusLabel(node))}</dd></div>
          </dl>
        </section>`,
      relationships: `
        <section class="insight-section connections"><h3>Incoming dependencies <small>${incoming.length}</small></h3>${connectionButtons(incoming, "from")}</section>
        <section class="insight-section connections"><h3>Outgoing dependencies <small>${outgoing.length}</small></h3>${connectionButtons(outgoing, "to")}</section>`,
      activity: `
        <section class="insight-section"><h3>Recent executions</h3><p>${escapeHtml(Array.isArray(executions) && executions.length ? executions.map(valueText).join(" · ") : "No recent executions reported in graph metadata.")}</p></section>
        <section class="insight-section"><h3>Errors & warnings</h3><p>${escapeHtml(issueSummary)}</p></section>`,
      configuration: `
        <section class="insight-section detail-grid">
          <h3>${isAgentRecord(node) ? "Agent configuration" : "Entity configuration"}</h3>
          <dl>
            <div><dt>Instruction version</dt><dd>${escapeHtml(node.metadata?.instructionVersion || node.metadata?.version || "Current")}</dd></div>
            <div><dt>Type</dt><dd>${escapeHtml(agentLabel(node))}</dd></div>
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
        ${agentProfileLink(node)}
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
      <div class="drawer-actions"><button type="button" id="open-logs">Open Logs</button>${isAgentRecord(node) ? `<button type="button" id="inspect-agent">Inspect agent in workspace</button>` : "<button type=\"button\" disabled>Agent profile unavailable</button>"}</div>`;
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
    .map(({ link, node }) => {
      const evidence = link.metadata?.evidence || link.evidence || [];
      const reference = Array.isArray(evidence) ? evidence.find((item) => item?.reference)?.reference : "";
      const detail = `${direction} · ${humanize(link.type)} · ${nodeTypeLabel(node)}${reference ? ` · ${reference}` : ""}`;
      const body = `<span>${escapeHtml(detail)}</span><strong>${escapeHtml(node.label)}</strong>`;
      if (isAgentRecord(node)) {
        const href = agentProfileHref(node, {
          agentName: node.label,
          agentType: agentLabel(node),
          project: node.project,
          domain: node.domain || node.capability,
          description: nodeDescription(node)
        });
        return `<a class="connection-agent-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">${body}</a>`;
      }
      return `<button type="button" data-node-id="${escapeHtml(node.id)}">${body}</button>`;
    })
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
  if (isExploreArchitecture()) window.requestAnimationFrame(() => fitSelection());
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
  selectionAnnouncementEl.textContent = item ? `${item.label} selected. ${state.viewMode === "dependency" ? "Complete reachable dependency chain shown." : "Related nodes highlighted."}` : "Selection updated.";
  render();
  window.requestAnimationFrame(() => fitSelection());
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

function nodeAccessibilityLabel(node, model) {
  const links = model?.links || [];
  const connected = links.filter((link) => link.source === node.id || link.target === node.id);
  const parentCount = links.filter((link) => link.target === node.id && isHierarchyLink(link)).length;
  const childCount = Number(node.metadata?.subfunctionalityCount ?? links.filter((link) => link.source === node.id && isHierarchyLink(link)).length);
  const lane = node.dependencyColumn
    ? `${humanize(node.dependencyColumn)} dependency lane`
    : node.exploreLane
      ? `${humanize(node.exploreLane)} role lane`
      : "topology canvas";
  return `${node.label}. Type: ${nodeTypeLabel(node)}. Status: ${runtimeStatusLabel(node)}. ${lane}. ${parentCount} parent and ${childCount} child functionality relationship${childCount === 1 ? "" : "s"}. ${connected.length} connected relationship${connected.length === 1 ? "" : "s"}.`;
}

function render() {
  const renderStartedAt = performance.now();
  const model = state.graph;
  if (!model) return;
  const fullVisible = visibleGraphForState(model, { ...state, storage: window.localStorage }, width, height, dagre);
  renderFlowFeatureControls(fullVisible.flow);
  if (state.viewMode === "dependency" && fullVisible.lens?.anchorId && !fullVisible.items.some((item) => item.id === state.selectedId)) {
    state.selectedId = fullVisible.lens.anchorId;
    state.inspectorTab = "overview";
    render();
    return;
  }
  const baselineStrategy = selectRenderStrategy({
    nodeCount: fullVisible.items.length,
    linkCount: fullVisible.links.length,
    lastFrameMs: state.renderMetrics.lastFrameMs
  });
  const completeTopologyView = ["explore", "dependency", "flow"].includes(state.viewMode);
  const strategy = completeTopologyView
    ? {
        ...baselineStrategy,
        mode: isExploreArchitecture() ? "force-canvas" : state.viewMode === "dependency" && fullVisible.links.length > 260 ? "hybrid-canvas" : "svg",
        progressive: false,
        canvasEdges: isExploreArchitecture() || (state.viewMode === "dependency" && fullVisible.links.length > 260),
        initialNodeLimit: fullVisible.items.length,
        batchSize: fullVisible.items.length
      }
    : baselineStrategy;
  const visible = applyProgressiveWindow(fullVisible, strategy);
  if (isExploreArchitecture()) runConstrainedArchitectureLayout(visible.items, visible.links);
  const nodeById = new Map(visible.items.map((item) => [item.id, item]));
  // Force Architecture uses every literal relationship directly. The retained
  // edge planner remains available to older non-force projections and tests,
  // but no longer bundles feature ancestry into category rails.
  let architectureEdgePlan = null;
  if (architectureEdgePlan) {
    const zoneById = new Map(architectureZonesFor(visible.items).map((zone) => [zone.id, zone]));
    architectureEdgePlan = {
      ...architectureEdgePlan,
      visualLinks: architectureEdgePlan.visualLinks.map((link) => link.zoneId && zoneById.has(link.zoneId)
        ? { ...link, zoneBounds: zoneById.get(link.zoneId) }
        : link)
    };
  }
  const renderLinks = architectureEdgePlan?.visualLinks || visible.links;
  const sourceLinkById = new Map((architectureEdgePlan?.sourceLinks || visible.links).map((link) => [link.id, link]));
  const focus = state.selectedId ? focusNeighborhood(model, state.selectedId) : null;
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
  const focusLinkKeys = new Set((focus?.links || []).map((link) => `${nodeId(link.source)}->${nodeId(link.target)}:${link.type || "relationship"}`));
  renderLensScaffold(visible.items);
  renderArchitectureScaffold(visible.items, architectureEdgePlan);

  if (!visible.items.length) {
    graphStateEl.className = "graph-state";
    graphStateEl.innerHTML =
      !state.filters.project
        ? `<strong>Select a project</strong><span>Choose one managed project from the Project menu to open its PlutoMix topology.</span>`
        : `<strong>No matching entities</strong><span>Adjust the active filters or clear them to restore this project's topology.</span><button type="button" id="graph-state-action">Clear filters</button>`;
    graphStateEl.hidden = false;
    graphStateEl.querySelector("#graph-state-action")?.addEventListener("click", () => {
      clearFilters();
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
    const link = linkLayer.selectAll("path.link").data(renderLinks, linkKey);
    link.exit().remove();
    link
      .enter()
      .append("path")
      .attr("class", "link")
      .merge(link)
      .attr("marker-end", (row) => {
        if (isExploreArchitecture()) return null;
        return "url(#arrow)";
      })
      .attr("class", (row) => `link relation-${visualRelationshipStyle(row, sourceLinkById).className} ${visualLinkMatchesFocus(row, focusLinkKeys, sourceLinkById) ? "focus-link" : ""}`)
      .classed("explore-link", () => isExploreArchitecture())
      .classed("dependency-link", () => state.viewMode === "dependency")
      .classed("functionality-flow-link", () => isFunctionalityFlow())
      .classed("ownership-link", (row) => isFunctionalityFlow() && String(row.type || "").toLowerCase() === "implements")
      .classed("context-link", (row) => visualLinkMatchesNode(row, state.selectedId, sourceLinkById))
      .classed("architecture-selected-link", (row) => isExploreArchitecture() && visualLinkMatchesNode(row, state.selectedId, sourceLinkById))
      .classed("architecture-zone-rail", (row) => row.kind === "zone-rail")
      .classed("architecture-zone-spine", (row) => row.kind === "zone-spine")
      .classed("architecture-zone-stub", (row) => row.kind === "zone-stub")
      .classed("architecture-fanout-rail", (row) => row.kind === "fanout-rail")
      .classed("architecture-fanout-spine", (row) => row.kind === "fanout-spine")
      .classed("architecture-fanout-stub", (row) => row.kind === "fanout-stub")
      .classed("architecture-local-tree", (row) => isExploreArchitecture() && row.kind === "local-tree")
      .classed("architecture-evidence-flow", (row) => isExploreArchitecture() && row.kind === "evidence-flow")
      .classed("dead-branch-link", (row) => Boolean(row.metadata?.disabled))
      .classed("architecture-inactive", false)
      .classed("muted", false)
      .classed("upstream", (row) => state.selectedId && visualLinkMatchesNode(row, state.selectedId, sourceLinkById) && nodeId(row.target) === state.selectedId)
      .classed("downstream", (row) => state.selectedId && visualLinkMatchesNode(row, state.selectedId, sourceLinkById) && nodeId(row.source) === state.selectedId)
      .attr("data-link-id", (row) => row.sourceLinkId || sourceLinkIdsForVisualLink(row).join(" "))
      .attr("data-member-link-ids", (row) => sourceLinkIdsForVisualLink(row).join(" "))
      .attr("aria-label", (row) => visualLinkDescription(row, sourceLinkById))
      .attr("d", (row) => linkPath(row, nodeById));
    linkLayer.selectAll("path.link").selectAll("title").data((row) => [row]).join("title").text((row) => visualLinkDescription(row, sourceLinkById));
  }

  const node = nodeLayer.selectAll("g.node").data(visible.items, (row) => row.id);
  node.exit().remove();
  const entered = node
    .enter()
    .append("g")
    .attr("class", "node")
    .attr("tabindex", -1)
    .attr("role", "button")
    .attr("aria-label", (row) => nodeAccessibilityLabel(row, model));
  entered.filter((row) => row.kind === "cluster").call(clusterCard);
  entered.filter((row) => row.kind !== "cluster").call(agentShape);

  const merged = entered.merge(node);
  merged
    .attr("class", (row) => `node ${row.kind === "cluster" ? "cluster-node" : "agent-node"} type-${visualType(row)} status-${row.statusGroup}`)
    .classed("project-node", (row) => row.clusterLevel === "project")
    .classed("orbit-anchor", (row) => Boolean(row.orbitAnchor))
    .classed("orbit-peripheral", (row) => Boolean(row.orbitParentId))
    .classed("dependency-focus", (row) => row.dependencyRole === "focus")
    .classed("dependency-shared", (row) => row.dependencyRole === "shared")
    .classed("dependency-upstream", (row) => row.dependencyRole === "upstream")
    .classed("dependency-downstream", (row) => row.dependencyRole === "downstream")
    .classed("project-exclusive-agent", (row) => row.metadata?.assignmentScope === "project-exclusive")
    .classed("shared-agent", (row) => row.metadata?.assignmentScope === "shared")
    .classed("architecture-observed", (row) => row.metadata?.bucket === "observed")
    .classed("architecture-deferred", (row) => row.metadata?.bucket === "candidate")
    .classed("architecture-disabled", (row) => Boolean(row.metadata?.disabled))
    .classed("architecture-future", (row) => Boolean(row.metadata?.futureEnhancement))
    .classed("selected", (row) => row.id === state.selectedId)
    .classed("architecture-inactive", false)
    .classed("focus-upstream", (row) => focus?.upstream?.has(row.id))
    .classed("focus-downstream", (row) => focus?.downstream?.has(row.id))
    .style("--node-color", (row) => nodeColor(row))
    .style("--status-color", (row) => statusPalette[row.statusGroup] || statusPalette.idle)
    .attr("transform", (row) => `translate(${row.x},${row.y})`)
    .attr("aria-label", (row) => nodeAccessibilityLabel(row, model))
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
      selectionAnnouncementEl.textContent = isExploreArchitecture()
        ? `${row.label} selected. Relationship type, evidence, and dependency details are open in Insight.`
        : `${row.label} selected. ${state.viewMode === "dependency" ? "Complete reachable dependency chain shown." : "Related nodes highlighted."}`;
      try {
        savePositions(window.localStorage, state.filters.project, state.viewMode, visible.items);
      } catch {
        statusEl.className = "warning";
      }
      render();
      window.requestAnimationFrame(() => fitSelection());
    })
    .on("dblclick", (event) => {
      // Selection renders synchronously; consuming the follow-up double click
      // prevents it being interpreted as a new drag/zoom gesture on a fresh
      // SVG node.
      event.preventDefault();
      event.stopPropagation();
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
          const constrained = constrainNodeDrag(row, event.x, event.y, visible.items);
          row.x = constrained.x;
          row.y = constrained.y;
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
          // Rebuild visual-only zone bounds after a drag so their open gates
          // and bundled rails continue to describe the saved node positions.
          if (isExploreArchitecture()) render();
        })
    );

  if (state.selectedId && selectedRenderable) renderDetails(model, selectedRenderable);
  else renderDetails(model, null);
  renderArchitecturePanel(selectedRenderable?.metadata?.architectureLens ? selectedRenderable : null);
  renderBreadcrumb(visible);
  drawMinimap(visible.items, visible.links);
  renderEntityList(visible.items);
  graphEl.dataset.zoomLevel = zoomLevel(state.currentZoom);
  graphEl.dataset.viewMode = state.viewMode;
  document.documentElement.dataset.viewMode = state.viewMode;
  graphEl.dataset.large = strategy.progressive ? "true" : "false";
  graphEl.dataset.renderEngine = strategy.mode;

  // Architecture coordinates have already been settled by the bounded D3
  // force pass before the Canvas edges and accessible SVG nodes are rendered.
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
  const navigationItems = state.viewMode === "dependency"
    ? items.slice().sort((left, right) => ({ upstream: 0, focus: 1, downstream: 2 }[left.dependencyColumn || left.dependencyRole] ?? 1) - ({ upstream: 0, focus: 1, downstream: 2 }[right.dependencyColumn || right.dependencyRole] ?? 1) || left.y - right.y || left.x - right.x)
    : state.viewMode === "explore"
      ? items.slice().sort((left, right) => left.y - right.y || left.x - right.x)
      : items;
  let target;
  if (key === "Home") target = navigationItems[0];
  else if (key === "End") target = navigationItems[navigationItems.length - 1];
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

function constrainNodeDrag(node, x, y, items = []) {
  // Dragging uses the same visual-bounds contract as initial layout. Nodes are
  // free to cross lanes, but their glyph, status dot, and labels stay clear.
  const candidate = { ...node, x, y };
  const clearance = 12;
  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;
    for (const peer of items) {
      if (!peer || peer.id === node.id) continue;
      const candidateBounds = layoutNodeBounds(candidate);
      const peerBounds = layoutNodeBounds(peer);
      let dx = candidate.x - peer.x;
      let dy = candidate.y - peer.y;
      if (!dx && !dy) {
        const seed = String(candidate.id).split("").reduce((total, character) => total + character.charCodeAt(0), 0);
        dx = seed % 2 ? 1 : -1;
        dy = seed % 3 ? 1 : -1;
      }
      const requiredX = candidateBounds.halfWidth + peerBounds.halfWidth + clearance;
      const requiredY = candidateBounds.halfHeight + peerBounds.halfHeight + clearance;
      const overlapX = requiredX - Math.abs(dx);
      const overlapY = requiredY - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      if (overlapX <= overlapY) candidate.x += (dx >= 0 ? 1 : -1) * (overlapX + 1);
      else candidate.y += (dy >= 0 ? 1 : -1) * (overlapY + 1);
      moved = true;
    }
    if (!moved) break;
  }
  return { x: candidate.x, y: candidate.y };
}

/**
 * A bounded force-directed layout lets recorded relationships and category
 * gravity form the architecture space. Saved user positions stay fixed;
 * chronology and hierarchy never become positional constraints.
 */
function architectureClusterGravity(strength = 0.1) {
  let nodes = [];
  let centerByCluster = new Map();
  const initialize = (nextNodes = []) => {
    nodes = nextNodes;
    const accumulators = new Map();
    for (const node of nodes) {
      const projectId = node.metadata?.projectId || node.project || "project";
      const zone = node.metadata?.architectureZone || node.type || "other";
      const key = `${projectId}:${zone}`;
      const current = accumulators.get(key) || { x: 0, y: 0, count: 0 };
      current.x += Number(node.targetX ?? node.x ?? 0);
      current.y += Number(node.targetY ?? node.y ?? 0);
      current.count += 1;
      accumulators.set(key, current);
      node.architectureGravityCluster = key;
    }
    centerByCluster = new Map([...accumulators].map(([key, value]) => [key, {
      x: value.x / Math.max(1, value.count),
      y: value.y / Math.max(1, value.count)
    }]));
  };
  const force = (alpha) => {
    for (const node of nodes) {
      if (node.fx != null || node.fy != null) continue;
      const center = centerByCluster.get(node.architectureGravityCluster);
      if (!center) continue;
      node.vx += (center.x - node.x) * strength * alpha;
      node.vy += (center.y - node.y) * strength * alpha;
    }
  };
  force.initialize = initialize;
  return force;
}

function runConstrainedArchitectureLayout(items, links) {
  const degree = new Map(items.map((item) => [item.id, 0]));
  links.forEach((link) => {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (degree.has(source)) degree.set(source, (degree.get(source) || 0) + 1);
    if (degree.has(target)) degree.set(target, (degree.get(target) || 0) + 1);
  });
  const nodes = items.map((item) => ({
    ...item,
    fx: item.saved ? item.x : null,
    fy: item.saved ? item.y : null
  }));
  const simNodeById = new Map(nodes.map((node) => [node.id, node]));
  const forceCenter = nodes.reduce((center, node) => ({ x: center.x + Number(node.x || 0), y: center.y + Number(node.y || 0) }), { x: 0, y: 0 });
  forceCenter.x /= Math.max(1, nodes.length);
  forceCenter.y /= Math.max(1, nodes.length);
  const simLinks = links
    .filter((link) => simNodeById.has(link.source) && simNodeById.has(link.target))
    .map((link) => ({ ...link }));
  const nodeForLink = (value) => typeof value === "object" ? value : simNodeById.get(value);
  const simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(simLinks)
        .id((node) => node.id)
        .distance((link) => {
          const source = nodeForLink(link.source);
          const target = nodeForLink(link.target);
          return architectureNodeRadius(source) + architectureNodeRadius(target) + (link.metadata?.hierarchy ? 105 : 150);
        })
        .strength((link) => {
          const source = nodeForLink(link.source);
          const target = nodeForLink(link.target);
          return link.metadata?.hierarchy ? 0.55 : String(link.type || "").includes("static_inferred") ? 0.08 : 0.24;
        })
    )
    .force("charge", d3.forceManyBody().strength((node) => -190 - architectureNodeRadius(node) * 5 - Math.min(10, degree.get(node.id) || 0) * 26))
    .force("clusterGravity", architectureClusterGravity(0.14))
    .force("collision", d3.forceCollide().radius((node) => Math.hypot(layoutNodeBounds(node).halfWidth, layoutNodeBounds(node).halfHeight) + 22).iterations(10))
    .force("center", d3.forceCenter(forceCenter.x, forceCenter.y).strength(0.035))
    .stop();
  const iterations = Math.max(96, Math.min(220, 80 + items.length * 2));
  for (let index = 0; index < iterations; index += 1) simulation.tick();
  const positionById = new Map(nodes.map((node) => [node.id, node]));
  items.forEach((item) => {
    const next = positionById.get(item.id);
    if (next) {
      item.x = next.x;
      item.y = next.y;
    }
  });
  return items;
}

function fitAfterPassiveUpdate() {
  fitSelection();
}

function fitItems(items, duration = 420) {
  if (!items?.length) return;
  const bounds = items.reduce(
    (acc, item) => {
      const { halfWidth, halfHeight } = layoutNodeBounds(item);
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
  // Explore architecture uses a dedicated feature inspector, so the canvas
  // can use its full rendered width.
  const reservedRight = isExploreArchitecture() ? 0 : width > 900 ? 212 : width > 560 ? 164 : 124;
  const availableWidth = Math.max(220, width - reservedRight);
  const fittedScale = Math.min(1.05, availableWidth / contentWidth, height / contentHeight);
  // Explore opens as a complete feature map, including its agent clusters.
  const scale = isExploreArchitecture() ? Math.max(0.015, fittedScale) : fittedScale;
  const x = availableWidth / 2 - scale * ((bounds.minX + bounds.maxX) / 2);
  const y = height / 2 - scale * ((bounds.minY + bounds.maxY) / 2);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  svg.transition().duration(reduceMotion ? 0 : duration).call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(scale));
}

function currentVisible() {
  return visibleGraphForState(state.graph, { ...state, storage: window.localStorage }, width, height, dagre);
}

function focusArchitectureRoot(items, duration = 420) {
  const root = items.find((item) => item.metadata?.architectureLens && (item.type === "project" || item.agentType === "project"));
  if (!root) return fitItems(items, duration);
  const availableWidth = Math.max(220, width);
  const scale = Math.min(0.76, Math.max(0.46, state.currentZoom || 0.62));
  const x = availableWidth / 2 - scale * root.x;
  const y = height / 2 - scale * root.y;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  svg.transition().duration(reduceMotion ? 0 : duration).call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(scale));
}

function fitSelection() {
  const visible = currentVisible();
  if (state.viewMode === "dependency") {
    fitItems(visible.items);
    return;
  }
  if (state.selectedId) {
    const architectureRoot = isExploreArchitecture()
      ? visible.items.find((item) => item.id === state.selectedId && (item.type === "project" || item.agentType === "project"))
      : null;
    if (architectureRoot) {
      fitItems(visible.items);
      return;
    }
    const focus = focusNeighborhood(state.graph, state.selectedId);
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
  } else if (isExploreArchitecture()) {
    fitItems(visible.items);
  } else {
    fitItems(visible.items);
  }
}

function resetView() {
  state.filters.search = "";
  state.filters.project = "";
  state.filters.agentType = "all";
  state.filters.status = "all";
  state.filters.relationshipType = "all";
  state.viewMode = "overview";
  state.selectedId = "";
  state.expandedClusters.clear();
  state.expandedSubfunctionalities.clear();
  setInspectorOpen(false, { fit: false });
  controls.search.value = "";
  controls.project.value = "";
  controls.agentType.value = "all";
  controls.status.value = "all";
  controls.relationshipType.value = "all";
  closeSearchResults();
  setActiveView("overview", { render: false });
  updateFilterCount();
  render();
  window.requestAnimationFrame(() => fitSelection());
}

function updateFilterCount() {
  const count = [
    Boolean(state.filters.project),
    state.filters.agentType !== "all",
    state.filters.status !== "all",
    state.filters.relationshipType !== "all"
  ].filter(Boolean).length;
  const countEl = document.getElementById("filter-count");
  countEl.textContent = String(count);
  countEl.hidden = count === 0;
}

function clearFilters() {
  resetProgressiveRender();
  state.filters.agentType = "all";
  state.filters.status = "all";
  state.filters.relationshipType = "all";
  controls.agentType.value = "all";
  controls.status.value = "all";
  controls.relationshipType.value = "all";
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
    if (requestedProject && !state.filters.project && state.graph.nodes.some((node) => node.project === requestedProject)) {
      state.filters.project = requestedProject;
    }
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
    state.flowMajorFeatureId = "";
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
  flowFeatureSelectEl?.addEventListener("change", () => selectFlowMajorFeature(flowFeatureSelectEl.value));
  flowFeaturePreviousEl?.addEventListener("click", () => {
    const options = Array.from(flowFeatureSelectEl?.options || []);
    const currentIndex = options.findIndex((option) => option.value === state.flowMajorFeatureId);
    selectFlowMajorFeature(options[currentIndex - 1]?.value);
  });
  flowFeatureNextEl?.addEventListener("click", () => {
    const options = Array.from(flowFeatureSelectEl?.options || []);
    const currentIndex = options.findIndex((option) => option.value === state.flowMajorFeatureId);
    selectFlowMajorFeature(options[currentIndex + 1]?.value);
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
  document.getElementById("zoom-out").addEventListener("click", () => svg.transition().duration(180).call(zoom.scaleBy, 0.68));
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
setActiveView(requestedView, { render: false });
refreshGraph();
