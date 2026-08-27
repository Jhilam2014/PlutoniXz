import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import * as d3 from "d3";
import {
  Activity,
  Bot,
  Bell,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Cloud,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Film,
  FlaskConical,
  FolderUp,
  Gauge,
  GitBranch,
  GripVertical,
  Hammer,
  LockKeyhole,
  Loader2,
  Maximize2,
  Monitor,
  MonitorSmartphone,
  Music2,
  Moon,
  MousePointer2,
  Network,
  PanelRight,
  Palette,
  Pause,
  Play,
  Plus,
  Presentation,
  RefreshCcw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Save,
  Settings2,
  Sun,
  Smartphone,
  Square,
  Sigma,
  Tablet,
  Trash2,
  Upload,
  UserRound,
  X,
  XCircle
} from "lucide-react";
import CloudHostingPage from "./pages/CloudHostingPage.jsx";
import StudioPage from "./pages/StudioPage.jsx";
import GovernedPromotionPanel from "./GovernedPromotionPanel.jsx";
import PlutonixAnalysisWorkspace from "./PlutonixAnalysisWorkspace.jsx";
import GothamStudio from "./gotham-studio/GothamStudio.jsx";
import { authFetch, clearUser, getStoredUser, storeDevelopmentUser, storeUser } from "./authClient.js";
import {
  agentGlyphMarkup,
  agentIconKind as sharedAgentIconKind,
  agentVisualFromId as sharedAgentVisualFromId,
  agentVisualFromRecord as sharedAgentVisualFromRecord
} from "./agentAvatarVisual.js";
import {
  functionalityNodeInsights,
  layoutFunctionalityGraph,
  normalizeFunctionalityGraph
} from "./functionalityGraphModel.js";
import {
  buildDecisionBranchLandscape,
  buildDecisionObjectiveLedger,
  buildDecisionTimelineFlow,
  decisionBranchLineageIds,
  decisionBranchProjectionState,
  decisionBranchReviewSignal,
  decisionBranchStateLabel,
  decisionBranchWorkshopSummary,
  isDisabledDecisionBranch
} from "./decisionBranchTreeModel.js";
import { applicationDecisionSummary } from "./plutonixAnalysisModel.js";
import { runtimeEventTranscript } from "./runtimeEventTranscript.js";
import { authorizedStudioWorkspace, normalizedStudioWorkspace } from "./studioAccessModel.js";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";
const GENERATED_SITE_URL = import.meta.env.VITE_GENERATED_SITE_URL || "http://localhost:5174";
const MAX_RUNTIME_LOG_ROWS = 400;
const NOTIFICATION_RETENTION_MS = 24 * 60 * 60 * 1000;
const SYSTEM_TARGET_VALUE = "__agentic_plutonix_system__";
const GOTHAM_CHAT_MIN_WIDTH = 440;
const GOTHAM_CHAT_MAX_WIDTH = 860;
const MAX_INSTRUCTION_CHARS = 50000;
const DEVELOPMENT_AUTH_ENABLED = import.meta.env.VITE_PLUTONIX_DEV_AUTH_ENABLED === "true";

function mediaReferenceIds(items = []) {
  if (!Array.isArray(items)) return [];
  return [...new Set(items
    .map((item) => (typeof item === "string" ? item : item?.id))
    .map((id) => String(id || "").trim())
    .filter(Boolean))];
}

function suppliedDataRecord(values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || value === null || value === undefined) return [];
    return [[normalizedKey, typeof value === "string" ? value : String(value)]];
  }));
}

function readWorkspaceDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const agent = params.get("agent")?.trim() || "";
  const logs = params.get("logs")?.trim() || "";
  const requestedWorkspace = params.get("workspace")?.trim() || "";
  const agentName = params.get("agentName")?.trim() || "";
  const agentType = params.get("agentType")?.trim() || "Agent";
  const project = params.get("project")?.trim() || "Agentic System";
  const description = params.get("description")?.trim() || "";
  const studioJob = params.get("studioJob")?.trim() || "";
  return {
    agent,
    logs,
    agentContext: agent
      ? {
          id: agent,
          name: agentName || agent,
          project,
          role: agentType,
          domain: params.get("domain")?.trim() || "agent operations",
          objective: description,
          instructionSummary: description,
          capabilities: [agentType],
          vector: { status: "pending", source: "agentic-system-topology" },
          sourcePath: "Agentic System topology",
          efficiency: {}
        }
      : null,
    studioJob,
    workspace: normalizedStudioWorkspace(agent ? "agents" : logs ? "builder" : requestedWorkspace)
  };
}

const starterPrompt = "";
const taskTypeOptions = [
  { id: "Simple", label: "Simple", tone: "simple" },
  { id: "Medium", label: "Medium", tone: "medium" },
  { id: "Large", label: "Large", tone: "large" }
];
const gothamWorkflowModes = [
  { id: "planner", label: "Planner", icon: GitBranch, detail: "Plan approach only; no file changes." },
  { id: "debugger", label: "Debugger", icon: Search, detail: "Diagnose and fix reported issues." },
  { id: "executor", label: "Execution", icon: Code2, detail: "Implement the requested coding change." }
];
const gothamIntelConfig = {
  minExpansionScore: 72
};
const activityFilters = [
  { id: "all", label: "All" },
  { id: "instructions", label: "Instructions" },
  { id: "codex", label: "Gotham status" },
  { id: "runtime", label: "Runtime" },
  { id: "errors", label: "Errors" }
];
const themeOptions = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor }
];
const devicePresets = [
  { id: "phone", label: "Phone", icon: Smartphone, width: 390, height: 844 },
  { id: "tablet", label: "Tablet", icon: Tablet, width: 820, height: 1180 },
  { id: "laptop", label: "Laptop", icon: MonitorSmartphone, width: 1280, height: 800 },
  { id: "desktop", label: "Desktop", icon: Monitor, width: 1440, height: 900 }
];
const investorCountryOptions = [
  { id: "india", label: "India" },
  { id: "united-states", label: "United States" },
  { id: "singapore", label: "Singapore" },
  { id: "united-kingdom", label: "United Kingdom" },
  { id: "germany", label: "Germany" },
  { id: "canada", label: "Canada" },
  { id: "israel", label: "Israel" },
  { id: "france", label: "France" },
  { id: "australia", label: "Australia" }
];
const colorPalettes = [
  { name: "Trusted Finance", colors: ["#112E81", "#4647AE", "#4382DF", "#AACCD6"], url: "https://colorhunt.co/palette/112e814647ae4382dfaaccd6", keywords: ["finance", "bank", "investment", "insurance", "legal", "enterprise", "trust"] },
  { name: "Clinical Teal", colors: ["#0A2947", "#F3E4C9", "#D3D4C0", "#8B5E3C"], url: "https://colorhunt.co/palette/0a2947f3e4c9d3d4c08b5e3c", keywords: ["health", "medical", "clinic", "wellness", "care", "hospital"] },
  { name: "Sustainable Growth", colors: ["#9CB080", "#618764", "#2B5748", "#273338"], url: "https://colorhunt.co/palette/9cb0806187642b5748273338", keywords: ["green", "eco", "sustainable", "agriculture", "environment", "organic", "nature"] },
  { name: "SaaS Momentum", colors: ["#293681", "#4274D9", "#95CCD0", "#DDE7E6"], url: "https://colorhunt.co/palette/2936814274d995ccddd0e7e6", keywords: ["saas", "software", "technology", "platform", "dashboard", "developer", "cloud", "ai"] },
  { name: "Commerce Energy", colors: ["#FF6A1C", "#FFDA62", "#FFAE56", "#F5788B"], url: "https://colorhunt.co/palette/ff6a1cffda62ffae56f5788b", keywords: ["commerce", "shop", "store", "retail", "marketplace", "sale", "fashion"] },
  { name: "Luxury Editorial", colors: ["#000000", "#233D4D", "#FE7F2D", "#EAECF0"], url: "https://colorhunt.co/palette/000000233d4dfe7f2deaecf0", keywords: ["luxury", "premium", "editorial", "portfolio", "architecture", "automotive"] },
  { name: "Media Studio", colors: ["#4B1426", "#17433F", "#558467", "#EFEABB"], url: "https://colorhunt.co/palette/4b142617433f558467efeabb", keywords: ["media", "audio", "video", "music", "film", "creative", "studio"] },
  { name: "Education Spark", colors: ["#FFBF00", "#FFF78D", "#467235", "#283F24"], url: "https://colorhunt.co/palette/ffbf00fff78d467235283f24", keywords: ["education", "school", "learning", "student", "course", "children"] },
  { name: "Hospitality Warmth", colors: ["#FFCA95", "#FF7873", "#E22F80", "#8140DC"], url: "https://colorhunt.co/palette/ffca95ff7873e22f808140dc", keywords: ["food", "restaurant", "travel", "hotel", "hospitality", "event", "beauty"] },
  { name: "Calm Service", colors: ["#607456", "#EEE0CC", "#BA6A4C", "#7B2525"], url: "https://colorhunt.co/palette/607456eee0ccba6a4c7b2525", keywords: ["consulting", "service", "professional", "local business", "home", "interior"] },
  { name: "Future Violet", colors: ["#1B4EF5", "#3874FF", "#5996FF", "#F4CEFF"], url: "https://colorhunt.co/palette/1b4ef53874ff5996fff4ceff", keywords: ["startup", "innovation", "future", "crypto", "web3", "automation"] },
  { name: "Bold Campaign", colors: ["#FF9E20", "#215E61", "#1D2128", "#F4F2F2"], url: "https://colorhunt.co/palette/ff9e20215e611d2128f4f2f2", keywords: ["marketing", "campaign", "agency", "sports", "community", "nonprofit"] },
  { name: "Navy Glass", colors: ["#0B2447", "#19376D", "#576CBC", "#A5D7E8"], url: "https://colorhunt.co/palette/0b244719376d576cbca5d7e8", keywords: [] }
];

function recommendBrandPalette(context = "") {
  const normalized = String(context || "").toLowerCase();
  const scored = colorPalettes.map((palette, index) => {
    const matches = (palette.keywords || []).filter((keyword) => normalized.includes(keyword));
    return { palette, score: matches.length, matches, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const winner = scored[0]?.score ? scored[0] : { palette: colorPalettes.at(-1), score: 0, matches: [] };
  return {
    ...winner.palette,
    recommended: true,
    reason: winner.matches.length
      ? `Recommended for ${winner.matches.join(", ")}.`
      : "Recommended as a versatile professional default."
  };
}
const agentVisuals = {
  "plutonix-fullstack-agent": { color: "#334155", accent: "#38bdf8", label: "Fullstack", initials: "PX" },
  "plutonix-independent-reviewer": { color: "#581c87", accent: "#e879f9", label: "Reviewer", initials: "PR" },
  "project-execution-agent": { color: "#0f766e", accent: "#22c55e", label: "Execution", initials: "PX" },
  "human-controller": { color: "#7f1d1d", accent: "#fb7185", label: "Human", initials: "HC" },
  "agent-memory-sync": { color: "#4c1d95", accent: "#a78bfa", label: "Memory", initials: "AM" },
  "geofinderx-orchestrator-agent": { color: "#7c3aed", accent: "#2dd4bf", label: "Orchestrator", initials: "GO" },
  "geofinderx-ui-composition-agent": { color: "#2563eb", accent: "#93c5fd", label: "UI", initials: "GU" },
  "geofinderx-content-data-agent": { color: "#d97706", accent: "#facc15", label: "Content", initials: "GC" },
  "geofinderx-runtime-packaging-agent": { color: "#0f766e", accent: "#5eead4", label: "Runtime", initials: "GR" },
  "geofinderx-local-execution-agent": { color: "#0f766e", accent: "#86efac", label: "Execution", initials: "GX" },
  "mapex-orchestrator-agent": { color: "#7c3aed", accent: "#c4b5fd", label: "Orchestrator", initials: "MO" },
  "mapex-ui-composition-agent": { color: "#2563eb", accent: "#60a5fa", label: "UI", initials: "MU" },
  "mapex-content-data-agent": { color: "#d97706", accent: "#fbbf24", label: "Content", initials: "MC" },
  "mapex-runtime-packaging-agent": { color: "#0f766e", accent: "#2dd4bf", label: "Runtime", initials: "MR" },
  "mapex-commerce-catalog-agent": { color: "#be123c", accent: "#fb7185", label: "Commerce", initials: "MS" },
  "instagram-ocr": { color: "#be185d", accent: "#f9a8d4", label: "OCR", initials: "IO" },
  "rtt-signal-analysis": { color: "#1d4ed8", accent: "#67e8f9", label: "Signal", initials: "RS" },
  "whatsapp-auto-reply": { color: "#15803d", accent: "#86efac", label: "Reply", initials: "WA" },
  "voice-assist": { color: "#0369a1", accent: "#7dd3fc", label: "Voice", initials: "VA" }
};
const defaultProjectFlowNodes = [
  { id: "intake", label: "Instruction intake", state: "pending", detail: "Waiting for project creation." },
  { id: "path-selection", label: "What-next path selection", state: "pending", detail: "Choose the strongest development route." },
  { id: "project-local-orchestrator", label: "Project-local orchestrator", state: "selected", detail: "Agents, Docker scaffold, memory, and Gotham handoff." },
  { id: "template-only", label: "Template-only generation", state: "disabled", detail: "Available but not selected for managed projects." },
  { id: "human-choice-review", label: "Human Agent choice", state: "disabled", detail: "Used when the correct path is unclear." },
  { id: "gotham-generation", label: "Gotham generation", state: "pending", detail: "Generate project files." },
  { id: "runtime-handoff", label: "Runtime handoff", state: "pending", detail: "Assign preview and preserve standalone Docker path." }
];
const defaultSubObjectiveFlow = [
  { id: "requirements", label: "Requirements", state: "completed", detail: "Instruction and docs" },
  { id: "feature-coverage", label: "Feature coverage", state: "selected", detail: "Direct and indirect needs" },
  { id: "architecture", label: "Architecture", state: "pending", detail: "Data, UI, runtime" },
  { id: "generation", label: "Generation", state: "pending", detail: "Gotham file work" },
  { id: "validation", label: "Validation", state: "pending", detail: "Preview and handoff" }
];
const techStackNodes = [
  { id: "frontend", label: "Frontend", x: 132, y: 58, color: "#2563eb", icon: MonitorSmartphone },
  { id: "backend", label: "Backend", x: 132, y: 170, color: "#0f766e", icon: Server },
  { id: "database", label: "Database", x: 588, y: 58, color: "#d97706", icon: Database },
  { id: "cloud", label: "Cloud services", x: 588, y: 170, color: "#7c3aed", icon: Cloud },
  { id: "services", label: "AI / Integrations", x: 360, y: 204, color: "#be123c", icon: Bot }
];

const techStackNodeById = new Map(techStackNodes.map((node) => [node.id, node]));

function stackText(items) {
  return items.filter(Boolean).slice(0, 3).join(" / ");
}

function serviceFlowSteps(snapshot) {
  const categories = snapshot.categories || [];
  const byId = new Map(categories.map((category) => [category.id, category]));
  return ["frontend", "backend", "database", "services", "cloud"].map((id, index) => {
    const category = byId.get(id) || { id, label: displayEventType(id), items: [], state: "planned" };
    return {
      ...category,
      order: index + 1,
      insight:
        id === "frontend"
          ? "User-facing screens, generated pages, responsive CSS, and playground preview surface."
          : id === "backend"
            ? "PlutoniX API, project orchestration, Gotham workflow handoff, and runtime project controls."
            : id === "database"
              ? "Project metadata, generated app data, vector memory records, and graph artifacts used for reasoning."
              : id === "services"
                ? "AI workflow, QAgentic review, OAuth/media inputs, and external service integration points."
                : "Docker runtime, preview port assignment, generated-site hosting, and cloud deployment path."
    };
  });
}

function buildTechStackSnapshot({ project, lastBuild, flowPath, generatedStatus }) {
  const projectName = flowPath?.projectName || project?.name || "No project selected";
  const files = Array.isArray(lastBuild?.files) ? lastBuild.files.map((file) => file.path || file).filter(Boolean) : [];
  const hasJsx = files.some((file) => /\.jsx?$/i.test(file));
  const hasCss = files.some((file) => /\.css$/i.test(file));
  const hasData = files.some((file) => /catalogData|metadata|\.json$/i.test(file));
  const isProject = Boolean(project && !project.isDefault);
  const isRunning = flowPath?.status === "running" || generatedStatus === "working";
  const progress = isRunning
    ? 58
    : flowPath?.status === "failed"
      ? 36
      : lastBuild?.buildId || project
        ? 100
        : 0;
  const buildKey = lastBuild?.buildId || project?.updatedAt || project?.id || "no-build";
  const snapshotTime = lastBuild?.createdAt || project?.updatedAt || new Date().toISOString();
  return {
    key: [
      project?.id || "none",
      buildKey,
      flowPath?.status || "idle",
      flowPath?.selectedPath || "no-path",
      generatedStatus
    ].join(":"),
    projectId: project?.id || "",
    buildKey,
    createdAt: snapshotTime,
    projectName,
    buildId: lastBuild?.buildId || "",
    progress,
    status: flowPath?.status || (project ? "ready" : "idle"),
    categories: [
      {
        id: "frontend",
        label: "Frontend",
        items: ["React", "Vite", hasCss ? "Generated CSS" : "Responsive UI", hasJsx ? "Generated pages" : ""],
        state: hasJsx || project ? "active" : "planned"
      },
      {
        id: "backend",
        label: "Backend",
        items: ["Node.js", "Express API", isProject ? "Project orchestrator" : "PlutoniX generator"],
        state: project ? "active" : "planned"
      },
      {
        id: "database",
        label: "Database",
        items: [hasData ? "Generated metadata" : "Project metadata", "Vector memory", "Neo4j graph artifacts"],
        state: hasData || flowPath ? "active" : "planned"
      },
      {
        id: "cloud",
        label: "Cloud services",
        items: [isProject ? `Preview port ${project.port || "pending"}` : "Generated-site container", "Docker runtime", "Cloud hosting path"],
        state: project ? "active" : "planned"
      },
      {
        id: "services",
        label: "AI / Integrations",
        items: ["Gotham workflow", "QAgentic support", "OAuth / media inputs"],
        state: flowPath || lastBuild ? "active" : "planned"
      }
    ]
  };
}

function gothamChatFlowPath({ projectName, taskType, useProjectOrchestrator, workflowMode = "executor" }) {
  const modeLabel = gothamWorkflowModes.find((mode) => mode.id === workflowMode)?.label || "Execution";
  const selectedPath = useProjectOrchestrator ? "project-local-orchestrator" : "template-only";
  return {
    status: "running",
    selectedPath,
    confidence: 68,
    deterministic: true,
    projectName: projectName || "PlutoniX default workspace",
    taskType,
    workflowMode,
    summary: `PlutoniX is executing deterministic path selection for this Gotham ${modeLabel} instruction.`,
    humanInLoop: { required: false, reason: "", choices: [] },
    subObjectives: defaultSubObjectiveFlow.map((node) => ({
      ...node,
      state: node.id === "requirements" || node.id === "feature-coverage" ? "completed" : node.id === "generation" ? "selected" : "pending"
    })),
    nodes: defaultProjectFlowNodes.map((node) => ({
      ...node,
      state:
        node.id === "intake" || node.id === "path-selection"
          ? "completed"
          : node.id === selectedPath
            ? "selected"
            : node.id === "human-choice-review"
              ? "disabled"
              : "pending",
      detail:
        node.id === "intake"
          ? `Gotham ${modeLabel} instruction captured as ${taskType || "Medium"} task.`
          : node.id === "path-selection"
            ? "Choosing the strongest route before Gotham generation."
            : node.detail
    })),
    rejectedPaths: [
      {
        id: useProjectOrchestrator ? "template-only" : "project-local-orchestrator",
        reason: useProjectOrchestrator
          ? "Project-local orchestration is required for the selected project."
          : "No project-local target is selected for this instruction."
      }
    ],
    nextRecommendation: workflowMode === "planner" ? "Review the plan, then switch to Execution or Debugger when ready." : "Wait for Gotham generation to finish, then review the selected path evidence."
  };
}

function gothamSystemFlowPath({ taskType, workflowMode = "executor" }) {
  const modeLabel = gothamWorkflowModes.find((mode) => mode.id === workflowMode)?.label || "Execution";
  return {
    status: "running",
    selectedPath: "plutonix-system-improvement",
    confidence: 90,
    deterministic: true,
    projectName: "PlutoniX System",
    taskType,
    workflowMode,
    summary: `Gotham ${modeLabel} is targeting the PlutoniX platform itself. A proposal must be created before implementation.`,
    target: { type: "system", systemId: "plutonix" },
    subObjectives: [
      { id: "observe", label: "Observe", state: "completed", detail: "Capture bounded system-improvement signal." },
      { id: "proposal", label: "Proposal", state: "selected", detail: "Create ImprovementProposal before code changes." },
      { id: "candidate", label: "Candidate", state: "pending", detail: "Isolated candidate only." },
      { id: "review", label: "Review", state: "pending", detail: "Independent review required." },
      { id: "promotion", label: "Promotion", state: "pending", detail: "Sandbox mode stages changes." }
    ],
    nodes: [
      { id: "system-target", label: "PlutoniX System", state: "selected", detail: "Platform repository and orchestration system." },
      { id: "proposal-required", label: "ImprovementProposal", state: "selected", detail: "Required before modification." },
      { id: "project-target", label: "Generated project", state: "rejected", detail: "Not selected for this instruction." }
    ],
    rejectedPaths: [
      { id: "managed-project-target", reason: "This instruction targets the PlutoniX platform, not a generated app." },
      { id: "live-source-rewrite", reason: "Self-improvement must pass proposal, isolation, validation, review, and rollback gates." }
    ],
    nextRecommendation: "Wait for proposal/candidate status, then review Self-Improvement history."
  };
}

const istTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata"
});

function formatIstTime(value = new Date()) {
  return `${istTimeFormatter.format(new Date(value))} IST`;
}

function formatElapsedTime(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "";
  const totalSeconds = Math.max(1, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function StatusPill({ status }) {
  const tone = status === "online" ? "online" : status === "working" ? "working" : "offline";
  return <span className={`status-pill ${tone}`}>{status}</span>;
}

function gothamText(value) {
  return String(value ?? "")
    .replaceAll("Codex", "Gotham")
    .replaceAll("codex", "gotham");
}

function displayEventType(value) {
  return gothamText(value).replaceAll(/[_-]/g, " ");
}

function uiReferenceLabel(reference) {
  if (!reference) return "";
  const raw = reference.label || reference.id || reference.tag || "UI reference";
  const compact = String(raw).replace(/\s+/g, " ").trim();
  return compact.length > 34 ? `${compact.slice(0, 31)}…` : compact;
}

function uiReferenceKey(reference) {
  if (!reference) return "";
  return [
    reference.id || "",
    reference.tag || "",
    reference.label || "",
    reference.classes || ""
  ].join("|");
}

function uiReferenceAcronym(reference) {
  const tag = String(reference?.tag || "UI").replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (tag) return tag.slice(0, 4);
  return "UI";
}

function instructionEditorValue(element) {
  if (!element) return "";
  const readNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.dataset?.uiReferenceKey) return "";
    if (node.nodeName === "BR") return "\n";
    const content = [...node.childNodes].map(readNode).join("");
    return /^(DIV|P)$/i.test(node.nodeName) ? `${content}\n` : content;
  };
  return [...element.childNodes].map(readNode).join("").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function uiReferenceInstruction(reference) {
  if (!reference) return "";
  const parts = [
    `id:${reference.id || "unknown"}`,
    `tag:${reference.tag || "unknown"}`,
    reference.label ? `label:${JSON.stringify(reference.label)}` : "",
    reference.classes ? `classes:${JSON.stringify(reference.classes)}` : ""
  ].filter(Boolean);
  return `UI reference selected from playground: [${parts.join(", ")}].`;
}

function uiReferencesInstruction(references) {
  const rows = Array.isArray(references) ? references.filter(Boolean) : [];
  if (!rows.length) return "";
  return rows.map((reference, index) => {
    const details = uiReferenceInstruction(reference).replace(/^UI reference selected from playground:\s*/i, "");
    return `UI reference ${index + 1} selected from playground: ${details}`;
  }).join("\n");
}

function cleanNodeLabel(value, fallback = "functionality") {
  const label = String(value || fallback).replace(/\s+/g, " ").trim();
  return label.length > 96 ? `${label.slice(0, 93)}...` : label;
}

function specificUiReferenceLabel(reference) {
  const label = cleanNodeLabel(reference?.label || reference?.id || reference?.tag || "");
  const tag = String(reference?.tag || "").trim().toLowerCase();
  if (label && label.toLowerCase() !== "ui reference") return label;
  return tag ? `${tag} element` : "";
}

function isGenericWorkflowLabel(value) {
  return /^(instruction intake|what-next path selection|project-local orchestrator|template-only generation|human agent choice|gotham generation|runtime handoff|requirements|feature coverage|architecture|generation|validation|workflow|functionality|project functionality|recorded project functionality|no project-specific execution recorded|waiting for project creation)$/i.test(
    String(value || "").trim()
  );
}

function displayNameFromPath(filePath = "") {
  const normalized = String(filePath || "").split(/[\\/]/).pop() || "";
  const withoutExt = normalized.replace(/\.[a-z0-9]+$/i, "");
  const spaced = withoutExt
    .replace(/Page$/i, " page")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return cleanNodeLabel(spaced);
}

function projectInstructionHistoryContext(entries = []) {
  const seen = new Set();
  const history = [...entries]
    .filter((entry) => entry?.instruction)
    .sort((left, right) => new Date(left.recordedAt || 0) - new Date(right.recordedAt || 0))
    .filter((entry) => {
      const key = `${String(entry.instruction).trim().toLowerCase()}|${entry.parentWorkflowId || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const completed = history.filter((entry) => /succeeded|completed|repaired/i.test(String(entry.status || "")));
  const unresolved = history.filter((entry) => /failed|blocked|rejected|error/i.test(`${entry.status || ""} ${entry.error || ""}`));
  const recentObjectives = history
    .slice(-4)
    .map((entry) => String(entry.instruction || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((instruction) => instruction.length > 110 ? `${instruction.slice(0, 107)}…` : instruction);
  const genesisObjective = String(history[0]?.instruction || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  const preserveCompactLayout = history.some((entry) =>
    /compact|smaller|reduce.*(?:font|icon|spacing)|(?:font|icon|spacing).*?(?:smaller|reduce)/i.test(String(entry.instruction || ""))
  );
  return { history, completed, unresolved, recentObjectives, genesisObjective, preserveCompactLayout };
}

function buildWorkflowNextInstructionSuggestion({ flowPath, projectId = "", selectedReferences = [], intelEnabled = false, instructionHistory = [], branding = null } = {}) {
  if (!flowPath) {
    return {
      status: "idle",
      title: "Workflow suggestion",
      summary: "Select or create a project to analyze its functionality nodes.",
      nodes: [],
      instruction: ""
    };
  }
  const graph = normalizeFunctionalityGraph(flowPath, projectId);
  const historyContext = projectInstructionHistoryContext(instructionHistory);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter((node) => node.type !== "project") : [];
  const specificNodes = nodes.filter((node) => !isGenericWorkflowLabel(node.label) && !isGenericWorkflowLabel(node.detail));
  const byParent = new Map();
  specificNodes.forEach((node) => {
    if (!node.parentId) return;
    byParent.set(node.parentId, [...(byParent.get(node.parentId) || []), node]);
  });
  const weakStates = new Set(["pending", "failed", "blocked", "fallback", "needs_credentials", "out_of_scope"]);
  const weakNodes = specificNodes
    .filter((node) => weakStates.has(String(node.state || "").toLowerCase()))
    .sort((left, right) => {
      const rank = { failed: 0, blocked: 1, needs_credentials: 2, fallback: 3, pending: 4, out_of_scope: 5 };
      return (rank[String(left.state || "").toLowerCase()] ?? 9) - (rank[String(right.state || "").toLowerCase()] ?? 9);
    });
  const sparseFunctionalities = specificNodes.filter((node) => node.type === "functionality" && !(byParent.get(node.id) || []).length);
  const changedNodes = specificNodes.filter((node) => /created|updated/i.test(String(node.changeKind || "")));
  const targets = [...weakNodes, ...sparseFunctionalities, ...changedNodes, ...nodes]
    .filter((node) => node?.id && !isGenericWorkflowLabel(node.label))
    .filter((node, index, rows) => rows.findIndex((item) => item.id === node.id) === index)
    .slice(0, 4);
  const targetLabels = targets.map((node) => cleanNodeLabel(node.label));
  const uiReferences = selectedReferences.map(specificUiReferenceLabel).filter(Boolean).slice(0, 4);
  const actionTargets = (flowPath.featureActions || [])
    .map((item) => cleanNodeLabel(item.label || item.reason || item.target || ""))
    .filter((label) => label && !isGenericWorkflowLabel(label))
    .slice(0, 3);
  const uiFiles = (flowPath.changedFiles || [])
    .map((file) => (typeof file === "string" ? file : file?.path || ""))
    .filter((file) => /src\/generated\/(?:pages\/)?[^/]+\.(jsx|tsx|css)$/i.test(file))
    .map(displayNameFromPath)
    .filter((label) => label && !isGenericWorkflowLabel(label))
    .slice(0, 3);
  const evidence = [...uiReferences, ...targetLabels, ...actionTargets, ...uiFiles]
    .filter((label, index, rows) => label && rows.findIndex((item) => item.toLowerCase() === label.toLowerCase()) === index)
    .slice(0, 5);
  const scopeNodes = targets
    .map((node) => node.id ? `\`${node.id}\`` : cleanNodeLabel(node.label))
    .filter(Boolean)
    .slice(0, 3);
  const scopeFiles = [...new Set([
    ...(flowPath.changedFiles || [])
      .map((file) => typeof file === "string" ? file : file?.path || "")
      .filter((file) => /^(src\/|graph\/)/i.test(file)),
    "graph/agent-functionality-map.json"
  ])].slice(0, 5);
  const primaryScope = scopeNodes[0] || "the unresolved primary workflow";
  const originalObjective = historyContext.genesisObjective || `the original ${graph.projectName || "project"} objective`;
  const brandingLine = branding?.colors?.length
    ? `${branding.name || "Current"} branding (${branding.colors.join(", ")})`
    : "current PlutoniX branding (#753FD9, #171321, #FFFFFF)";
  const instruction = evidence.length
    ? [
        `Continue the existing ${graph.projectName || flowPath.projectName || "project"} implementation. Inspect the current code and project documentation before editing. Preserve completed work and address only unresolved or incomplete functionality.`,
        "",
        "Goal:",
        `- Complete or extend ${primaryScope} in service of the original objective: ${originalObjective}.`,
        "",
        "Context:",
        `- Review ${historyContext.history.length} unique project instruction${historyContext.history.length === 1 ? "" : "s"} from genesis; use completed work as a boundary and unresolved or failed outcomes as evidence.`,
        `- Keep the current ${historyContext.preserveCompactLayout ? "compact font, icon sizing, and spacing, plus " : "layout and "}${brandingLine}.`,
        `- Relevant evidence: ${evidence.join(", ")}.`,
        "",
        "Scope:",
        `- ${scopeNodes.length ? scopeNodes.join(", ") : primaryScope}.`,
        ...scopeFiles.map((file) => `- \`${file}\`.`),
        `- Existing ${graph.projectName || "project"} interactions only; do not add unrelated features.`,
        "",
        "Constraints:",
        "- Do not create duplicate controls or redo already-completed visual changes. Focus only on unresolved gaps or failed outcomes indicated by history.",
        "- Do not mark a node `implemented` unless its behavior works end to end. If a backend or credential is unavailable, provide a clearly labeled usable fallback and use the corresponding status.",
        `- ${intelEnabled ? `Use Intel only through its selected profile and backend-scored proposals (threshold ${gothamIntelConfig.minExpansionScore}); do not add unrelated functionality.` : "Do not add unrelated functionality."}`,
        "",
        "Requirements:",
        "1. For every relevant UI element and functionality node, implement and verify click, keyboard/input, and navigation behavior; client-side or API-backed state; frontend/backend request and response contracts; input validation; and loading, empty, success, and error states.",
        "2. Update `graph/agent-functionality-map.json` so every relevant UI node maps to its functionality and has exactly one status: `implemented`, `fallback`, `needs_credentials`, or `out_of_scope`.",
        "3. Run the relevant tests, lint, type checks, and build. Fix regressions caused by this change.",
        "",
        "Done when:",
        `- All existing controls in ${primaryScope} perform their intended actions.`,
        "- The unresolved primary workflow works end to end or has an explicit, usable fallback.",
        "- Every relevant functionality-map node has an accurate status.",
        "- Loading, empty, validation, success, and failure scenarios are visible and usable.",
        "- The application builds successfully and relevant checks pass.",
        "",
        "At completion, summarize:",
        "- files changed;",
        "- behaviors implemented;",
        "- fallback or credential-dependent items;",
        "- verification commands and results."
      ].join("\n")
    : "";
  return {
    status: evidence.length ? "ready" : "empty",
    title: evidence.length ? "Suggested next instruction" : "Needs UI/function evidence",
    summary: evidence.length
      ? `${specificNodes.length} specific node${specificNodes.length === 1 ? "" : "s"} analyzed from ${historyContext.history.length} prior instruction${historyContext.history.length === 1 ? "" : "s"}${uiReferences.length ? `, ${uiReferences.length} selected UI reference${uiReferences.length === 1 ? "" : "s"}` : ""}.`
      : "No concrete UI element or app-specific functionality node is available yet. Select a UI reference or run an app instruction first.",
    nodes: evidence,
    instruction
  };
}

function agentIdFromProjectName(projectName) {
  const slug = String(projectName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-orchestrator-agent` : "";
}

function initialsFor(value) {
  const words = String(value || "Agent")
    .replace(/agent$/i, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || "AG").toUpperCase();
}

function stableAgentHash(value = "agent") {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const generatedAgentPalettes = [
  ["#1d4ed8", "#67e8f9"], ["#7c3aed", "#f0abfc"], ["#0f766e", "#5eead4"],
  ["#b45309", "#fde047"], ["#be123c", "#fda4af"], ["#0369a1", "#7dd3fc"],
  ["#4d7c0f", "#bef264"], ["#9f1239", "#f9a8d4"], ["#4338ca", "#a5b4fc"]
];

function agentVisualFromId(agentId, fallback = {}) {
  return sharedAgentVisualFromId(agentId, fallback);
}

function agentVisualFromRecord(agent) {
  return sharedAgentVisualFromRecord(agent);
}

function agentVisualFromEvent(event, selectedProject = null) {
  if (event?.role === "user") {
    return { id: "user", name: "You", label: "Human", initials: "YU", color: "#0f766e", accent: "#5eead4" };
  }
  const promptTarget = String(event?.promptTarget || "");
  const explicitId = promptTarget.includes(".orchestrator-agent")
    ? agentIdFromProjectName(promptTarget.replace(/\.orchestrator-agent$/, ""))
    : promptTarget;
  const projectAgentId = selectedProject && !selectedProject.isDefault ? agentIdFromProjectName(selectedProject.name) : "";
  const builderStages = [
    "request-received", "plutonix-start", "adaptive-route-selected", "orchestrator-prompt", "orchestrated",
    "file-plan", "file-plan-item", "plutonix-delegation", "plutonix-validation", "plutonix-complete",
    "plutonix-retry", "runtime-refresh-requested", "project-runtime-handoff", "generated", "hot-reload", "restarted",
    "project-create-start", "project-instruction-start", "project-agents-created", "project-created",
    "project-runtime-ready", "project-create-preserved", "project-create-failed", "error"
  ];
  const reviewerStages = ["review-start", "review-complete", "review-retry"];
  const executorStages = ["delegation-start", "delegation-complete", "generating", "codex-start", "codex-progress", "codex-complete", "files-applied"];
  const inferredId =
    event?.reviewerAgentId ||
    event?.agentId ||
    explicitId ||
    (reviewerStages.includes(event?.type) ? "plutonix-independent-reviewer" : "") ||
    (builderStages.includes(event?.type) ? "plutonix-fullstack-agent" : "") ||
    (executorStages.includes(event?.type) ? projectAgentId || "project-execution-agent" : "") ||
    (event?.type === "project-orchestrator-direct" || event?.type === "child-project-handoff" ? projectAgentId : "") ||
    "project-execution-agent";
  return agentVisualFromId(inferredId, {
    name: inferredId === "project-execution-agent" ? "Project Execution Agent" : displayEventType(inferredId),
    role: "Agent"
  });
}

function agentIconKind(avatar = {}) {
  return sharedAgentIconKind(avatar);
}

function LegacyAgentGlyph({ kind }) {
  if (kind === "reviewer") {
    return <g className="agent-glyph"><path d="M20 19h19l7 7-15 20-15-20 4-7Z" /><path d="M24 31l5 5 11-13" /><circle cx="44" cy="19" r="4" /></g>;
  }
  if (kind === "security") {
    return <g className="agent-glyph"><path d="M32 16l14 6v10c0 9-6 15-14 18-8-3-14-9-14-18V22l14-6Z" /><path d="M26 32l4 4 9-10" /></g>;
  }
  if (kind === "testing") {
    return <g className="agent-glyph"><path d="M25 17h14M28 17v9L19 43c-2 4 1 7 5 7h16c4 0 7-3 5-7L36 26v-9" /><path d="M23 39h18M27 34l3 3 7-7" /></g>;
  }
  if (kind === "memory") {
    return <g className="agent-glyph"><path d="M24 19c-7 1-10 8-6 13-4 6 0 13 7 13 3 5 11 4 12-2 7 1 11-7 7-12 3-7-4-14-11-11-2-3-7-3-9-1Z" /><path d="M25 27h14M25 34h14M28 41h8" /></g>;
  }
  if (kind === "api") {
    return <g className="agent-glyph"><path d="M22 22h20v20H22z" /><path d="M16 27h6M16 37h6M42 27h6M42 37h6M27 16v6M37 16v6M27 42v6M37 42v6" /><path d="M27 34l4-4 6 6" /></g>;
  }
  if (kind === "content") {
    return <g className="agent-glyph"><path d="M20 18h17l7 7v22H20V18Z" /><path d="M37 18v8h7M25 31h14M25 37h14M25 43h9" /></g>;
  }
  if (kind === "voice") {
    return <g className="agent-glyph"><rect x="27" y="16" width="10" height="24" rx="5" /><path d="M21 32c0 7 4 12 11 12s11-5 11-12M32 44v6M25 50h14" /></g>;
  }
  if (kind === "geo") {
    return <g className="agent-glyph"><path d="M32 49s13-12 13-22a13 13 0 1 0-26 0c0 10 13 22 13 22Z" /><circle cx="32" cy="27" r="5" /></g>;
  }
  if (kind === "ui") {
    return (
      <g className="agent-glyph">
        <rect x="19" y="21" width="26" height="22" rx="4" />
        <path d="M24 28h8M25 36l-5-4 5-4M39 28l5 4-5 4M31 38l4-12" />
      </g>
    );
  }
  if (kind === "data") {
    return (
      <g className="agent-glyph">
        <ellipse cx="32" cy="21" rx="12" ry="5" />
        <path d="M20 21v18c0 3 5 5 12 5s12-2 12-5V21M20 30c0 3 5 5 12 5s12-2 12-5" />
        <path d="M43 40l4 4M47 44h4M47 44v4" />
      </g>
    );
  }
  if (kind === "runtime") {
    return (
      <g className="agent-glyph">
        <path d="M22 23h20l4 8-14 12-14-12 4-8Z" />
        <path d="M22 23l10 8 10-8M32 31v12" />
        <circle cx="22" cy="44" r="3" />
        <circle cx="42" cy="44" r="3" />
        <path d="M25 44h14" />
      </g>
    );
  }
  if (kind === "human") {
    return (
      <g className="agent-glyph">
        <circle cx="32" cy="24" r="7" />
        <path d="M19 45c3-8 8-12 13-12s10 4 13 12" />
        <path d="M20 24h-4M48 24h-4M18 34l-3 3M46 34l3 3" />
      </g>
    );
  }
  if (kind === "qagent") {
    return (
      <g className="agent-glyph">
        <circle cx="30" cy="30" r="12" />
        <path d="M38 38l7 7M25 29l4 4 9-10" />
        <path d="M18 18l4 4M42 18l-4 4" />
      </g>
    );
  }
  if (kind === "commerce") {
    return (
      <g className="agent-glyph">
        <path d="M20 26h25l-3 16H23l-3-16Z" />
        <path d="M25 26c1-6 4-9 8-9s7 3 8 9" />
        <circle cx="27" cy="46" r="2" />
        <circle cx="39" cy="46" r="2" />
      </g>
    );
  }
  if (kind === "analytics") {
    return (
      <g className="agent-glyph">
        <path d="M19 44h27M23 44V34M32 44V26M41 44V30" />
        <path d="M21 30l9-7 7 5 8-10" />
        <circle cx="30" cy="23" r="2" />
        <circle cx="37" cy="28" r="2" />
        <circle cx="45" cy="18" r="2" />
      </g>
    );
  }
  if (kind === "orchestrator") {
    return (
      <g className="agent-glyph">
        <path d="M32 18l10 6v11l-10 6-10-6V24l10-6Z" />
        <path d="M32 18v8M22 24l10 8 10-8M32 32v9" />
        <path d="M22 35l-7 6M42 35l7 6M22 24l-7-5M42 24l7-5" />
        <circle cx="15" cy="19" r="3" />
        <circle cx="49" cy="19" r="3" />
        <circle cx="15" cy="41" r="3" />
        <circle cx="49" cy="41" r="3" />
        <circle cx="32" cy="32" r="3.5" />
      </g>
    );
  }
  return (
    <g className="agent-glyph">
      <path d="M22 24l10-6 10 6v12l-10 6-10-6V24Z" />
      <path d="M22 24l10 6 10-6M32 30v12" />
      <circle cx="22" cy="44" r="3" />
      <circle cx="42" cy="44" r="3" />
      <circle cx="32" cy="48" r="3" />
      <path d="M24 43l6-4M40 43l-6-4M32 45v-4" />
    </g>
  );
}

function AgentGlyph({ kind }) {
  return <g className="agent-glyph" dangerouslySetInnerHTML={{ __html: agentGlyphMarkup(kind) }} />;
}

function AgentAvatar({ visual, size = "medium", className = "" }) {
  const avatar = visual || agentVisualFromId("project-execution-agent");
  const label = `${avatar.name} profile image`;
  const instanceId = useId().replace(/:/g, "-");
  const safeId = `${String(avatar.id || "agent").replace(/[^a-zA-Z0-9_-]/g, "-")}-${instanceId}`;
  const kind = agentIconKind(avatar);
  return (
    <span
      className={`agent-avatar ${size} ${className} kind-${kind} variant-${avatar.variant || 0}`}
      style={{ "--agent-color": avatar.color, "--agent-accent": avatar.accent }}
      title={label}
      aria-label={label}
      role="img"
    >
      <svg viewBox="0 0 64 64" focusable="false" aria-hidden="true">
        <defs>
          <radialGradient id={`avatar-${safeId}-core`} cx="50%" cy="48%" r="58%">
            <stop stopColor="var(--agent-accent)" stopOpacity="0.42" />
            <stop offset="0.55" stopColor="var(--agent-color)" stopOpacity="0.3" />
            <stop offset="1" stopColor="#050b18" />
          </radialGradient>
          <linearGradient id={`avatar-${safeId}-ring`} x1="12" x2="52" y1="8" y2="56" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--agent-accent)" />
            <stop offset="1" stopColor="var(--agent-color)" />
          </linearGradient>
          <filter id={`avatar-${safeId}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="agent-avatar-shell" x="3.5" y="3.5" width="57" height="57" rx="18" />
        <circle className="agent-avatar-core" cx="32" cy="32" r="24" fill={`url(#avatar-${safeId}-core)`} />
        <circle className="agent-avatar-orbit outer" cx="32" cy="32" r="25" />
        <circle className="agent-avatar-orbit inner" cx="32" cy="32" r="18" />
        <path className="agent-avatar-link" d="M16 32h9M39 32h9M32 16v9M32 39v9" />
        <circle className="agent-avatar-node" cx="16" cy="32" r="2.1" />
        <circle className="agent-avatar-node" cx="48" cy="32" r="2.1" />
        <circle className="agent-avatar-node" cx="32" cy="16" r="2.1" />
        <circle className="agent-avatar-node" cx="32" cy="48" r="2.1" />
        <circle className="agent-avatar-ring" cx="32" cy="32" r="16" filter={`url(#avatar-${safeId}-glow)`} />
        <AgentGlyph kind={kind} />
        <text className="agent-avatar-monogram" x="49" y="53" textAnchor="middle">{String(avatar.initials || "AG").slice(0, 2)}</text>
      </svg>
    </span>
  );
}

function EventRow({ event, sessionStartedAt, selectedProject, onOpenStudio }) {
  const [expanded, setExpanded] = useState(false);
  const isCurrentSession = sessionStartedAt && new Date(event.createdAt || 0).getTime() >= sessionStartedAt;
  const isPromptEvent = ["instruction", "orchestrator-prompt"].includes(event.type);
  const visual = agentVisualFromEvent(event, selectedProject);
  const runtimeDetail = [
    event.failureClass,
    event.requestedModel ? `Requested: ${event.requestedModel}` : null,
    event.fallbackModel ? `Fallback: ${event.fallbackModel}` : null,
    event.codexVersion ? `CLI: ${event.codexVersion}` : null,
    event.upgradeAction
  ].filter(Boolean).join(" · ");
  const sandboxFailure = event.failureClass === "workspace_sandbox_unavailable" || event.sandboxPreflight?.failureClass === "workspace_sandbox_unavailable";
  const sandboxDiagnostic = event.sandboxPreflight?.diagnostic || event.diagnostic || "";
  const sandboxRemediation = event.sandboxPreflight?.remediation || event.remediation || "";
  const { inputLog, responseLog, statusLog } = runtimeEventTranscript(event);
  const eventMetadata = Object.fromEntries(Object.entries({
    agentId: event.agentId,
    projectId: event.projectId,
    projectName: event.projectName,
    buildId: event.buildId,
    parentWorkflowId: event.parentWorkflowId,
    taskType: event.taskType,
    workflowMode: event.workflowMode,
    stage: event.stage,
    status: event.status,
    changedFiles: event.changedFiles,
    tokenUsage: event.tokenUsage,
    failureClass: event.failureClass,
    studioJobId: event.studioJobId,
    studioPipelineId: event.studioPipelineId
  }).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  return (
    <li
      className={`event-row ${isCurrentSession ? "current-session" : ""} ${event.progressGroup ? "codex-progress-row" : ""} ${expanded ? "expanded" : ""}`}
      onClick={() => setExpanded(true)}
      role="button"
      tabIndex="0"
      aria-expanded={expanded}
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
          keyboardEvent.preventDefault();
          setExpanded(true);
        }
      }}
    >
      <AgentAvatar visual={visual} size="tiny" />
      <div>
        <strong>{displayEventType(event.type)} · {visual.name}</strong>
        {isPromptEvent ? <pre>{gothamText(event.message)}</pre> : <p>{gothamText(event.message)}</p>}
        {event.progressGroup ? (
          <>
            <span className="event-progress-track" />
            <span className="event-progress-label">{event.repeatCount} Gotham progress updates grouped</span>
          </>
        ) : null}
        {event.promptTarget || event.taskType ? (
          <small className="event-detail">
            {[event.promptTarget, event.taskType ? `Task Type: ${event.taskType}` : null, event.workflowMode ? `Gotham: ${displayEventType(event.workflowMode)}` : null].filter(Boolean).join(" · ")}
          </small>
        ) : null}
        {runtimeDetail ? <small className="event-detail">{runtimeDetail}</small> : null}
        {sandboxFailure ? (
          <aside className="sandbox-unavailable-notice" aria-label="Sandbox unavailable">
            <strong>Sandbox unavailable</strong>
            <span>Gotham kept the selected route, but secure execution was not attempted. Automatic repair was skipped because this is an environment failure.</span>
            {event.reason ? <small>Reason: {gothamText(event.reason)}</small> : null}
            {sandboxDiagnostic ? <small>Diagnostic: {gothamText(sandboxDiagnostic)}</small> : null}
            {sandboxRemediation ? <small>Administrator remediation: {gothamText(sandboxRemediation)}</small> : null}
          </aside>
        ) : null}
        {expanded ? (
          <section className="agent-log-detail" aria-label={`Agent details for ${visual.name}`} onClick={(clickEvent) => clickEvent.stopPropagation()}>
            <header>
              <strong>{inputLog || responseLog ? "Agent request and response" : "Execution event"}</strong>
              <button type="button" onClick={() => setExpanded(false)} aria-label="Collapse agent log details" title="Collapse details"><X size={14} /></button>
            </header>
            {inputLog ? <div>
              <span>Input</span>
              <pre>{gothamText(inputLog)}</pre>
            </div> : null}
            {responseLog ? <div>
              <span>Response</span>
              <pre>{gothamText(responseLog)}</pre>
            </div> : null}
            {statusLog ? <div>
              <span>{inputLog || responseLog ? "Execution status" : "Failure"}</span>
              <pre>{gothamText(statusLog)}</pre>
            </div> : null}
            {event.activityThread?.length ? (
              <div>
                <span>Related updates</span>
                <ol>{[event, ...event.activityThread].map((item) => <li key={item.id || `${item.type}-${item.createdAt}`}>{gothamText(item.message)}</li>)}</ol>
              </div>
            ) : null}
            {Object.keys(eventMetadata).length ? (
              <div>
                <span>Execution details</span>
                <pre>{JSON.stringify(eventMetadata, null, 2)}</pre>
              </div>
            ) : null}
            {event.studioJobId ? <button type="button" onClick={() => onOpenStudio?.(event.studioJobId)}>Open in Gotham Studio</button> : null}
          </section>
        ) : null}
      </div>
      <time>{formatIstTime(event.createdAt)}</time>
    </li>
  );
}

function ChatMessage({ event, selectedProject }) {
  const detailParts = [
    event.stage,
    event.path,
    event.taskType ? `Task Type: ${event.taskType}` : null,
    event.workflowMode ? `Gotham: ${displayEventType(event.workflowMode)}` : null,
    event.buildId ? `build ${String(event.buildId).replace("build_", "")}` : null
  ].filter(Boolean);
  const isUser = event.role === "user";
  const isCurrentSession = event.currentSession;
  const visual = agentVisualFromEvent(event, selectedProject);
  const thread = event.activityThread || [];
  return (
    <li className={`chat-message ${isUser ? "user-message" : "codex-message"} ${isCurrentSession ? "current-session" : ""} ${event.type || ""}`}>
      <div className="chat-avatar">
        {isUser ? <UserRound size={15} /> : <AgentAvatar visual={visual} size="tiny" />}
      </div>
      <div className="chat-bubble">
        <div className="chat-meta">
          <strong>{isUser ? "You" : visual.name}</strong>
          <time>{formatIstTime(event.createdAt)}</time>
        </div>
        <p>{gothamText(event.message)}</p>
        {thread.length ? (
          <div className="chat-activity-thread">
            <span>{thread.length + 1} related {displayEventType(event.activityThreadType || event.type)} updates</span>
            <ol>
              {[event, ...thread].slice(0, 5).map((item) => (
                <li key={item.id || `${item.type}-${item.createdAt}`}>
                  <time>{formatIstTime(item.createdAt)}</time>
                  <span>{gothamText(item.message)}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {!isUser ? <small>{visual.label}</small> : null}
        {detailParts.length ? <small>{detailParts.join(" · ")}</small> : null}
      </div>
    </li>
  );
}

function normalizeRuntimeRows(rows) {
  const seen = new Set();
  return rows
    .filter(Boolean)
    .map((row) => ({
      ...row,
      createdAt: row.createdAt || new Date().toISOString(),
      time: formatIstTime(row.createdAt || Date.now())
    }))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .filter((row) => {
      const key = row.id || `${row.createdAt}-${row.type}-${row.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_RUNTIME_LOG_ROWS);
}

function mergeRuntimeRows(nextRows, currentRows = []) {
  return normalizeRuntimeRows([...(nextRows || []), ...currentRows]);
}

function markCurrentSession(rows, sessionStartedAt) {
  if (!sessionStartedAt) return rows;
  return rows.map((row) => ({
    ...row,
    currentSession: new Date(row.createdAt || 0).getTime() >= sessionStartedAt
  }));
}

function collapseCodexProgressRows(rows) {
  const collapsed = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.type !== "codex-progress" || rows[index + 1]?.type !== "codex-progress") {
      collapsed.push(row);
      continue;
    }

    let repeatCount = 1;
    while (rows[index + repeatCount]?.type === "codex-progress") {
      repeatCount += 1;
    }
    collapsed.push({
      ...row,
      id: `codex-progress-group-${row.id || row.createdAt}`,
      message: "Gotham is working...",
      progressGroup: true,
      repeatCount
    });
    index += repeatCount - 1;
  }
  return collapsed;
}

function activityThreadType(event) {
  if (event.role === "user") return "";
  if (event.type === "codex-progress") return "gotham-progress";
  if (event.type === "file-plan-item") return "file-plan-item";
  if (["request-received", "orchestrated", "generating", "codex-start", "codex-complete", "files-applied", "generated"].includes(event.type)) {
    return "workflow-status";
  }
  if (String(event.type || "").startsWith("project-")) return "project-status";
  return event.type || "";
}

function collapseAgentActivityThreads(rows, selectedProject) {
  const collapsed = [];
  for (const row of rows) {
    const threadType = activityThreadType(row);
    const visual = agentVisualFromEvent(row, selectedProject);
    const buildId = row.buildId || "";
    const previous = collapsed.at(-1);
    const previousThreadType = activityThreadType(previous || {});
    const previousVisual = previous ? agentVisualFromEvent(previous, selectedProject) : null;
    const secondsApart = previous
      ? Math.abs(new Date(previous.createdAt || 0).getTime() - new Date(row.createdAt || 0).getTime()) / 1000
      : Infinity;
    const sameThread =
      threadType &&
      previousThreadType === threadType &&
      previousVisual?.id === visual.id &&
      (previous?.buildId || "") === buildId &&
      secondsApart <= 180;

    if (sameThread) {
      previous.activityThread = [...(previous.activityThread || []), row];
      previous.activityThreadType = threadType;
      continue;
    }
    collapsed.push(row);
  }
  return collapsed;
}

function activityCategory(event) {
  if (["instruction", "orchestrator-prompt", "project-instruction-start", "project-orchestrator-direct", "child-project-handoff"].includes(event.type)) {
    return "instructions";
  }
  if (String(event.type || "").startsWith("codex") || ["request-received", "orchestrated", "file-plan", "file-plan-item", "generating", "files-applied"].includes(event.type)) {
    return "codex";
  }
  if (["generated", "hot-reload", "restarted", "runtime-refresh-requested", "project-runtime-ready", "project-selected", "project-runtime-handoff"].includes(event.type)) {
    return "runtime";
  }
  if (["error", "log-disconnected", "project-create-failed", "project-select-failed", "project-import-failed"].includes(event.type)) {
    return "errors";
  }
  return "runtime";
}

function activityMatchesTarget(event, target) {
  const needle = String(target || "").trim().toLowerCase();
  if (!needle) return true;
  return [
    event.id,
    event.agentId,
    event.responsibleAgentId,
    event.agent?.id,
    event.agent?.name,
    event.projectId,
    event.projectName,
    event.type,
    event.message,
    event.label,
    event.detail,
    event.status
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function scoreTone(value) {
  if (value >= 70) return "strong";
  if (value >= 50) return "steady";
  return "low";
}

function vectorLabel(vector) {
  if (vector?.status === "completed") return "OpenAI confirmed";
  if (vector?.status === "pending") return "Vector pending";
  if (vector?.status) return vector.status.replace(/_/g, " ");
  return "Local only";
}

function compactNumber(value) {
  return new Intl.NumberFormat("en", { notation: Number(value || 0) >= 10000 ? "compact" : "standard" }).format(Number(value || 0));
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(Number(value || 0));
}

function shortDate(value) {
  if (!value) return "No runs";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function selfImprovementRunSummary(indicator = {}) {
  const state = indicator?.state || "idle";
  const phase = displayEventType(indicator?.phase || state);
  const running = ["starting", "running"].includes(state);
  const blocked = ["paused", "emergency_stopped", "disabled", "failed"].includes(state);
  const nextRun = indicator?.nextRunAt ? shortDate(indicator.nextRunAt) : "";
  const title = running
    ? "Self-improvement running"
    : state === "adhoc_ready"
      ? "Self-improvement event-driven"
    : nextRun
      ? `Self-improvement next ${nextRun}`
      : blocked
        ? `Self-improvement ${displayEventType(state)}`
        : "Self-improvement idle";
  return {
    state,
    phase,
    running,
    blocked,
    nextRun,
    title,
    detail: indicator?.message || (nextRun ? `Next autonomous cycle: ${nextRun}` : phase)
  };
}

function agentKnowledgeText(agent) {
  return (
    agent.instructionSummary ||
    agent.objective ||
    agent.reuseGuidance ||
    agent.deliverablePatterns ||
    "No knowledge summary recorded yet."
  );
}

function hasAgentMemory(agent) {
  return Boolean(agent?.vectorMemoryContent || agent?.sourceReferences?.length || agent?.vector?.file_id);
}

function markdownSections(markdown = "") {
  const text = String(markdown || "").trim();
  if (!text) return [];
  const sections = [];
  let body = text;
  const frontMatter = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (frontMatter) {
    sections.push({ title: "Metadata", content: frontMatter[1].trim(), level: 0 });
    body = body.slice(frontMatter[0].length);
  }
  const headingPattern = /^(#{1,4})\s+(.+)$/gm;
  const headings = [...body.matchAll(headingPattern)];
  if (!headings.length) {
    sections.push({ title: "Content", content: body.trim(), level: 1 });
    return sections.filter((section) => section.content);
  }
  headings.forEach((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : body.length;
    sections.push({
      title: heading[2].trim(),
      content: body.slice(start, end).trim(),
      level: heading[1].length
    });
  });
  return sections.filter((section) => section.content || section.title);
}

function highlightedMarkdownLines(content = "") {
  return String(content || "")
    .split(/\r?\n/)
    .map((line, index) => {
      const important = /\b(CRITICAL|IMPORTANT|MANDATORY|MUST|NON-OPTIONAL|REQUIRED|NEVER|ALWAYS)\b/i.test(line);
      return (
        <span className={important ? "markdown-line important" : "markdown-line"} key={`${index}-${line.slice(0, 16)}`}>
          {line || " "}
        </span>
      );
    });
}

function renderMarkdownInline(text = "") {
  const parts = String(text || "").split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter((part) => part !== "");
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function markdownBlocks(content = "") {
  const lines = String(content || "").split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = null;
  let code = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join(" ").replace(/\s+/g, " ").trim() });
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    blocks.push(list);
    list = null;
  }

  function flushCode() {
    if (!code) return;
    blocks.push({ type: "code", text: code.join("\n").trim() });
    code = null;
  }

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (line.trim().startsWith("```")) {
      if (code) {
        flushCode();
      } else {
        flushParagraph();
        flushList();
        code = [];
      }
      return;
    }
    if (code) {
      code.push(rawLine);
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }
    const heading = trimmed.match(/^(#{3,5})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      return;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== "list") {
        flushList();
        list = { type: "list", ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      return;
    }
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== "list" || !list.ordered) {
        flushList();
        list = { type: "list", ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      return;
    }
    flushList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();
  flushCode();
  return blocks.filter((block) => block.text || block.items?.length);
}

function ProductDocumentRichContent({ content }) {
  const blocks = markdownBlocks(content);
  return (
    <div className="product-document-rich-content">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return <h4 key={`${block.text}-${index}`}>{renderMarkdownInline(block.text)}</h4>;
        }
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={`${block.ordered}-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderMarkdownInline(item)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "code") {
          return <pre key={`${block.text.slice(0, 18)}-${index}`}>{block.text}</pre>;
        }
        return <p key={`${block.text.slice(0, 18)}-${index}`}>{renderMarkdownInline(block.text)}</p>;
      })}
    </div>
  );
}

function pdfSafeText(value = "") {
  return String(value || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u20b9]/g, "INR")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMarkdownForPdf(markdown = "") {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

function wrapPdfText(text = "", maxChars = 92) {
  const paragraphs = cleanMarkdownForPdf(text).split(/\n{2,}/);
  const lines = [];
  paragraphs.forEach((paragraph) => {
    const cleanParagraph = pdfSafeText(paragraph);
    if (!cleanParagraph) {
      lines.push("");
      return;
    }
    let current = "";
    cleanParagraph.split(/\s+/).forEach((word) => {
      if (!current) {
        current = word;
        return;
      }
      if (`${current} ${word}`.length > maxChars) {
        lines.push(current);
        current = word;
      } else {
        current = `${current} ${word}`;
      }
    });
    if (current) lines.push(current);
    lines.push("");
  });
  return lines;
}

function escapePdfString(value = "") {
  return pdfSafeText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function pdfRgb(hex) {
  const value = String(hex || "#000000").replace("#", "");
  const normalized = value.length === 3 ? [...value].map((item) => `${item}${item}`).join("") : value;
  return [0, 2, 4].map((offset) => (parseInt(normalized.slice(offset, offset + 2), 16) / 255).toFixed(3)).join(" ");
}

function pdfTextCommand(text, x, y, options = {}) {
  const size = options.size || 10;
  const font = options.font || "F1";
  const color = options.color || "#172033";
  return `BT /${font} ${size} Tf ${pdfRgb(color)} rg ${x} ${y} Td (${escapePdfString(text)}) Tj ET`;
}

function pdfRectCommand(x, y, width, height, fill, stroke = "") {
  const fillCommand = fill ? `${pdfRgb(fill)} rg` : "";
  const strokeCommand = stroke ? `${pdfRgb(stroke)} RG 1 w` : "";
  const paint = fill && stroke ? "B" : fill ? "f" : "S";
  return `${fillCommand} ${strokeCommand} ${x} ${y} ${width} ${height} re ${paint}`.trim();
}

function pdfLineCommand(x1, y1, x2, y2, color = "#94A3B8", width = 1) {
  return `${pdfRgb(color)} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`;
}

function pdfCircleCommand(x, y, radius, fill, stroke = "") {
  const control = radius * 0.5522847498;
  const fillCommand = fill ? `${pdfRgb(fill)} rg` : "";
  const strokeCommand = stroke ? `${pdfRgb(stroke)} RG 1 w` : "";
  const paint = fill && stroke ? "B" : fill ? "f" : "S";
  return `${fillCommand} ${strokeCommand} ${x + radius} ${y} m ${x + radius} ${y + control} ${x + control} ${y + radius} ${x} ${y + radius} c ${x - control} ${y + radius} ${x - radius} ${y + control} ${x - radius} ${y} c ${x - radius} ${y - control} ${x - control} ${y - radius} ${x} ${y - radius} c ${x + control} ${y - radius} ${x + radius} ${y - control} ${x + radius} ${y} c ${paint}`.trim();
}

function pdfArrowCommand(x1, y1, x2, y2, color = "#0F766E") {
  return [
    pdfLineCommand(x1, y1, x2, y2, color, 1.5),
    `${pdfRgb(color)} rg ${x2} ${y2} m ${x2 - 5} ${y2 + 3} l ${x2 - 5} ${y2 - 3} l h f`
  ].join("\n");
}

function productDocumentWorkflowDefinitions() {
  return [
    {
      title: "Product Shape Routing",
      caption: "The central brain preserves the requested output instead of defaulting to a website.",
      evidence: ["Artifact contract", "Complexity score", "Required data", "Output paths", "Validation gate"],
      steps: [
        { label: "Instruction and references", detail: "Prompt, screenshot, project, media, source data, or existing workspace." },
        { label: "Central brain classification", detail: "Detect artifact type, interaction model, scope, risk, and missing inputs." },
        { label: "Product Shape Contract", detail: "Bind the correct app, service, automation, workbook, document, print, or media shape." },
        { label: "Specialist execution", detail: "Route bounded work to design, frontend, backend, data, document, media, and QA agents." },
        { label: "Artifact-native validation", detail: "Inspect functionality, formulas, layout, packaging, evidence, and unresolved fallbacks." }
      ]
    },
    {
      title: "Functional Reference Expansion",
      caption: "A screenshot or named-product reference becomes behavior, state, and data contracts.",
      evidence: ["Visible nodes", "User actions", "State model", "API contract", "Coverage map"],
      steps: [
        { label: "Visual evidence", detail: "Capture screenshots, frames, selected UI nodes, controls, and product references." },
        { label: "Node inventory", detail: "Identify navigation, tables, charts, editors, drawers, forms, filters, and commands." },
        { label: "Behavior mapping", detail: "Assign each node an action, state transition, data source, API, or explicit fallback." },
        { label: "End-to-end implementation", detail: "Complete frontend, backend, validation, loading, empty, error, and permission states." },
        { label: "Functional QA", detail: "Exercise the represented workflows and record implemented or constrained nodes." }
      ]
    },
    {
      title: "Autonomous Quality Loop",
      caption: "PlutoniX learns from evidence while keeping risky changes gated and reversible.",
      evidence: ["Runtime logs", "Graph memory", "Design review", "Policy gate", "Next-run learning"],
      steps: [
        { label: "Runtime evidence", detail: "Collect workflow events, file changes, tests, user corrections, and failure patterns." },
        { label: "Graph and memory synthesis", detail: "Update project knowledge, capability signals, topology, and reusable patterns." },
        { label: "Design workshop", detail: "Review UX flow, visual hierarchy, accessibility, responsiveness, and command placement." },
        { label: "Safe improvement proposal", detail: "Package evidence, isolated candidate changes, review gates, and rollback steps." },
        { label: "Better next execution", detail: "Use accepted learning to improve routing, completion depth, and next instructions." }
      ]
    }
  ];
}

function downloadProductDocumentPdf(markdown = "") {
  if (typeof document === "undefined") return;
  const pageWidth = 612;
  const pageHeight = 792;
  const pages = [];
  const exportedAt = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const workflows = productDocumentWorkflowDefinitions();

  const cover = [
    pdfRectCommand(0, 0, pageWidth, pageHeight, "#0B1424"),
    pdfRectCommand(0, 0, 14, pageHeight, "#B4233B"),
    pdfRectCommand(14, 0, 5, pageHeight, "#0F766E"),
    pdfTextCommand("PLUTONIX", 54, 704, { size: 14, font: "F2", color: "#65D6CB" }),
    pdfTextCommand("Product Document", 54, 632, { size: 38, font: "F2", color: "#FFFFFF" }),
    pdfTextCommand("Autonomous multi-artifact creation system", 56, 600, { size: 16, color: "#CBD5E1" }),
    pdfLineCommand(56, 570, 318, 570, "#B4233B", 3),
    pdfTextCommand("FROM INTENT TO THE RIGHT DIGITAL OUTPUT", 56, 538, { size: 9, font: "F2", color: "#65D6CB" }),
    ...wrapPdfText("PlutoniX classifies the requested product shape, coordinates specialist agents, generates the real artifact, and validates it in an output-aware Playground.", 62)
      .slice(0, 4)
      .map((line, index) => pdfTextCommand(line, 56, 510 - index * 17, { size: 11, color: "#E2E8F0" })),
    pdfTextCommand(`Edition 1.0  |  ${exportedAt}`, 56, 62, { size: 9, color: "#94A3B8" })
  ];
  const coverNodes = [
    [466, 620, 24, "#B4233B", "BRAIN"],
    [540, 682, 14, "#0F766E", "APP"],
    [558, 592, 14, "#D6A23C", "PDF"],
    [514, 520, 14, "#2563EB", "DATA"],
    [420, 522, 14, "#7C3AED", "MEDIA"],
    [410, 674, 14, "#0891B2", "MOBILE"]
  ];
  coverNodes.slice(1).forEach(([x, y]) => cover.push(pdfLineCommand(466, 620, x, y, "#334155", 1.2)));
  coverNodes.forEach(([x, y, radius, color, label]) => {
    cover.push(pdfCircleCommand(x, y, radius, color, "#FFFFFF"));
    cover.push(pdfTextCommand(label, x - radius + 3, y - 3, { size: radius > 20 ? 7 : 5.5, font: "F2", color: "#FFFFFF" }));
  });
  ["WEB + MOBILE", "PDF + DOCUMENT", "FLYER + IMAGE", "WORKBOOK + DATA", "API + AUTOMATION"].forEach((label, index) => {
    const x = 56 + (index % 2) * 142;
    const y = 352 - Math.floor(index / 2) * 42;
    cover.push(pdfRectCommand(x, y, 132, 28, index === 4 ? "#B4233B" : "#17243A", "#334155"));
    cover.push(pdfTextCommand(label, x + 10, y + 10, { size: 7.5, font: "F2", color: "#F8FAFC" }));
  });
  pages.push({ commands: cover, section: "Cover" });

  const capabilityPage = [
    pdfRectCommand(0, 0, pageWidth, pageHeight, "#F4F7FA"),
    pdfRectCommand(0, 738, pageWidth, 54, "#0B1424"),
    pdfTextCommand("PLUTONIX / CREATION SPECTRUM", 42, 758, { size: 10, font: "F2", color: "#65D6CB" }),
    pdfTextCommand("One brain. Multiple native outputs.", 42, 690, { size: 25, font: "F2", color: "#101828" }),
    pdfTextCommand("The requested artifact remains the product. A webpage is never used as a substitute.", 42, 666, { size: 10, color: "#526174" })
  ];
  const capabilities = [
    ["Applications", "Web, mobile, focused tools, operational products, and complex platforms.", "#2563EB"],
    ["Documents", "PDFs, reports, proposals, invoices, manuals, and professional printable layouts.", "#B4233B"],
    ["Creative", "Flyers, brochures, posters, banners, thumbnails, logos, and image assets.", "#7C3AED"],
    ["Workbooks", "Excel and CSV deliverables with sheets, tables, formulas, and validation evidence.", "#0F766E"],
    ["Media", "Presentations, video, audio, visual sequences, and media-led deliverables.", "#D97706"],
    ["Execution", "APIs, scripts, automations, data workflows, infrastructure, and packaged services.", "#0891B2"]
  ];
  capabilities.forEach(([label, detail, color], index) => {
    const y = 592 - index * 78;
    capabilityPage.push(pdfRectCommand(42, y, 8, 54, color));
    capabilityPage.push(pdfRectCommand(50, y, 520, 54, "#FFFFFF", "#D7DEE7"));
    capabilityPage.push(pdfTextCommand(String(index + 1).padStart(2, "0"), 66, y + 31, { size: 9, font: "F2", color }));
    capabilityPage.push(pdfTextCommand(label, 98, y + 31, { size: 13, font: "F2", color: "#172033" }));
    capabilityPage.push(pdfTextCommand(detail, 218, y + 30, { size: 8.5, color: "#526174" }));
  });
  capabilityPage.push(pdfTextCommand("ADAPTIVE PLAYGROUND", 42, 108, { size: 8, font: "F2", color: "#B4233B" }));
  capabilityPage.push(pdfTextCommand("Instruction", 42, 80, { size: 9, font: "F2" }));
  capabilityPage.push(pdfArrowCommand(118, 84, 218, 84));
  capabilityPage.push(pdfTextCommand("Central brain", 236, 80, { size: 9, font: "F2" }));
  capabilityPage.push(pdfArrowCommand(324, 84, 414, 84));
  capabilityPage.push(pdfTextCommand("Native preview", 432, 80, { size: 9, font: "F2" }));
  pages.push({ commands: capabilityPage, section: "Creation spectrum" });

  workflows.forEach((workflow, workflowIndex) => {
    const commands = [
      pdfRectCommand(0, 0, pageWidth, pageHeight, "#FFFFFF"),
      pdfRectCommand(0, 738, pageWidth, 54, workflowIndex === 1 ? "#17243A" : "#0B1424"),
      pdfTextCommand(`WORKFLOW 0${workflowIndex + 1}`, 42, 758, { size: 9, font: "F2", color: "#65D6CB" }),
      pdfTextCommand(workflow.title, 42, 688, { size: 25, font: "F2", color: "#101828" }),
      ...wrapPdfText(workflow.caption, 78).slice(0, 2).map((line, index) => pdfTextCommand(line, 42, 662 - index * 14, { size: 9.5, color: "#526174" })),
      pdfRectCommand(438, 118, 132, 500, "#F4F7FA", "#D7DEE7"),
      pdfTextCommand("EVIDENCE TRACK", 454, 592, { size: 8, font: "F2", color: "#B4233B" })
    ];
    workflow.evidence.forEach((item, index) => {
      const y = 530 - index * 82;
      commands.push(pdfCircleCommand(460, y, 7, index === workflow.evidence.length - 1 ? "#B4233B" : "#0F766E"));
      if (index < workflow.evidence.length - 1) commands.push(pdfLineCommand(460, y - 8, 460, y - 74, "#94A3B8", 1));
      commands.push(pdfTextCommand(item, 476, y - 3, { size: 8.5, font: "F2", color: "#334155" }));
    });
    workflow.steps.forEach((step, index) => {
      const y = 548 - index * 100;
      const accent = index === workflow.steps.length - 1 ? "#B4233B" : index % 2 ? "#2563EB" : "#0F766E";
      commands.push(pdfRectCommand(42, y, 360, 72, "#FFFFFF", "#CBD5E1"));
      commands.push(pdfRectCommand(42, y, 7, 72, accent));
      commands.push(pdfCircleCommand(76, y + 36, 15, accent));
      commands.push(pdfTextCommand(String(index + 1), 72, y + 33, { size: 9, font: "F2", color: "#FFFFFF" }));
      commands.push(pdfTextCommand(step.label, 102, y + 45, { size: 11, font: "F2", color: "#172033" }));
      wrapPdfText(step.detail, 57).slice(0, 2).forEach((line, lineIndex) => {
        commands.push(pdfTextCommand(line, 102, y + 27 - lineIndex * 12, { size: 8, color: "#526174" }));
      });
      if (index < workflow.steps.length - 1) {
        commands.push(pdfLineCommand(222, y, 222, y - 27, "#94A3B8", 1.4));
        commands.push(`${pdfRgb("#94A3B8")} rg 222 ${y - 29} m 218 ${y - 22} l 226 ${y - 22} l h f`);
      }
    });
    pages.push({ commands, section: workflow.title });
  });

  const documentSections = markdownSections(markdown);
  documentSections.forEach((section, sectionIndex) => {
    const blocks = markdownBlocks(section.content || "");
    let commands = [];
    let cursorY = 650;
    const startPage = (continued = false) => {
      commands = [
        pdfRectCommand(0, 0, pageWidth, pageHeight, "#FFFFFF"),
        pdfRectCommand(0, 738, pageWidth, 54, "#0B1424"),
        pdfTextCommand("PLUTONIX / PRODUCT SOURCE OF TRUTH", 42, 758, { size: 9, font: "F2", color: "#65D6CB" }),
        pdfTextCommand(String(sectionIndex + 1).padStart(2, "0"), 42, 694, { size: 11, font: "F2", color: "#B4233B" }),
        pdfTextCommand(`${section.title}${continued ? " / continued" : ""}`, 78, 688, { size: continued ? 18 : 22, font: "F2", color: "#101828" }),
        pdfLineCommand(42, 668, 570, 668, "#D7DEE7", 1)
      ];
      cursorY = 642;
    };
    const commitPage = () => pages.push({ commands, section: section.title });
    const ensureSpace = (height) => {
      if (cursorY - height >= 64) return;
      commitPage();
      startPage(true);
    };
    startPage(false);
    blocks.forEach((block) => {
      if (block.type === "heading") {
        ensureSpace(42);
        commands.push(pdfTextCommand(block.text, 42, cursorY, { size: 13, font: "F2", color: "#0F766E" }));
        cursorY -= 28;
        return;
      }
      if (block.type === "list") {
        block.items.forEach((item, itemIndex) => {
          const lines = wrapPdfText(item, 82);
          ensureSpace(lines.length * 13 + 8);
          commands.push(pdfCircleCommand(50, cursorY + 2, 2.2, "#B4233B"));
          lines.forEach((line, lineIndex) => commands.push(pdfTextCommand(line, 62, cursorY - lineIndex * 13, { size: 9, color: "#334155" })));
          cursorY -= lines.length * 13 + (itemIndex === block.items.length - 1 ? 12 : 6);
        });
        return;
      }
      const lines = wrapPdfText(block.text, block.type === "code" ? 76 : 88);
      const lineHeight = block.type === "code" ? 12 : 13;
      ensureSpace(lines.length * lineHeight + 16);
      if (block.type === "code") commands.push(pdfRectCommand(36, cursorY - lines.length * lineHeight - 8, 540, lines.length * lineHeight + 18, "#F1F5F9", "#D7DEE7"));
      lines.forEach((line, lineIndex) => commands.push(pdfTextCommand(line, block.type === "code" ? 48 : 42, cursorY - lineIndex * lineHeight, { size: block.type === "code" ? 8 : 9, color: "#334155" })));
      cursorY -= lines.length * lineHeight + 16;
    });
    commitPage();
  });

  pages.forEach((page, index) => {
    if (index === 0) return;
    page.commands.push(pdfLineCommand(42, 42, 570, 42, "#D7DEE7", 0.8));
    page.commands.push(pdfTextCommand("PlutoniX Product Document", 42, 24, { size: 7.5, font: "F2", color: "#64748B" }));
    page.commands.push(pdfTextCommand(`${String(index + 1).padStart(2, "0")} / ${String(pages.length).padStart(2, "0")}`, 520, 24, { size: 7.5, font: "F2", color: "#64748B" }));
  });

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  ];
  const pageObjectIds = [];

  pages.forEach((page) => {
    const stream = page.commands.join("\n");
    const contentObjectId = objects.length + 1;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageObjectId = objects.length + 1;
    pageObjectIds.push(pageObjectId);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
  });

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "PlutoniX-Product-Document.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ProductDocumentFlowDiagram({ title, caption, steps }) {
  return (
    <article className="product-document-flow-card">
      <header>
        <strong>{title}</strong>
        <span>{caption}</span>
      </header>
      <div className="product-document-flow-diagram" aria-label={`${title} flow diagram`}>
        {steps.map((step, index) => (
          <div className="product-document-flow-step" key={step.label}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

const artifactKindDetails = {
  spreadsheet: { label: "Workbook", Icon: FileSpreadsheet },
  presentation: { label: "Presentation", Icon: Presentation },
  document: { label: "Document", Icon: FileText },
  code: { label: "Code and data", Icon: FileCode2 },
  image: { label: "Image and print", Icon: Palette },
  video: { label: "Video", Icon: Film },
  audio: { label: "Audio", Icon: Music2 },
  pdf: { label: "PDF document", Icon: FileText },
  html: { label: "Interactive HTML", Icon: Code2 },
  file: { label: "Artifact", Icon: FileText }
};

function ArtifactKindIcon({ kind, size = 18 }) {
  const Icon = artifactKindDetails[kind]?.Icon || FileText;
  return <Icon size={size} />;
}

function artifactKindLabel(kind) {
  return artifactKindDetails[kind]?.label || "Artifact";
}

function formatArtifactSize(bytes = 0) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function spreadsheetColumnLabel(index) {
  let value = Number(index) + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label || "A";
}

function SpreadsheetArtifactCanvas({ preview }) {
  const sheets = Array.isArray(preview?.sheets) ? preview.sheets : [];
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [selectedReference, setSelectedReference] = useState("");
  const activeSheet = sheets[Math.min(activeSheetIndex, Math.max(0, sheets.length - 1))] || null;
  const rows = activeSheet?.rows || [];
  const columnCount = Math.min(60, Math.max(1, activeSheet?.columnCount || 0));
  const selectedCell = rows.flatMap((row) => row.cells || []).find((cell) => cell.reference === selectedReference) || null;

  useEffect(() => {
    setActiveSheetIndex(0);
    setSelectedReference("");
  }, [preview]);

  if (!activeSheet) {
    return (
      <div className="artifact-structured-empty">
        <FileSpreadsheet size={32} />
        <strong>Workbook preview unavailable</strong>
        <span>{preview?.message || "The workbook can still be downloaded from the artifact bar."}</span>
      </div>
    );
  }

  return (
    <div className="workbook-canvas">
      <div className="workbook-formula-bar">
        <span className="workbook-cell-reference">{selectedCell?.reference || "A1"}</span>
        <Sigma size={15} />
        <span>{selectedCell?.formula ? `=${selectedCell.formula}` : selectedCell?.value || "Select a cell to inspect its value or formula"}</span>
        <small>{activeSheet.formulaCount || 0} formula{activeSheet.formulaCount === 1 ? "" : "s"}</small>
      </div>
      <div className="workbook-grid-wrap">
        <table className="workbook-grid">
          <thead>
            <tr>
              <th className="workbook-corner" />
              {Array.from({ length: columnCount }, (_, columnIndex) => (
                <th key={columnIndex}>{spreadsheetColumnLabel(columnIndex)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const cells = new Map((row.cells || []).map((cell) => [cell.column, cell]));
              return (
                <tr key={`${row.index}-${rowIndex}`}>
                  <th>{row.index}</th>
                  {Array.from({ length: columnCount }, (_, columnIndex) => {
                    const cell = cells.get(columnIndex);
                    return (
                      <td
                        key={columnIndex}
                        className={`${cell?.formula ? "formula-cell" : ""} ${selectedCell?.reference === cell?.reference ? "selected" : ""}`}
                        onClick={() => setSelectedReference(cell?.reference || `${spreadsheetColumnLabel(columnIndex)}${row.index}`)}
                        title={cell?.formula ? `=${cell.formula}` : cell?.value || ""}
                      >
                        {cell?.value || ""}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="workbook-sheet-tabs" role="tablist" aria-label="Workbook sheets">
        {sheets.map((sheet, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={index === activeSheetIndex}
            className={index === activeSheetIndex ? "active" : ""}
            key={`${sheet.name}-${index}`}
            onClick={() => {
              setActiveSheetIndex(index);
              setSelectedReference("");
            }}
          >
            {sheet.name}
          </button>
        ))}
        <span>{activeSheet.rowCount || rows.length} rows x {activeSheet.columnCount || columnCount} columns</span>
      </div>
    </div>
  );
}

function DocumentArtifactCanvas({ artifact, preview }) {
  if (Array.isArray(preview?.paragraphs)) {
    return (
      <div className="document-artifact-stage">
        <article className="document-artifact-page">
          <header>
            <span>PlutoniX document</span>
            <strong>{preview.title || artifact.name}</strong>
          </header>
          {preview.paragraphs.map((paragraph, index) => <p key={`${paragraph.slice(0, 28)}-${index}`}>{paragraph}</p>)}
        </article>
      </div>
    );
  }
  if (artifact?.mimeType === "text/markdown") {
    return (
      <div className="document-artifact-stage">
        <article className="document-artifact-page markdown-page">
          <ProductDocumentRichContent content={preview?.content || ""} />
        </article>
      </div>
    );
  }
  return (
    <div className="document-artifact-stage">
      <article className="document-artifact-page plain-page">
        <pre>{preview?.content || preview?.message || "Document preview is unavailable."}</pre>
      </article>
    </div>
  );
}

function PresentationArtifactCanvas({ preview }) {
  const slides = Array.isArray(preview?.slides) ? preview.slides : [];
  const [activeIndex, setActiveIndex] = useState(0);
  const slide = slides[Math.min(activeIndex, Math.max(0, slides.length - 1))] || null;
  useEffect(() => setActiveIndex(0), [preview]);
  if (!slide) {
    return <div className="artifact-structured-empty"><Presentation size={32} /><strong>Slide preview unavailable</strong></div>;
  }
  return (
    <div className="presentation-canvas">
      <aside className="presentation-slide-strip">
        {slides.map((item, index) => (
          <button type="button" className={index === activeIndex ? "active" : ""} key={item.index} onClick={() => setActiveIndex(index)}>
            <span>{item.index}</span>
            <small>{item.title}</small>
          </button>
        ))}
      </aside>
      <div className="presentation-stage">
        <article>
          <span>SLIDE {String(slide.index).padStart(2, "0")}</span>
          <h3>{slide.title}</h3>
          <p>{slide.text}</p>
          <footer>PlutoniX presentation preview</footer>
        </article>
      </div>
    </div>
  );
}

function ArtifactCanvas({ artifact, preview, artifactUrl, loading, error }) {
  if (loading) {
    return <div className="artifact-structured-empty"><Loader2 className="spin" size={30} /><strong>Preparing structured preview...</strong></div>;
  }
  if (error) {
    return <div className="artifact-structured-empty error-text"><XCircle size={30} /><strong>{error}</strong></div>;
  }
  if (artifact.kind === "image") return <img src={artifactUrl} alt={artifact.name} />;
  if (artifact.kind === "video") return <video src={artifactUrl} controls />;
  if (artifact.kind === "audio") {
    return (
      <div className="artifact-audio">
        <span><Music2 size={28} /></span>
        <strong>{artifact.name}</strong>
        <audio src={artifactUrl} controls />
      </div>
    );
  }
  if (artifact.kind === "pdf" || artifact.kind === "html") {
    return <iframe title={artifact.name} src={artifactUrl} />;
  }
  if (artifact.kind === "spreadsheet") return <SpreadsheetArtifactCanvas preview={preview} />;
  if (artifact.kind === "presentation") return <PresentationArtifactCanvas preview={preview} />;
  if (artifact.kind === "document") return <DocumentArtifactCanvas artifact={artifact} preview={preview} />;
  if (artifact.kind === "code") {
    return <div className="code-artifact-stage"><pre>{preview?.content || preview?.message || "Code preview is unavailable."}</pre></div>;
  }
  return (
    <div className="artifact-structured-empty">
      <FileText size={32} />
      <strong>{artifact.name}</strong>
      <span>This artifact is available to open or download.</span>
    </div>
  );
}

function MarkdownSourceModal({ source, onClose }) {
  const sections = useMemo(() => markdownSections(source?.content || ""), [source]);
  const [openSections, setOpenSections] = useState(() => new Set(sections.map((_, index) => index)));

  useEffect(() => {
    setOpenSections(new Set(sections.map((_, index) => index)));
  }, [source?.path, sections.length]);

  if (!source) return null;
  const hasContent = Boolean(source.content);

  function toggle(index) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div
      className="modal-backdrop agent-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <section className="markdown-source-modal" role="dialog" aria-modal="true" aria-label={`${source.label || source.path} markdown`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="agent-modal-header">
          <div>
            <p>Markdown source · {source.contentSource?.replace(/_/g, " ") || "local file"}</p>
            <h2>{source.label || source.path}</h2>
            <span>{source.path}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Close markdown source">
            <X size={16} />
          </button>
        </header>

        {!hasContent ? (
          <div className="markdown-empty-state">
            This `.md` reference came from OpenAI vector metadata, but the local markdown body is not available in PlutoniX.
          </div>
        ) : (
          <div className="markdown-section-list">
            {sections.map((section, index) => {
              const isOpen = openSections.has(index);
              return (
                <article className={`markdown-section level-${section.level}`} key={`${section.title}-${index}`}>
                  <button className="markdown-section-toggle" onClick={() => toggle(index)}>
                    <span className="markdown-toggle-symbol">{isOpen ? "−" : "+"}</span>
                    <span>{section.title}</span>
                  </button>
                  {isOpen ? <pre className="markdown-section-content">{highlightedMarkdownLines(section.content)}</pre> : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function AgentDetailModal({ agent, onClose }) {
  const [selectedSource, setSelectedSource] = useState(null);
  if (!agent) return null;
  const visual = agentVisualFromRecord(agent);
  const tokenTimeline = agent.tokenEconomy?.timeline?.length ? agent.tokenEconomy.timeline : [];
  const efficiencyTimeline = tokenTimeline.filter((row) => row.efficiencyScore || row.accuracyValue || row.abilityScore);
  const detailCards = [
    ["Knowledge summary", agentKnowledgeText(agent)],
    ["Objective", agent.objective],
    ["Instruction summary", agent.instructionSummary],
    ["Deliverable patterns", agent.deliverablePatterns],
    ["Validation", agent.validationResults],
    ["Correction patterns", agent.correctionPatterns],
    ["Lessons learned", agent.lessonsLearned],
    ["Reuse guidance", agent.reuseGuidance]
  ].filter(([, value]) => value);

  return (
    <div className="modal-backdrop agent-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="agent-modal" role="dialog" aria-modal="true" aria-label={`${agent.name} profile`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="agent-modal-header">
          <AgentAvatar visual={visual} size="large" />
          <div>
            <p>{agent.project} · {agent.profile?.label || agent.role}</p>
            <h2>{agent.name}</h2>
            <span>{agent.role} · {agent.domain}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Close agent details">
            <X size={16} />
          </button>
        </header>

        <div className="agent-modal-grid">
          <section className="agent-card agent-efficiency-card">
            <div className="section-heading">
              <Gauge size={18} />
              <h2>Efficiency signals</h2>
            </div>
            <div className="agent-score-grid">
              {Object.entries(agent.efficiency || {}).map(([key, value]) => (
                <div className={`agent-score ${scoreTone(value)}`} key={key}>
                  <span>{key}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="agent-card">
            <div className="section-heading">
              <Database size={18} />
              <h2>Vector memory</h2>
            </div>
            <p>{vectorLabel(agent.vector)}</p>
            <small>{agent.vector?.source || "workspace knowledge"} · {agent.sourcePath}</small>
            {agent.vectorMemoryContentSource && <small>content source · {agent.vectorMemoryContentSource.replace(/_/g, " ")}</small>}
            <small>Used {agent.usageCount ?? 0} time{Number(agent.usageCount || 0) === 1 ? "" : "s"} in local memory records</small>
            {agent.sourceReferences?.length ? (
              <div className="agent-md-links">
                {agent.sourceReferences.map((source) => (
                  <button
                    type="button"
                    key={`${source.path}-${source.contentSource}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedSource(source);
                    }}
                  >
                    {source.label || source.path}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="agent-card agent-capability-card">
            <div className="section-heading">
              <ShieldCheck size={18} />
              <h2>Capabilities</h2>
            </div>
            <div className="agent-tags">
              {(agent.capabilities?.length ? agent.capabilities : ["General task execution"]).map((capability) => (
                <span key={capability}>{capability}</span>
              ))}
            </div>
          </section>

          <section className="agent-card agent-token-economy-card">
            <div className="section-heading">
              <Gauge size={18} />
              <h2>Token Economy</h2>
            </div>
            <div className="token-economy-grid">
              <div>
                <span>Total</span>
                <strong>{compactNumber(agent.tokenEconomy?.totalTokens)}</strong>
              </div>
              <div>
                <span>Input</span>
                <strong>{compactNumber(agent.tokenEconomy?.inputTokens)}</strong>
              </div>
              <div>
                <span>Output</span>
                <strong>{compactNumber(agent.tokenEconomy?.outputTokens)}</strong>
              </div>
              <div>
                <span>Input cost</span>
                <strong>{money(agent.tokenEconomy?.inputEstimatedUsd)}</strong>
              </div>
              <div>
                <span>Output cost</span>
                <strong>{money(agent.tokenEconomy?.outputEstimatedUsd)}</strong>
              </div>
              <div>
                <span>Avg / run</span>
                <strong>{compactNumber(agent.tokenEconomy?.averageTotalTokens)}</strong>
              </div>
              <div>
                <span>Est. expense</span>
                <strong>{money(agent.tokenEconomy?.estimatedUsd)}</strong>
              </div>
              <div>
                <span>Avg expense</span>
                <strong>{money(agent.tokenEconomy?.averageUsd)}</strong>
              </div>
              <div>
                <span>Avg accuracy</span>
                <strong>{agent.tokenEconomy?.averageAccuracyValue || 0}</strong>
              </div>
              <div>
                <span>Avg efficiency</span>
                <strong>{agent.tokenEconomy?.averageEfficiencyScore || 0}</strong>
              </div>
              <div>
                <span>Ability</span>
                <strong>{agent.tokenEconomy?.averageAbilityScore || agent.efficiency?.capability || 0}</strong>
              </div>
              <div>
                <span>Tokens / accuracy</span>
                <strong>{compactNumber(agent.tokenEconomy?.tokensPerAccuracyPoint)}</strong>
              </div>
              <div>
                <span>Expense / accuracy</span>
                <strong>{money(agent.tokenEconomy?.usdPerAccuracyPoint)}</strong>
              </div>
            </div>
            <div className="token-economy-timeline" aria-label="Token economy timeline">
              {(tokenTimeline.length ? tokenTimeline : [{ totalTokens: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, createdAt: "" }]).map((row, index, rows) => {
                const max = Math.max(...rows.map((item) => Number(item.totalTokens || 0)), 1);
                const height = Math.max(8, Math.round((Number(row.totalTokens || 0) / max) * 58));
                return (
                  <span
                    key={`${row.createdAt || "empty"}-${index}`}
                    style={{ "--bar-height": `${height}px` }}
                    title={`${row.createdAt || "No runs yet"} · ${compactNumber(row.totalTokens)} tokens · ${money(row.estimatedUsd)}`}
                  />
                );
              })}
            </div>
            <div className="agent-efficiency-timeline" aria-label="Agentic efficiency timeline">
              {(efficiencyTimeline.length ? efficiencyTimeline : [{ efficiencyScore: 0, accuracyValue: 0, abilityScore: 0, createdAt: "" }]).map((row, index, rows) => {
                const max = Math.max(...rows.map((item) => Number(item.efficiencyScore || 0)), 1);
                const height = Math.max(8, Math.round((Number(row.efficiencyScore || 0) / max) * 58));
                return (
                  <span
                    key={`${row.createdAt || "eff-empty"}-${index}`}
                    style={{ "--bar-height": `${height}px` }}
                    title={`${row.createdAt || "No runs yet"} · efficiency ${row.efficiencyScore || 0}/100 · accuracy ${row.accuracyValue || 0}/100 · ability ${row.abilityScore || 0}/100`}
                  />
                );
              })}
            </div>
            {tokenTimeline.length ? (
              <div className="token-execution-list">
                {tokenTimeline.slice().reverse().slice(0, 6).map((row) => (
                  <div key={`${row.buildId}-${row.createdAt}`}>
                    <span>
                      {shortDate(row.createdAt)}
                      {row.taskType ? ` · ${row.taskType}` : ""}
                    </span>
                    <strong>{money(row.estimatedUsd)}</strong>
                    <small>
                      {compactNumber(row.inputTokens)} in · {compactNumber(row.outputTokens)} out · {compactNumber(row.totalCredits)} credits
                      {row.inputCredits !== undefined ? ` · in cost ${compactNumber(row.inputCredits)} cr` : ""}
                      {row.outputCredits !== undefined ? ` · out cost ${compactNumber(row.outputCredits)} cr` : ""}
                      {row.accuracyValue ? ` · accuracy ${row.accuracyValue}/100` : ""}
                      {row.efficiencyScore ? ` · efficiency ${row.efficiencyScore}/100` : ""}
                      {row.costModel ? ` · ${row.costModel}` : ""}
                    </small>
                  </div>
                ))}
              </div>
            ) : null}
            <p>
              {agent.tokenEconomy?.totalRuns
                ? `${agent.tokenEconomy.totalRuns} recorded run${agent.tokenEconomy.totalRuns === 1 ? "" : "s"} using local token estimates and OpenAI Codex credit-rate math. Subscription fees are flat account costs, so per-run expense is shown as estimated usage value.`
                : "No token usage has been recorded for this agent yet."}
            </p>
          </section>

          {detailCards.map(([title, value]) => (
            <section className="agent-card" key={title}>
              <h3>{title}</h3>
              <p>{value}</p>
            </section>
          ))}

          <section className="agent-card agent-vector-memory-card">
            <h3>Vector memory content</h3>
            <pre className="agent-vector-memory-content">
              {agent.vectorMemoryContent || "No local vector-memory content or retrievable OpenAI vector metadata is available yet."}
            </pre>
          </section>
        </div>
      </section>
      <MarkdownSourceModal source={selectedSource} onClose={() => setSelectedSource(null)} />
    </div>
  );
}

function AgentsWorkspace({ initialAgentId = "", initialAgent = null }) {
  const [agents, setAgents] = useState([]);
  const [source, setSource] = useState(null);
  const [query, setQuery] = useState(initialAgent?.name || initialAgentId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingAgentKey, setDeletingAgentKey] = useState("");
  const [deepLinkNotice, setDeepLinkNotice] = useState(initialAgent ? "Showing topology metadata while global agent memory loads." : "");
  const [selectedAgent, setSelectedAgent] = useState(initialAgent);
  const handledDeepLinkRef = useRef("");

  async function loadAgents() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BACKEND_URL}/api/agents/global`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Agent knowledge could not be loaded.");
      setAgents(Array.isArray(data.agents) ? data.agents : []);
      setSource(data.source || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteAgent(agent, event) {
    event.stopPropagation();
    if (agent.deletion?.allowed === false) return;
    const confirmed = window.confirm(
      `Delete ${agent.name}?\n\nThis permanently removes its agent definition, local memory, topology membership, and linked OpenAI vector memory. Historical audit records are retained.`
    );
    if (!confirmed) return;
    const agentKey = `${agent.project}:${agent.id}:${agent.sourcePath}`;
    setDeletingAgentKey(agentKey);
    setError("");
    try {
      const res = await authFetch(`${BACKEND_URL}/api/agents/global/${encodeURIComponent(agent.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: agent.project,
          sourcePath: agent.sourcePath,
          sourceRootId: agent.sourceRootId,
          vectorFileId: agent.vector?.file_id
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Agent and memory could not be deleted.");
      setSelectedAgent((current) =>
        current?.id === agent.id && current?.sourcePath === agent.sourcePath ? null : current
      );
      await loadAgents();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeletingAgentKey("");
    }
  }

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    if (!initialAgentId || loading || handledDeepLinkRef.current === initialAgentId) return;
    const target = initialAgentId.toLowerCase();
    const match = agents.find((agent) =>
      [agent.id, agent.name, agent.agentId, agent.sourcePath]
        .filter(Boolean)
        .some((value) => {
          const candidate = String(value).toLowerCase();
          return candidate === target || candidate.includes(target) || target.includes(candidate);
        })
    );
    setQuery(match?.name || initialAgentId);
    setSelectedAgent(match || null);
    setDeepLinkNotice(match ? "" : `Agent “${initialAgentId}” is not available in the global memory index.`);
    handledDeepLinkRef.current = initialAgentId;
  }, [agents, initialAgentId, loading]);

  const filteredAgents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter((agent) =>
      [agent.name, agent.project, agent.role, agent.domain, agent.objective, agent.instructionSummary, agent.reuseGuidance, ...(agent.capabilities || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [agents, query]);

  const confirmedCount = agents.filter((agent) => agent.vector?.status === "completed").length;

  return (
    <main className="agents-workspace-tab">
      <header className="agents-hero">
        <div>
          <span className="eyebrow">Global agent memory</span>
          <h1>Agents</h1>
          <p>
            Agent profiles collected from global knowledge records and vector-store sync metadata across PlutoniX, GeoFinderX,
            and project-local orchestrators.
          </p>
        </div>
        <div className="agents-hero-actions">
          <button className="ghost-action" onClick={loadAgents} disabled={loading}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            Refresh
          </button>
        </div>
      </header>

      <section className="agents-summary-grid">
        <div className="agent-summary-card">
          <span>Total agents</span>
          <strong>{agents.length}</strong>
        </div>
        <div className="agent-summary-card">
          <span>OpenAI confirmed</span>
          <strong>{confirmedCount}</strong>
        </div>
        <div className="agent-summary-card">
          <span>Vector store</span>
          <strong>{source?.openaiVectorStore?.status || "unknown"}</strong>
          <small>
            {source?.openaiVectorStore?.name || source?.openaiVectorStore?.id || "No vector store detected"} ·{" "}
            {source?.openaiVectorStore?.fileCount ?? 0} files
          </small>
          <small>
            {source?.openaiVectorStore?.agentMemoryFileCount ?? 0} agent-memory files ·{" "}
            {source?.openaiVectorStore?.vectorOnlyAgentCount ?? 0} vector-only agents
          </small>
          <small>
            API key {source?.openaiVectorStore?.hasApiKey ? "found" : "missing"} · Store ID{" "}
            {source?.openaiVectorStore?.hasVectorStoreId ? "found" : "missing"}
            {source?.openaiVectorStore?.configSource ? ` · ${source.openaiVectorStore.configSource}` : ""}
          </small>
        </div>
      </section>

      <section className="agents-table-card">
        <div className="agents-toolbar">
          <label className="agents-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents, skills, domains..." />
          </label>
          {deepLinkNotice ? <span className="agents-warning" role="status">{deepLinkNotice}</span> : null}
          {source?.openaiVectorStore?.error ? <span className="agents-warning">{source.openaiVectorStore.error}</span> : null}
        </div>

        {error ? <div className="agents-error">{error}</div> : null}
        {loading ? (
          <div className="agents-loading"><Loader2 className="spin" size={18} /> Loading global agent memory...</div>
        ) : (
          <div className="agents-table-wrap">
            <table className="agents-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Project</th>
                  <th>Domain</th>
                  <th>Knowledge</th>
                  <th>Capabilities</th>
                  <th>Memory</th>
                  <th>Used</th>
                  <th>Efficiency</th>
                  <th>Vector status</th>
                  <th aria-label="Agent actions"></th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((agent) => {
                  const agentKey = `${agent.project}:${agent.id}:${agent.sourcePath}`;
                  const deleting = deletingAgentKey === agentKey;
                  return (
                  <tr key={`${agent.project}-${agent.id}-${agent.sourcePath}`} onClick={() => setSelectedAgent(agent)}>
                    <td>
                      <div className="agent-name-cell">
                        <AgentAvatar visual={agentVisualFromRecord(agent)} size="table" />
                        <div>
                          <strong>{agent.name}</strong>
                          <small>{agent.role}</small>
                        </div>
                      </div>
                    </td>
                    <td>{agent.project}</td>
                    <td>{agent.profile?.label || agent.domain}</td>
                    <td>
                      <p className="agent-knowledge-snippet">{agentKnowledgeText(agent)}</p>
                    </td>
                    <td>
                      <div className="agent-tags compact">
                        {(agent.capabilities || []).slice(0, 3).map((capability) => <span key={capability}>{capability}</span>)}
                      </div>
                    </td>
                    <td>
                      <span className={`memory-status ${hasAgentMemory(agent) ? "has-memory" : "no-memory"}`}>
                        {hasAgentMemory(agent) ? "Memory" : "No memory"}
                      </span>
                    </td>
                    <td>
                      <span className="agent-used-cell">
                        <strong>{agent.tokenEconomy?.totalRuns || agent.usageCount || 0}</strong>
                        <small>{agent.tokenEconomy?.lastRunAt ? shortDate(agent.tokenEconomy.lastRunAt) : "No recent run"}</small>
                      </span>
                    </td>
                    <td>
                      <span className={`agent-efficiency-pill ${scoreTone(agent.efficiency?.capability || 0)}`}>
                        {agent.efficiency?.capability || 0}/100
                      </span>
                    </td>
                    <td>
                      <span className={`vector-status ${agent.vector?.status === "completed" ? "confirmed" : "pending"}`}>
                        {vectorLabel(agent.vector)}
                      </span>
                    </td>
                    <td className="agent-row-action">
                      <button
                        className="agent-delete-button"
                        type="button"
                        disabled={deleting || agent.deletion?.allowed === false}
                        onClick={(event) => deleteAgent(agent, event)}
                        title={agent.deletion?.allowed === false ? agent.deletion.reason : `Delete ${agent.name} and memory`}
                        aria-label={`Delete ${agent.name} and memory`}
                      >
                        {deleting ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                      </button>
                    </td>
                  </tr>
                  );
                })}
                {!filteredAgents.length ? (
                  <tr>
                    <td colSpan="10" className="agents-empty">No agents matched this search.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AgentDetailModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
    </main>
  );
}

function SelfImprovementPanel() {
  const [status, setStatus] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [signals, setSignals] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [runLogs, setRunLogs] = useState([]);
  const [investigations, setInvestigations] = useState([]);
  const [researchLogs, setResearchLogs] = useState([]);
  const [toolPlans, setToolPlans] = useState([]);
  const [monetaryApprovals, setMonetaryApprovals] = useState([]);
  const [modelPool, setModelPool] = useState(null);
  const [systemDirection, setSystemDirection] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");

  async function loadSelfImprovement({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [statusRes, proposalsRes, signalsRes, patternsRes, runLogsRes, investigationsRes, researchLogsRes, toolPlansRes, approvalsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/self-improvement/status`),
        fetch(`${BACKEND_URL}/api/self-improvement/proposals?limit=8`),
        fetch(`${BACKEND_URL}/api/self-improvement/signals?limit=12`),
        fetch(`${BACKEND_URL}/api/self-improvement/patterns?limit=8`),
        fetch(`${BACKEND_URL}/api/self-improvement/run-logs?limit=8`),
        fetch(`${BACKEND_URL}/api/self-improvement/investigations?limit=10`),
        fetch(`${BACKEND_URL}/api/self-improvement/research-logs?limit=6`),
        fetch(`${BACKEND_URL}/api/self-improvement/tool-plans?limit=8`),
        fetch(`${BACKEND_URL}/api/self-improvement/monetary-approvals?limit=8`)
      ]);
      const [statusData, proposalsData, signalsData, patternsData, runLogsData, investigationsData, researchLogsData, toolPlansData, approvalsData] = await Promise.all([
        statusRes.json(),
        proposalsRes.json(),
        signalsRes.json(),
        patternsRes.json(),
        runLogsRes.json(),
        investigationsRes.json(),
        researchLogsRes.json(),
        toolPlansRes.json(),
        approvalsRes.json()
      ]);
      if (!statusRes.ok) throw new Error(statusData.error || "Self-improvement status unavailable.");
      if (!proposalsRes.ok) throw new Error(proposalsData.error || "Self-improvement proposals unavailable.");
      if (!signalsRes.ok) throw new Error(signalsData.error || "Self-improvement signals unavailable.");
      if (!patternsRes.ok) throw new Error(patternsData.error || "Self-improvement patterns unavailable.");
      if (!runLogsRes.ok) throw new Error(runLogsData.error || "Self-improvement run logs unavailable.");
      if (!investigationsRes.ok) throw new Error(investigationsData.error || "Self-improvement investigations unavailable.");
      if (!researchLogsRes.ok) throw new Error(researchLogsData.error || "Self-improvement research logs unavailable.");
      if (!toolPlansRes.ok) throw new Error(toolPlansData.error || "Self-improvement tool plans unavailable.");
      if (!approvalsRes.ok) throw new Error(approvalsData.error || "Self-improvement monetary approvals unavailable.");
      setStatus(statusData.selfImprovement || null);
      setModelPool(statusData.huggingFaceModelPool || null);
      setProposals(Array.isArray(proposalsData.proposals) ? proposalsData.proposals : []);
      setSignals(Array.isArray(signalsData.signals) ? signalsData.signals : []);
      setPatterns(Array.isArray(patternsData.patterns) ? patternsData.patterns : []);
      setRunLogs(Array.isArray(runLogsData.logs) ? runLogsData.logs : []);
      setInvestigations(Array.isArray(investigationsData.investigations) ? investigationsData.investigations : []);
      setResearchLogs(Array.isArray(researchLogsData.logs) ? researchLogsData.logs : []);
      setToolPlans(Array.isArray(toolPlansData.toolPlans) ? toolPlansData.toolPlans : []);
      setMonetaryApprovals(Array.isArray(approvalsData.approvals) ? approvalsData.approvals : []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function postSelfImprovementAction(action, body = {}) {
    setActionBusy(action);
    setError("");
    try {
      const res = await authFetch(`${BACKEND_URL}/api/self-improvement/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Self-improvement control action failed.");
      await loadSelfImprovement();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setActionBusy("");
    }
  }

  async function postMonetaryDecision(approvalId, decision) {
    setActionBusy(`${decision}:${approvalId}`);
    setError("");
    try {
      const res = await authFetch(`${BACKEND_URL}/api/self-improvement/monetary-approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Monetary approval action failed.");
      await loadSelfImprovement();
    } catch (decisionError) {
      setError(decisionError.message);
    } finally {
      setActionBusy("");
    }
  }

  async function submitSystemDirection(event) {
    event.preventDefault();
    const instruction = systemDirection.trim();
    if (instruction.length < 12) return;
    setActionBusy("system_direction");
    setError("");
    try {
      const res = await authFetch(`${BACKEND_URL}/api/self-improvement/system-instruction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, taskType: "Simple" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Self-improvement planner instruction failed.");
      setSystemDirection("");
      await loadSelfImprovement();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setActionBusy("");
    }
  }

  useEffect(() => {
    loadSelfImprovement();
    const timer = setInterval(() => loadSelfImprovement({ silent: true }), 15000);
    return () => clearInterval(timer);
  }, []);

  const latest = status?.latest || {};
  const latestSummary = latest.summary || {};
  const runSummary = selfImprovementRunSummary(status?.runIndicator || latest?.runIndicator || {});
  const topProposal = proposals[0];
  const activeCycle = latest.cycleId || latest.id || "No cycle";

  return (
    <section className="self-improvement-panel" aria-label="Self-improvement control plane">
      <header className="self-improvement-header">
        <div>
          <span className="eyebrow">Self-improvement</span>
          <h2>Control Plane</h2>
        </div>
        <div className="self-improvement-actions">
          <button className="ghost-action" onClick={loadSelfImprovement} disabled={loading || Boolean(actionBusy)}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            Refresh
          </button>
          <button className="ghost-action" onClick={() => postSelfImprovementAction("pause")} disabled={Boolean(actionBusy) || status?.paused}>
            {actionBusy === "pause" ? <Loader2 className="spin" size={16} /> : <Pause size={16} />}
            Pause
          </button>
          <button className="ghost-action" onClick={() => postSelfImprovementAction("resume")} disabled={Boolean(actionBusy) || !status?.paused}>
            {actionBusy === "resume" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            Resume
          </button>
          <button className="tool-action danger" onClick={() => postSelfImprovementAction("emergency_stop")} disabled={Boolean(actionBusy) || status?.emergencyStopped}>
            {actionBusy === "emergency_stop" ? <Loader2 className="spin" size={16} /> : <XCircle size={16} />}
            Stop
          </button>
        </div>
      </header>

      {error ? <div className="self-improvement-error">{error}</div> : null}

      <div className={`self-improvement-run-banner ${runSummary.running ? "running" : runSummary.blocked ? "blocked" : "ready"}`}>
        {runSummary.running ? <Loader2 className="spin" size={18} /> : <Activity size={18} />}
        <div>
          <strong>{runSummary.title}</strong>
          <span>{runSummary.detail}</span>
        </div>
      </div>

      <form className="self-improvement-direction" onSubmit={submitSystemDirection}>
        <div>
          <span>System direction</span>
          <strong>Self-improvement planner</strong>
        </div>
        <textarea
          value={systemDirection}
          onChange={(event) => setSystemDirection(event.target.value)}
          placeholder="Set the next direction for the whole PlutoniX system..."
          rows={4}
        />
        <button className="tool-action" type="submit" disabled={systemDirection.trim().length < 12 || Boolean(actionBusy)}>
          {actionBusy === "system_direction" ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
          Send
        </button>
      </form>

      <div className="self-improvement-grid">
        <article>
          <span>Mode</span>
          <strong>{status?.mode || "sandbox"}</strong>
          <small>{status?.status || "loading"} · {status?.scheduler || "scheduler unknown"}</small>
        </article>
        <article>
          <span>Latest cycle</span>
          <strong>{activeCycle}</strong>
          <small>{latest.status || "none"} · {latest.reason || latestSummary.reason || "no trigger"}</small>
        </article>
        <article>
          <span>Evidence</span>
          <strong>{compactNumber(investigations.length)} event checks</strong>
          <small>{compactNumber(signals.length)} signals · {compactNumber(patterns.length)} patterns</small>
        </article>
        <article>
          <span>Proposals</span>
          <strong>{compactNumber(proposals.length)}</strong>
          <small>{topProposal ? `${topProposal.riskLevel || "unknown"} risk · ${topProposal.status || "proposed"}` : "none recorded"}</small>
        </article>
        <article>
          <span>Tools</span>
          <strong>{compactNumber(toolPlans.length)} plans</strong>
          <small>{compactNumber(monetaryApprovals.filter((row) => row.status === "pending").length)} cost approvals pending</small>
        </article>
        <article>
          <span>HF model pool</span>
          <strong>{compactNumber(modelPool?.downloaded || 0)} local</strong>
          <small>{compactNumber(modelPool?.planned || 0)} planned · {compactNumber(modelPool?.services || 0)} services</small>
        </article>
      </div>

      <div className="self-improvement-lists">
        <section>
          <h3>Recent proposals</h3>
          {proposals.length ? (
            <ol>
              {proposals.slice(0, 4).map((proposal) => (
                <li key={proposal.id}>
                  <strong>{proposal.title}</strong>
                  <span>{proposal.category} · {proposal.riskLevel} · {proposal.status}{proposal.occurrenceCount > 1 ? ` · seen ${proposal.occurrenceCount}×` : ""}</span>
                  <small>{proposal.expectedBenefit || proposal.problem}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No proposals recorded.</p>
          )}
        </section>
        <section>
          <h3>Signal patterns</h3>
          {patterns.length ? (
            <ol>
              {patterns.slice(0, 4).map((pattern) => (
                <li key={pattern.id}>
                  <strong>{displayEventType(pattern.component || pattern.kind || "pattern")}</strong>
                  <span>{pattern.signalCount || 0} signals · confidence {Math.round(Number(pattern.confidence || 0) * 100)}%{pattern.occurrenceCount > 1 ? ` · observed ${pattern.occurrenceCount}×` : ""}</span>
                  <small>{pattern.summary || shortDate(pattern.timestamp)}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No repeated patterns above threshold.</p>
          )}
        </section>
        <section>
          <h3>Investigator</h3>
          {investigations.length ? (
            <ol>
              {investigations.slice(0, 5).map((row) => (
                <li key={row.id}>
                  <strong>{row.shouldTrigger ? "Problem statement sent" : "Event checked"}</strong>
                  <span>{displayEventType(row.component || "runtime")} · score {Math.round(Number(row.qualityScore || 0) * 100)}% · {shortDate(row.timestamp)}{row.occurrenceCount > 1 ? ` · ${row.occurrenceCount} events consolidated` : ""}</span>
                  <small>{row.problemStatement || row.eventExcerpt || row.recommendedAction}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No investigator checks recorded yet.</p>
          )}
        </section>
        <section>
          <h3>Research budget</h3>
          {researchLogs.length ? (
            <ol>
              {researchLogs.slice(0, 4).map((row) => (
                <li key={row.id}>
                  <strong>{displayEventType(row.status || "research")}</strong>
                  <span>{row.reason || "research check"} · {shortDate(row.timestamp)}</span>
                  <small>{row.budget?.estimatedUsage?.modelCalls || 0} calls · {row.budget?.estimatedUsage?.tokens || 0} tokens · ${Number(row.budget?.estimatedUsage?.estimatedUsd || 0).toFixed(2)}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No market or research exploration recorded yet.</p>
          )}
        </section>
        <section>
          <h3>Tool plans</h3>
          {toolPlans.length ? (
            <ol>
              {toolPlans.slice(0, 4).map((row) => (
                <li key={row.id}>
                  <strong>{row.proposedTool?.name || displayEventType(row.solutionKind || "tool plan")}</strong>
                  <span>{displayEventType(row.status)} · {displayEventType(row.solutionKind)} · {shortDate(row.timestamp)}</span>
                  <small>{row.problemStatement || row.proposedTool?.capability}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No generated tool or optimization plans recorded yet.</p>
          )}
        </section>
        <section>
          <h3>Cost approvals</h3>
          {monetaryApprovals.length ? (
            <ol>
              {monetaryApprovals.slice(0, 4).map((row) => (
                <li key={row.id}>
                  <strong>{displayEventType(row.status)} · ${Number(row.costEstimate?.estimatedUsd || 0).toFixed(2)}</strong>
                  <span>{displayEventType(row.solutionKind)} · {shortDate(row.timestamp)}</span>
                  <small>{row.approvalPrompt || row.problemStatement}</small>
                  {row.status === "pending" ? (
                    <div className="inline-actions">
                      <button className="ghost-action" onClick={() => postMonetaryDecision(row.id, "approve")} disabled={Boolean(actionBusy)}>
                        {actionBusy === `approve:${row.id}` ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}
                        Accept
                      </button>
                      <button className="ghost-action" onClick={() => postMonetaryDecision(row.id, "cheaper_solution")} disabled={Boolean(actionBusy)}>
                        {actionBusy === `cheaper_solution:${row.id}` ? <Loader2 className="spin" size={14} /> : <Gauge size={14} />}
                        Cheaper
                      </button>
                      <button className="ghost-action" onClick={() => postMonetaryDecision(row.id, "reject")} disabled={Boolean(actionBusy)}>
                        {actionBusy === `reject:${row.id}` ? <Loader2 className="spin" size={14} /> : <XCircle size={14} />}
                        Reject
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p>No paid tool approvals waiting.</p>
          )}
        </section>
        <section>
          <h3>Run logs</h3>
          {runLogs.length ? (
            <ol>
              {runLogs.slice(0, 5).map((row) => (
                <li key={row.id}>
                  <strong>{displayEventType(row.phase || row.state)}</strong>
                  <span>{row.state} · {row.reason || "event-driven"} · {shortDate(row.timestamp)}</span>
                  <small>{row.message || row.error || row.cycleId}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No self-improvement run logs recorded yet.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function trimDecisionCanvasText(value, max = 42) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
}

function decisionCanvasLines(value, max = 21) {
  const words = String(value || "Recorded branch").replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > max && line) {
      lines.push(line);
      line = word;
      continue;
    }
    line = candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["Recorded branch"];
}

function decisionLandscapeState(kind, branch = null) {
  if (kind === "dormant" && decisionBranchProjectionState(branch || {}) === "rejected") return "REJECTED";
  return ({ current: "CURRENT", possibility: "OPTION", anticipated: "ANTICIPATED", anticipated_rejected: "ANTICIPATED NO", dormant: "DORMANT", record: "RECORD", stage: "REVIEW" })[kind] || "RECORD";
}

function DecisionInspectorLabel({ icon: Icon, children, tone = "violet" }) {
  return <dt><span className={`decision-inspector-icon ${tone}`} aria-hidden="true"><Icon size={12} /></span><span>{children}</span></dt>;
}

function DecisionBranchInspector({
  selectedBranch,
  selectedBranchSignal,
  selectedFunctionality,
  selectedObjective,
  selectedDecisionRecord,
  selectedFunctionalityId = "",
  selectedAssignment,
  onResetFocus,
  className = ""
}) {
  return (
    <aside className={`decision-workshop-inspector ${className}`.trim()} aria-live="polite">
      <header><span className="eyebrow">Decision path</span><span className={`decision-status ${selectedBranch?.status || ""}`}>{selectedBranch ? decisionBranchStateLabel(selectedBranch) : "No selection"}</span></header>
      {selectedBranch ? <>
        <h3>{selectedBranch.objective?.summary || selectedBranch.id}</h3>
        <p>{selectedDecisionRecord?.reason || selectedBranch.candidate?.decisionRationale || selectedBranch.disposition?.reason || "This branch is retained with its recorded provenance for governed comparison."}</p>
        <dl>
          <div><DecisionInspectorLabel icon={GitBranch} tone="teal">Project objective</DecisionInspectorLabel><dd>{selectedObjective?.label || "Objective grouping is unavailable for this recorded branch"}</dd></div>
          <div><DecisionInspectorLabel icon={Code2}>Functionality</DecisionInspectorLabel><dd>{selectedFunctionality?.label || (selectedFunctionalityId ? `Source function ${selectedFunctionalityId}` : "Ledger record without a discovered function")}{selectedFunctionality?.category ? ` · ${selectedFunctionality.category}` : ""}</dd></div>
          <div><DecisionInspectorLabel icon={Bot} tone="blue">Assigned agent</DecisionInspectorLabel><dd>{selectedAssignment ? `${selectedAssignment.agentId} · ${selectedAssignment.assignment} ownership` : "No project analysis assignment recorded"}</dd></div>
          <div><DecisionInspectorLabel icon={Network} tone="teal">Interpretation</DecisionInspectorLabel><dd>{selectedBranchSignal?.label}</dd></div>
          <div><DecisionInspectorLabel icon={FileCode2} tone="amber">Evidence</DecisionInspectorLabel><dd>{selectedBranchSignal?.evidenceCount || 0} immutable references</dd></div>
          <div><DecisionInspectorLabel icon={GitBranch} tone="violet">Lineage</DecisionInspectorLabel><dd>{selectedBranch.parentBranchId ? `Child of ${selectedBranch.parentBranchId}` : "Directly connected to project genesis"}</dd></div>
          <div><DecisionInspectorLabel icon={ShieldCheck} tone="green">Future use</DecisionInspectorLabel><dd>{selectedBranchSignal?.disabled ? (selectedBranchSignal.revisitEligible ? "May be reconsidered under governed conditions" : "Preserved as disabled provenance") : selectedBranch.autoReconsideration ? "Eligible for governed reconsideration" : "Recorded; no automatic reconsideration"}</dd></div>
        </dl>
        {selectedBranch.evidence?.length ? (
          <div className="decision-workshop-inspector-evidence">
            <span className="eyebrow decision-inspector-evidence-title"><span className="decision-inspector-icon amber" aria-hidden="true"><FileCode2 size={12} /></span>Cited source provenance</span>
            <ul>
              {selectedBranch.evidence.slice(0, 4).map((evidence) => <li key={evidence.id || evidence.reference}><code>{evidence.reference || evidence.id}</code><span>{evidence.source || "recorded source"}</span></li>)}
            </ul>
          </div>
        ) : null}
        {selectedFunctionality?.features?.length ? (
          <div className="decision-workshop-inspector-evidence">
            <span className="eyebrow decision-inspector-evidence-title"><span className="decision-inspector-icon violet" aria-hidden="true"><Code2 size={12} /></span>Coordinated features</span>
            <ul>
              {selectedFunctionality.features.slice(0, 5).map((feature) => <li key={feature.id}><code>{feature.entityType || feature.category || "feature"}</code><span>{feature.label}</span></li>)}
            </ul>
          </div>
        ) : null}
        <button type="button" className="ghost-action" onClick={onResetFocus}>Use default focus</button>
      </> : <p>Select any path in the tree or review queue to inspect its provenance.</p>}
    </aside>
  );
}

function DecisionBranchTreeCanvas({
  project,
  branches = [],
  analysisReport = null,
  decisionGraph = null,
  selectedBranchId = "",
  selectedBranch = null,
  selectedBranchSignal = null,
  selectedFunctionality = null,
  selectedObjective = null,
  selectedDecisionRecord = null,
  selectedFunctionalityId = "",
  selectedAssignment = null,
  assignments = [],
  onSelectBranch,
  onResetFocus,
  onAnalyze,
  analyzing = false,
  analysisStatus = ""
}) {
  const svgRef = useRef(null);
  const canvasRef = useRef(null);
  const zoomInteractionRef = useRef(null);
  const zoomTransformRef = useRef(d3.zoomIdentity);
  const zoomProjectRef = useRef("");
  const landscape = useMemo(
    () => buildDecisionTimelineFlow({
      projectId: project?.id || "",
      projectName: project?.name || "Project",
      branches,
      analysisReport,
      graph: decisionGraph,
      assignments
    }),
    [analysisReport, assignments, branches, decisionGraph, project?.id, project?.name]
  );
  const selectedLineageIds = useMemo(
    () => decisionBranchLineageIds(branches, selectedBranchId),
    [branches, selectedBranchId]
  );
  const adjustCanvasZoom = (factor) => {
    const interaction = zoomInteractionRef.current;
    if (!interaction) return;
    interaction.svg.transition().duration(150).call(interaction.zoom.scaleBy, factor);
  };
  const resetCanvasZoom = () => {
    const interaction = zoomInteractionRef.current;
    if (!interaction) return;
    interaction.svg.transition().duration(170).call(interaction.zoom.transform, d3.zoomIdentity);
  };

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !landscape.branchCount) return undefined;
    const projectId = String(project?.id || "");
    if (zoomProjectRef.current !== projectId) {
      zoomProjectRef.current = projectId;
      zoomTransformRef.current = d3.zoomIdentity;
    }
    const { width, height } = landscape.canvas;
    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", width).attr("height", height);
    const baseTransform = zoomTransformRef.current;
    const viewport = svg.append("g").attr("class", "decision-branch-landscape-viewport").attr("transform", baseTransform);
    const graph = viewport.append("g");
    const dimUnrelated = Boolean(selectedBranchId);
    const isLineage = (branchId) => selectedLineageIds.has(branchId);
    const nodeLineageId = (datum) => datum.branchId || datum.lineageBranchId || "";
    const functionalityHasSelectedLineage = (functionalityId) => landscape.nodes.some((node) => node.functionalityId === functionalityId && isLineage(node.branchId));

    const zones = graph.append("g").attr("class", "decision-branch-landscape-zones");
    const zone = zones.selectAll("g")
      .data(landscape.zones)
      .join("g")
      .attr("class", (datum) => `decision-branch-landscape-zone ${datum.tone} ${dimUnrelated && !landscape.nodes.some((node) => node.zoneId === datum.id && isLineage(node.branchId)) ? "muted" : ""}`)
      .attr("transform", (datum) => `translate(${datum.x},${datum.y})`);
    zone.append("rect")
      .attr("class", "decision-branch-landscape-zone-frame")
      .attr("width", (datum) => datum.width)
      .attr("height", (datum) => datum.height)
      .attr("rx", 28);
    zone.append("path")
      .attr("class", "decision-branch-landscape-zone-corner")
      .attr("d", (datum) => `M25,0 H${Math.max(25, datum.width - 76)} L${Math.max(25, datum.width - 48)},28 H${datum.width - 25}`);
    zone.append("text")
      .attr("class", "decision-branch-landscape-zone-type")
      .attr("x", 25)
      .attr("y", 29)
      .text((datum) => `${datum.glyph} · ${datum.categoryLabel}`.toUpperCase());
    zone.append("text")
      .attr("class", "decision-branch-landscape-zone-label")
      .attr("x", 25)
      .attr("y", 50)
      .text((datum) => trimDecisionCanvasText(datum.label, 40));
    zone.append("text")
      .attr("class", "decision-branch-landscape-zone-detail")
      .attr("x", 25)
      .attr("y", 69)
      .text((datum) => datum.timelineLabel || `${datum.branchCount} record${datum.branchCount === 1 ? "" : "s"} · ${datum.evidenceCount} cited source${datum.evidenceCount === 1 ? "" : "s"}`);

    const zoneById = new Map(landscape.zones.map((zoneItem) => [zoneItem.id, zoneItem]));
    const route = (link) => {
      if (landscape.layout === "timeline") {
        const sourceX = link.source.x + link.source.radius;
        const targetX = link.target.x - link.target.radius;
        const shoulder = Math.max(52, Math.abs(targetX - sourceX) * 0.42);
        return `M${sourceX},${link.source.y} C${sourceX + shoulder},${link.source.y} ${targetX - shoulder},${link.target.y} ${targetX},${link.target.y}`;
      }
      if (link.kind === "genesis") {
        const targetZone = zoneById.get(link.target.zoneId);
        if (targetZone) {
          const sourceY = link.source.y + link.source.radius;
          const railX = targetZone.x + targetZone.width - 18;
          const targetX = link.target.x + link.target.radius;
          const approachY = link.target.y;
          const outerY = Math.max(sourceY + 36, targetZone.y - 26);
          return `M${link.source.x},${sourceY} C${link.source.x},${outerY} ${railX},${outerY} ${railX},${targetZone.y - 8} L${railX},${approachY} C${railX},${approachY} ${targetX + 18},${approachY} ${targetX},${approachY}`;
        }
      }
      const sourceY = link.source.y + link.source.radius;
      const targetY = link.target.y - link.target.radius;
      const shoulder = Math.max(42, Math.abs(targetY - sourceY) * 0.42);
      return `M${link.source.x},${sourceY} C${link.source.x},${sourceY + shoulder} ${link.target.x},${targetY - shoulder} ${link.target.x},${targetY}`;
    };
    const links = graph.append("g").attr("class", "decision-branch-landscape-links");
    links.selectAll("path")
      .data(landscape.links)
      .join("path")
      .attr("class", (link) => [
        "decision-branch-landscape-link",
        link.kind,
        link.disabled ? "disabled" : "",
        link.visualKind || "record",
        selectedBranchId && (link.targetBranchId === selectedBranchId || link.sourceBranchId === selectedBranchId) ? "selected-path" : "",
        dimUnrelated && !isLineage(link.targetBranchId) ? "muted" : ""
      ].filter(Boolean).join(" "))
      .attr("d", route);

    const assignmentLinks = graph.append("g").attr("class", "decision-branch-landscape-assignment-links");
    assignmentLinks.selectAll("path")
      .data(landscape.agentLinks || [])
      .join("path")
      .attr("class", (link) => [
        "decision-branch-landscape-link",
        "decision-agent-assignment-link",
        dimUnrelated && !isLineage(link.targetBranchId) ? "muted" : ""
      ].filter(Boolean).join(" "))
      .attr("d", route);

    const genesis = graph.append("g")
      .attr("class", "decision-branch-landscape-genesis")
      .attr("transform", `translate(${landscape.genesis.x},${landscape.genesis.y})`);
    genesis.append("circle").attr("class", "decision-branch-landscape-genesis-orbit").attr("r", landscape.genesis.radius + 11);
    genesis.append("circle").attr("class", "decision-branch-landscape-genesis-core").attr("r", landscape.genesis.radius);
    genesis.append("text").attr("class", "decision-branch-landscape-genesis-label").attr("text-anchor", "middle").attr("y", -4).text(landscape.layout === "timeline" ? "TIMELINE" : "GENESIS");
    genesis.append("text").attr("class", "decision-branch-landscape-genesis-detail").attr("text-anchor", "middle").attr("y", 14).text(landscape.layout === "timeline" ? `${landscape.knownCount} known · ${landscape.anticipatedCount} anticipated` : `${landscape.branchCount} records`);

    const node = graph.append("g")
      .attr("class", "decision-branch-landscape-nodes")
      .selectAll("g")
      .data(landscape.nodes)
      .join("g")
      .attr("class", (datum) => [
        "decision-branch-landscape-node",
        datum.visualKind || "record",
        datum.signal?.level || "reference",
        datum.signal?.disabled ? "disabled" : "",
        datum.timelineKind || "",
        datum.branchId === selectedBranchId ? "selected" : "",
        datum.kind === "deferred-review-stage" ? "stage" : "",
        dimUnrelated && !isLineage(nodeLineageId(datum)) ? "muted" : ""
      ].filter(Boolean).join(" "))
      .attr("transform", (datum) => `translate(${datum.x},${datum.y})`)
      .attr("tabindex", (datum) => datum.kind === "deferred-review-stage" ? -1 : 0)
      .attr("role", (datum) => datum.kind === "deferred-review-stage" ? "img" : "button")
      .attr("aria-label", (datum) => datum.kind === "deferred-review-stage"
        ? `${datum.label}: ${datum.detail}. Visual-only; this is not a decision ledger record.`
        : `${datum.label}, ${decisionBranchStateLabel(datum.branch)}. ${datum.timelineLabel || `${datum.signal?.evidenceCount || 0} cited source references.`}`)
      .on("pointerdown", (event, datum) => {
        if (datum.branchId) event.stopPropagation();
      })
      .on("click", (event, datum) => {
        event.stopPropagation();
        if (datum.branchId) onSelectBranch?.(datum.branchId);
      })
      .on("keydown", (event, datum) => {
        if (!datum.branchId) return;
        if (!["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        onSelectBranch?.(datum.branchId);
      });
    node.append("circle").attr("class", "decision-branch-landscape-node-aura").attr("r", (datum) => datum.radius + 7);
    node.append("circle").attr("class", "decision-branch-landscape-node-core").attr("r", (datum) => datum.radius);
    node.append("circle").attr("class", "decision-branch-landscape-node-evidence-ring").attr("r", (datum) => Math.max(13, datum.radius - 7));
    node.append("text").attr("class", "decision-branch-landscape-node-glyph").attr("text-anchor", "middle").attr("y", -5).text((datum) => datum.glyph);
    node.append("text").attr("class", "decision-branch-landscape-node-state").attr("text-anchor", "middle").attr("y", 13).text((datum) => decisionLandscapeState(datum.visualKind, datum.branch));
    const nodeLabel = node.append("text")
      .attr("class", "decision-branch-landscape-node-label")
      .attr("text-anchor", "middle")
      .attr("y", (datum) => datum.radius + 17);
    nodeLabel.each(function renderLabel(datum) {
      const label = d3.select(this);
      decisionCanvasLines(datum.label, 21).slice(0, 2).forEach((line, index) => {
        label.append("tspan").attr("x", 0).attr("dy", index ? 13 : 0).text(line);
      });
    });
    node.append("text")
      .attr("class", "decision-branch-landscape-node-detail")
      .attr("text-anchor", "middle")
      .attr("y", (datum) => datum.radius + 17 + Math.min(2, decisionCanvasLines(datum.label, 21).length) * 13 + 3)
      .text((datum) => datum.kind === "deferred-review-stage" ? datum.detail : datum.timelineLabel || `${datum.signal?.evidenceCount || 0} cited · ${datum.signal?.childCount || 0} linked`);

    const agentNode = graph.append("g")
      .attr("class", "decision-branch-landscape-agent-nodes")
      .selectAll("g")
      .data(landscape.agentNodes || [])
      .join("g")
      .attr("class", (datum) => [
        "decision-branch-landscape-agent-node",
        datum.associationBasis || "analysis-assignment",
        dimUnrelated && !functionalityHasSelectedLineage(datum.functionalityId) ? "muted" : ""
      ].filter(Boolean).join(" "))
      .attr("transform", (datum) => `translate(${datum.x},${datum.y})`)
      .attr("tabindex", 0)
      .attr("role", "img")
      .attr("aria-label", (datum) => `${datum.label}, analysis assignment to ${datum.functionalityLabel}. This is not recorded topology ownership or a historical decision event.`);
    agentNode.append("circle").attr("class", "decision-branch-landscape-agent-node-aura").attr("r", (datum) => datum.radius + 6);
    agentNode.append("circle").attr("class", "decision-branch-landscape-agent-node-core").attr("r", (datum) => datum.radius);
    agentNode.append("text").attr("class", "decision-branch-landscape-agent-node-glyph").attr("text-anchor", "middle").attr("y", -3).text("AGT");
    agentNode.append("text").attr("class", "decision-branch-landscape-agent-node-state").attr("text-anchor", "middle").attr("y", 8).text("ASSIGNED");
    const agentNodeLabel = agentNode.append("text")
      .attr("class", "decision-branch-landscape-agent-node-label")
      .attr("text-anchor", "middle")
      .attr("y", (datum) => datum.radius + 15);
    agentNodeLabel.each(function renderAgentLabel(datum) {
      const label = d3.select(this);
      decisionCanvasLines(datum.label, 19).slice(0, 2).forEach((line, index) => {
        label.append("tspan").attr("x", 0).attr("dy", index ? 12 : 0).text(line);
      });
    });
    agentNode.append("text")
      .attr("class", "decision-branch-landscape-agent-node-detail")
      .attr("text-anchor", "middle")
      .attr("y", (datum) => datum.radius + 15 + Math.min(2, decisionCanvasLines(datum.label, 19).length) * 12 + 3)
      .text("Analysis assignment");
    const zoom = d3.zoom()
      .scaleExtent([0.35, 3.1])
      .filter((event) => {
        if (event.type === "dblclick") return false;
        if (event.type === "wheel") return true;
        return !event.target?.closest?.(".decision-branch-landscape-node, .decision-branch-landscape-agent-node");
      })
      .on("zoom", (event) => {
        zoomTransformRef.current = event.transform;
        viewport.attr("transform", event.transform);
      });
    zoomInteractionRef.current = { svg, zoom };
    svg.call(zoom).call(zoom.transform, baseTransform).on("dblclick.zoom", null);
    return () => {
      if (zoomInteractionRef.current?.svg?.node() === svgElement) zoomInteractionRef.current = null;
      svg.on(".zoom", null);
      svg.selectAll("*").remove();
    };
  }, [landscape, onSelectBranch, project?.id, selectedBranchId, selectedLineageIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !landscape.branchCount) return undefined;
    const svg = svgRef.current;
    const initial = () => {
      const visibleWidth = canvas.clientWidth || 0;
      const graphWidth = Number(svg?.getAttribute("width") || 0);
      if (visibleWidth && graphWidth > visibleWidth) canvas.scrollLeft = 0;
    };
    const frame = window.requestAnimationFrame(initial);
    return () => window.cancelAnimationFrame(frame);
  }, [landscape.branchCount]);

  if (!landscape.branchCount) {
    return (
      <section className="decision-branch-tree decision-branch-tree-empty" aria-label="Architecture branch discovery">
        <div className="decision-branch-tree-empty-content">
          <span className="decision-branch-tree-empty-icon" aria-hidden="true"><GitBranch size={23} /></span>
          <span className="decision-workshop-eyebrow">Architecture discovery</span>
          <h3>Map this project’s decision space</h3>
          <p>
            Analyze the managed project to create a cited map of its current implementation,
            future possibilities, and dormant provenance. Nothing is changed in the project code.
          </p>
          {onAnalyze ? (
            <button className="ghost-action decision-analyze-empty-action" type="button" onClick={onAnalyze} disabled={analyzing}>
              {analyzing ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
              {analyzing ? "Analyzing architecture…" : "Analyze architecture branches"}
            </button>
          ) : null}
          {analysisStatus ? <span className="decision-analysis-status">{analysisStatus}</span> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="decision-branch-tree" aria-label={`${project?.name || "Project"} branch tree workshop`}>
      <header>
        <div>
          <span className="eyebrow">Decision workshop · project-only</span>
          <h3>Decision timeline &amp; flow</h3>
          <p>Each lane follows a major functionality through its recorded decision paths. Known ledger events set the sequence; where no sequence is recorded, PlutoniX shows an explicitly anticipated order without treating it as historical fact.</p>
        </div>
        <div className="decision-branch-tree-counts">
          <span>{landscape.functionalityCount} major functions</span>
          <span>{landscape.knownCount || 0} known sequence steps</span>
          <span>{landscape.anticipatedCount || 0} anticipated steps</span>
          <span>{landscape.activeCount} live records</span>
          {landscape.agentNodeCount ? <span>{landscape.agentNodeCount} analysis agent node{landscape.agentNodeCount === 1 ? "" : "s"}</span> : null}
          {landscape.recordedRejectedCount ? <span className="disabled">{landscape.recordedRejectedCount} recorded rejected</span> : null}
          <span className={landscape.disabledCount ? "disabled" : ""}>{landscape.disabledCount} dormant provenance</span>
          {landscape.deferredReviewStageCount ? <span>{landscape.deferredReviewStageCount} impact review stage{landscape.deferredReviewStageCount === 1 ? "" : "s"}</span> : null}
        </div>
      </header>
      <div className="decision-branch-tree-legend" aria-label="Branch tree legend">
        <span><i className="genesis" />Timeline origin</span>
        <span><i className="current" />Observed current</span>
        <span><i className="possibility" />Future possibility</span>
        <span><i className="anticipated" />Anticipated alternative</span>
        <span><i className="anticipated-rejected" />Anticipated rejection</span>
        <span><i className="analysis-agent" />Analysis assignment node</span>
        <span><i className="disabled" />Recorded rejected / dormant</span>
        <small>Each bordered zone is a project objective, with one horizontal lane per major functionality. Solid left-to-right flow follows known ledger sequence; nodes labelled Anticipated are ordered only from the recorded path shape and remain non-authoritative. Agent nodes are explicit analysis assignments, not recorded ownership. Drag to explore · scroll to zoom · use Reset to recenter.</small>
      </div>
      <div className="decision-branch-landscape-workspace">
        <DecisionBranchInspector
          className="decision-branch-landscape-inspector"
          selectedBranch={selectedBranch}
          selectedBranchSignal={selectedBranchSignal}
          selectedFunctionality={selectedFunctionality}
          selectedObjective={selectedObjective}
          selectedDecisionRecord={selectedDecisionRecord}
          selectedFunctionalityId={selectedFunctionalityId}
          selectedAssignment={selectedAssignment}
          onResetFocus={onResetFocus}
        />
        <div ref={canvasRef} className="decision-branch-tree-canvas decision-branch-landscape-canvas" tabIndex="0" aria-label="Draggable project decision timeline canvas">
          <div className="decision-branch-landscape-controls" aria-label="Canvas controls">
            <button type="button" onClick={() => adjustCanvasZoom(1.22)} aria-label="Zoom in branch canvas" title="Zoom in">+</button>
            <button type="button" onClick={() => adjustCanvasZoom(0.82)} aria-label="Zoom out branch canvas" title="Zoom out">−</button>
            <button type="button" className="reset" onClick={resetCanvasZoom} aria-label="Reset branch canvas view" title="Reset view">Reset</button>
          </div>
          <svg ref={svgRef} aria-label={`${project?.name || "Project"} decision timeline flowchart`} />
        </div>
      </div>
    </section>
  );
}

function DecisionContinuityPanel({
  selectedProject = null,
  onAnalyzeArchitecture,
  analyzingArchitecture = false,
  architectureAnalysisStatus = "",
  architectureAnalysisRevision = "",
  architectureAnalysisReport = null
}) {
  const [branches, setBranches] = useState([]);
  const [reconsiderations, setReconsiderations] = useState([]);
  const [qagentRuns, setQagentRuns] = useState([]);
  const [qagentMetrics, setQagentMetrics] = useState(null);
  const [qagentFeature, setQagentFeature] = useState(null);
  const [brainx, setBrainx] = useState(null);
  const [suggestionGovernance, setSuggestionGovernance] = useState(null);
  const [graph, setGraph] = useState(null);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasSelectedManagedProject = Boolean(selectedProject && !selectedProject.isDefault);
  const workspaceQuery = hasSelectedManagedProject
    ? `?workspaceId=${encodeURIComponent(selectedProject.id)}`
    : "";

  async function loadDecisionContinuity({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError("");
    if (!hasSelectedManagedProject) {
      setBranches([]);
      setReconsiderations([]);
      setQagentRuns([]);
      setQagentMetrics(null);
      setQagentFeature(null);
      setGraph(null);
      setBrainx(null);
      setSuggestionGovernance(null);
      setLoading(false);
      return;
    }
    try {
      const [branchesRes, reconsiderationsRes, qagentRes, graphRes, brainxRes, suggestionsRes] = await Promise.all([
        authFetch(`${BACKEND_URL}/api/decision-continuity/branches?limit=250${workspaceQuery ? `&workspaceId=${encodeURIComponent(selectedProject.id)}` : ""}`),
        authFetch(`${BACKEND_URL}/api/decision-continuity/reconsiderations?limit=16${workspaceQuery ? `&workspaceId=${encodeURIComponent(selectedProject.id)}` : ""}`),
        authFetch(`${BACKEND_URL}/api/decision-continuity/qagent-runs?limit=16${workspaceQuery ? `&workspaceId=${encodeURIComponent(selectedProject.id)}` : ""}`),
        authFetch(`${BACKEND_URL}/api/decision-continuity/graph${workspaceQuery}`),
        authFetch(`${BACKEND_URL}/api/brainx/overview`),
        authFetch(`${BACKEND_URL}/api/suggestions/overview`)
      ]);
      const [branchData, reconsiderationData, qagentData, graphData, brainxData, suggestionsData] = await Promise.all([branchesRes.json(), reconsiderationsRes.json(), qagentRes.json(), graphRes.json(), brainxRes.json(), suggestionsRes.json()]);
      if (!branchesRes.ok) throw new Error(branchData.error || "Decision branches are unavailable.");
      if (!reconsiderationsRes.ok) throw new Error(reconsiderationData.error || "Reconsideration records are unavailable.");
      if (!qagentRes.ok) throw new Error(qagentData.error || "QAgent investigation records are unavailable.");
      if (!graphRes.ok) throw new Error(graphData.error || "Decision continuity graph is unavailable.");
      setBranches(Array.isArray(branchData.branches) ? branchData.branches : []);
      setReconsiderations(Array.isArray(reconsiderationData.reconsiderations) ? reconsiderationData.reconsiderations : []);
      setQagentRuns(Array.isArray(qagentData.qagentRuns) ? qagentData.qagentRuns : []);
      setQagentMetrics(qagentData.qagentMetrics || null);
      setQagentFeature(qagentData.feature || null);
      setGraph(graphData.graph || null);
      // BrainX has its own least-privilege read scope. A user who can see the
      // branch ledger but not model-governance metadata still gets the ledger.
      setBrainx(brainxRes.ok ? brainxData : null);
      setSuggestionGovernance(suggestionsRes.ok ? suggestionsData : null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSelectedBranchId("");
    loadDecisionContinuity();
    const timer = setInterval(() => loadDecisionContinuity({ silent: true }), 20000);
    return () => clearInterval(timer);
  }, [architectureAnalysisRevision, hasSelectedManagedProject, selectedProject?.id]);

  // The application summary merges source-derived alternatives with the
  // authoritative ledger, retaining the ledger as the winner for duplicate
  // branch IDs. The tree therefore shows deferred/rejected outcomes wherever
  // they exist and source alternatives only as explicitly anticipated nodes.
  const timelineDecisionSummary = useMemo(
    () => applicationDecisionSummary({
      architectureAnalysisReport,
      branches,
      reconsiderations,
      decisionGraph: graph,
      project: selectedProject
    }),
    [architectureAnalysisReport, branches, graph, reconsiderations, selectedProject]
  );
  const objectiveLedger = useMemo(
    () => buildDecisionObjectiveLedger({ analysisReport: architectureAnalysisReport, branches: timelineDecisionSummary.branchRows }),
    [architectureAnalysisReport, timelineDecisionSummary.branchRows]
  );
  const displayedBranches = objectiveLedger.decisionBranches;
  const branchCountByStatus = useMemo(() => displayedBranches.reduce((counts, branch) => {
    counts[branch.status] = (counts[branch.status] || 0) + 1;
    return counts;
  }, {}), [displayedBranches]);
  const deferred = displayedBranches.filter((branch) => ["deferred", "reconsidering"].includes(branch.status));
  const selected = displayedBranches.filter((branch) => branch.status === "selected");
  const disabledBranches = displayedBranches.filter(isDisabledDecisionBranch);
  const workshop = useMemo(() => decisionBranchWorkshopSummary(displayedBranches), [displayedBranches]);
  const resolvedSelectedBranchId = selectedBranchId || workshop.reviewQueue[0]?.branch?.id || workshop.dormantQueue[0]?.branch?.id || "";
  const selectedBranch = displayedBranches.find((branch) => branch.id === resolvedSelectedBranchId) || null;
  const functionalityById = useMemo(
    () => new Map((architectureAnalysisReport?.majorFunctionalities?.length ? architectureAnalysisReport.majorFunctionalities : architectureAnalysisReport?.functionalities || []).filter((item) => item?.id).map((item) => [item.id, item])),
    [architectureAnalysisReport]
  );
  const assignmentByFunctionalityId = useMemo(
    () => new Map((architectureAnalysisReport?.assignments || []).filter((item) => item?.functionalityId).map((item) => [item.functionalityId, item])),
    [architectureAnalysisReport]
  );
  const selectedFunctionalityId = String(selectedBranch?.candidate?.functionalityId || selectedBranch?.functionalityId || "").trim();
  const selectedFunctionality = functionalityById.get(selectedFunctionalityId) || null;
  const selectedObjective = (architectureAnalysisReport?.objectives || []).find((item) => item.id === selectedFunctionality?.objectiveId) || null;
  const selectedDecisionRecord = objectiveLedger.functionalities
    .find((item) => item.functionality.id === selectedFunctionalityId)?.alternatives
    .find((item) => item.branch.id === selectedBranch?.id)
    || (objectiveLedger.functionalities.find((item) => item.functionality.id === selectedFunctionalityId)?.selectedPath?.branch?.id === selectedBranch?.id
      ? { branch: selectedBranch, reason: objectiveLedger.functionalities.find((item) => item.functionality.id === selectedFunctionalityId)?.selectedPath?.reason }
      : null);
  const selectedAssignment = assignmentByFunctionalityId.get(selectedFunctionalityId) || null;
  const selectedBranchSignal = selectedBranch
    ? decisionBranchReviewSignal(selectedBranch, displayedBranches.filter((branch) => branch.parentBranchId === selectedBranch.id).length)
    : null;

  if (!hasSelectedManagedProject) {
    return (
      <section className="decision-continuity-panel decision-project-required" aria-label="Decision continuity ledger">
        <header className="self-improvement-header">
          <div>
            <span className="eyebrow">Decision continuity</span>
            <h2>Decision Ledger</h2>
            <p>Select a managed project to inspect its objectives, major capabilities, and decision paths. Records are never aggregated across projects in this view.</p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section className="decision-continuity-panel" aria-label="Decision continuity ledger">
      <header className="self-improvement-header">
        <div>
          <span className="eyebrow">Decision continuity</span>
          <h2>Decision Ledger</h2>
          <p>Workspace: {selectedProject.name}. Project objectives contain coordinated major functionalities and their source-level features; authoritative branch facts remain tenant-scoped.</p>
        </div>
        <div className="self-improvement-actions">
          {onAnalyzeArchitecture ? (
            <button className="ghost-action decision-analyze-action" type="button" onClick={onAnalyzeArchitecture} disabled={analyzingArchitecture}>
              {analyzingArchitecture ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
              {analyzingArchitecture ? "Analyzing…" : "Analyze architecture"}
            </button>
          ) : null}
          <button className="ghost-action" type="button" onClick={() => loadDecisionContinuity()} disabled={loading}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            Refresh
          </button>
        </div>
      </header>

      {error ? <div className="self-improvement-error">{error}</div> : null}
      <div className="decision-continuity-notice">
        <ShieldCheck size={17} />
        <span>Browser access is read-only for promotion. Trusted services submit condition/evaluation facts; configured operators approve and record bounded canaries.</span>
      </div>

      <section className="decision-workshop-overview" aria-label="Branch decision workshop overview">
        <div className="decision-workshop-kpis">
          <article className="decision-workshop-kpi current"><span>Major objectives</span><strong>{compactNumber(objectiveLedger.objectiveCount)}</strong><small>Connected delivery outcomes derived from source relationships</small></article>
          <article className="decision-workshop-kpi possibility"><span>Major functionalities</span><strong>{compactNumber(objectiveLedger.majorFunctionalityCount)}</strong><small>Capabilities that coordinate features, APIs, services, and data</small></article>
          <article className="decision-workshop-kpi dormant"><span>Dormant provenance</span><strong>{compactNumber(workshop.dormant.length)}</strong><small>Rejected or retired; never erased</small></article>
          <article className="decision-workshop-kpi evidence"><span>Coordinated features</span><strong>{compactNumber(objectiveLedger.featureCount)}</strong><small>Retained as evidence beneath major functionality decisions</small></article>
        </div>
        <div className="decision-workshop-guidance">
          <div>
            <span className="eyebrow">How to read this workspace</span>
            <strong>Current implementation is evidence, not a historical decision claim.</strong>
            <p>Each objective groups capabilities that act together. A path is marked selected only when the lifecycle records selection; deferred and rejected paths explain their recorded or evidence-limited reason.</p>
          </div>
          <div className="decision-workshop-guidance-stats">
            <span>{compactNumber(reconsiderations.filter((item) => item.status === "pending_evaluation").length)} awaiting validation</span>
            <span>{compactNumber(graph?.nodes?.length || 0)} rebuildable graph nodes</span>
            {objectiveLedger.featureObservationCount ? <span>{compactNumber(objectiveLedger.featureObservationCount)} legacy feature observations collapsed</span> : null}
          </div>
        </div>
      </section>

      <DecisionBranchTreeCanvas
        project={selectedProject}
        branches={displayedBranches}
        analysisReport={architectureAnalysisReport}
        decisionGraph={graph}
        selectedBranchId={resolvedSelectedBranchId}
        selectedBranch={selectedBranch}
        selectedBranchSignal={selectedBranchSignal}
        selectedFunctionality={selectedFunctionality}
        selectedObjective={selectedObjective}
        selectedDecisionRecord={selectedDecisionRecord}
        selectedFunctionalityId={selectedFunctionalityId}
        selectedAssignment={selectedAssignment}
        assignments={architectureAnalysisReport?.assignments || []}
        onSelectBranch={setSelectedBranchId}
        onResetFocus={() => setSelectedBranchId("")}
        onAnalyze={onAnalyzeArchitecture}
        analyzing={analyzingArchitecture}
        analysisStatus={architectureAnalysisStatus}
      />

      <details className="decision-objective-ledger" aria-label="Collapsed project objectives and decision reasoning">
        <summary><span><span className="eyebrow">Objective map</span><strong>Why these paths were selected or not selected</strong></span><small>Expand for detailed rationale, feature composition, and suppressed options.</small></summary>
        <div className="decision-objective-ledger-content">
          {objectiveLedger.objectives.length ? objectiveLedger.objectives.map((objective) => (
            <article key={objective.id}>
              <div className="decision-objective-heading">
                <div><span className="eyebrow">Project objective</span><h4>{objective.label}</h4><p>{objective.description}</p></div>
                <span>{objective.featureCount || 0} features</span>
              </div>
              <ol>
                {objective.functionalities.map((record) => (
                  <li key={record.functionality.id}>
                    <div className="decision-objective-functionality">
                      <div><strong>{record.functionality.label}</strong><small>{record.featureCount} coordinated feature{record.featureCount === 1 ? "" : "s"} · {record.evidenceCount} evidence references</small></div>
                      <span className={`decision-status ${record.selectedPath?.branch?.status || "candidate"}`}>{record.selectedPath?.confirmed ? "selected" : "current evidence"}</span>
                    </div>
                    <p><b>{record.selectedPath?.confirmed ? "Selected because:" : "Current-path rationale:"}</b> {record.selectedPath?.reason || "No source-backed current path is recorded yet."}</p>
                    {record.alternatives.length || record.suppressedAlternatives.length ? <ul>{record.alternatives.slice(0, 4).map((alternative) => (
                      <li key={alternative.branch.id}><span className={`decision-status ${alternative.branch.status}`}>{alternative.disposition.replaceAll("_", " ")}</span><div><strong>{alternative.branch.objective?.summary || alternative.branch.id}</strong><small>{alternative.reason}</small></div><button type="button" onClick={() => setSelectedBranchId(alternative.branch.id)}>Inspect</button></li>
                    ))}{record.suppressedAlternatives.slice(0, 4).map((alternative) => (
                      <li key={alternative.candidate.id}><span className="decision-status rejected">not published</span><div><strong>{alternative.candidate.title || alternative.candidate.pattern || alternative.candidate.id}</strong><small>{alternative.reason}</small></div></li>
                    ))}</ul> : <small className="decision-objective-no-alternatives">No evidence-supported alternative has been recorded for this major functionality.</small>}
                  </li>
                ))}
              </ol>
            </article>
          )) : <p className="decision-empty">Run architecture analysis to identify project objectives and their coordinated capabilities.</p>}
        </div>
      </details>

      <section className="decision-workshop-deck decision-workshop-supporting-deck" aria-label="Branch review deck">
        <div className="decision-workshop-queue">
          <header>
            <div><span className="eyebrow">Prioritised review</span><h3>Important paths</h3></div>
            <small>Signals are navigational only</small>
          </header>
          {workshop.reviewQueue.length ? (
            <ol>
              {workshop.reviewQueue.slice(0, 5).map(({ branch, signal }) => (
                <li key={branch.id} className={`${branch.id === resolvedSelectedBranchId ? "selected" : ""} ${signal.level}`}>
                  <button type="button" onClick={() => setSelectedBranchId(branch.id)}>
                    <span className="decision-review-score" aria-label={`${signal.level} review signal`}>{signal.score}</span>
                    <span><strong>{branch.objective?.summary || branch.id}</strong><small>{signal.label} · {signal.evidenceCount} cited evidence · {signal.childCount} linked path{signal.childCount === 1 ? "" : "s"}</small></span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className="decision-empty">No live branch record is available to prioritise yet.</p>}
        </div>
        <div className="decision-workshop-dormant">
          <header><div><span className="eyebrow">Retained, not erased</span><h3>Dormant possibilities</h3></div><small>{workshop.dormant.length} disabled records</small></header>
          {workshop.dormantQueue.length ? <ol>{workshop.dormantQueue.slice(0, 4).map(({ branch, signal }) => (
            <li key={branch.id} className={branch.id === resolvedSelectedBranchId ? "selected" : ""}>
              <button type="button" onClick={() => setSelectedBranchId(branch.id)}>
                <span className="decision-dormant-mark" aria-hidden="true" />
                <span><strong>{branch.objective?.summary || branch.id}</strong><small>{signal.revisitEligible ? "Reconsiderable when conditions change" : "Disabled provenance"} · {signal.evidenceCount} evidence</small></span>
              </button>
            </li>
          ))}</ol> : <p className="decision-empty">No rejected or retired branch provenance is recorded.</p>}
        </div>
      </section>

      <div className="decision-continuity-columns">
        <section>
          <header><h3>Major decisions and provenance</h3><small>Authoritative records for {selectedProject.name}; feature observations are kept beneath their capability</small></header>
          {displayedBranches.length ? (
            <div className="decision-ledger-table-wrap">
              <table className="decision-ledger-table">
                <thead><tr><th>Branch</th><th>Status</th><th>Lineage and provenance</th></tr></thead>
                <tbody>
                  {displayedBranches.map((branch) => (
                    <tr key={branch.id} className={`${resolvedSelectedBranchId === branch.id ? "selected" : ""} ${isDisabledDecisionBranch(branch) ? "disabled" : ""}`} onClick={() => setSelectedBranchId(branch.id)}>
                      <td><strong>{branch.objective?.summary || branch.id}</strong><small>{branch.id} · revision {branch.revision} · {branch.branchType}</small></td>
                      <td><span className={`decision-status ${branch.status}`}>{decisionBranchStateLabel(branch)}</span><small>{branch.candidate?.inferenceRole === "observed_current" ? "observed current" : branch.autoReconsideration ? "reconsiderable" : "recorded"}</small></td>
                      <td>
                        <p>{branch.disposition?.reason || "Candidate preserved for governed comparison."}</p>
                        <details>
                          <summary>{branch.parentBranchId ? `Parent ${branch.parentBranchId}` : `Genesis lineage ${branch.rootLineageId || branch.id}`}</summary>
                          <dl>
                            <div><dt>Evidence</dt><dd>{branch.evidence?.length || 0} immutable reference{branch.evidence?.length === 1 ? "" : "s"}</dd></div>
                            <div><dt>Constraints</dt><dd>{branch.constraintDefinitions?.length || branch.revisitTriggers?.length || 0} declared · {branch.autoReconsideration ? "eligible when trusted conditions clear" : "manual reconsideration only"}</dd></div>
                            <div><dt>Content hash</dt><dd>{branch.contentHash || "recorded in source event"}</dd></div>
                          </dl>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="decision-empty">No major decision paths are recorded for this project workspace yet.</p>}
        </section>
        <section>
          <header><h3>Reconsideration queue</h3><small>Events create requests, never direct promotion</small></header>
          {reconsiderations.length ? (
            <ol className="decision-branch-list">
              {reconsiderations.map((request) => (
                <li key={request.id}>
                  <div className="decision-branch-topline"><strong>{request.status.replaceAll("_", " ")}</strong><span className="decision-status reconsidering">{request.id}</span></div>
                  <small>Branch {request.branchId} · source event {request.sourceEventId}</small>
                  <p>{request.evaluation?.summary || request.policy?.reasons?.join(" · ") || "Awaiting a governed lifecycle step."}</p>
                </li>
              ))}
            </ol>
          ) : <p className="decision-empty">No trusted condition has opened a reconsideration request.</p>}
        </section>
        <section>
          <header><h3>QAgent evidence investigations</h3><small>{qagentFeature?.enabledForTenant ? "Read-only evidence planner" : "Feature disabled · established baseline"}</small></header>
          {qagentRuns.length ? (
            <ol className="decision-branch-list">
              {qagentRuns.map((run) => (
                <li key={run.id}>
                  <div className="decision-branch-topline"><strong>{run.proposal?.question || "Investigation stopped before a question was accepted."}</strong><span className={`decision-status ${run.status}`}>{run.status}</span></div>
                  <small>{run.id} · reconsideration {run.reconsiderationId} · {run.model?.provider || "provider unavailable"}</small>
                  <p>{run.stopReason ? `Stop: ${run.stopReason.replaceAll("_", " ")}` : "A bounded evidence plan is awaiting its next governed state."}</p>
                  <details>
                    <summary>Gap, provenance, budget, and decision impact</summary>
                    <dl>
                      <div><dt>Evidence gap</dt><dd>{run.branchRelevance?.map((item) => `${item.branchId}: ${item.evidenceGap}`).join(" · ") || "Not recorded"}</dd></div>
                      <div><dt>Provenance</dt><dd>{run.evidence?.length ? run.evidence.map((item) => `${item.provenance?.source || "unknown"}/${item.provenance?.readOnlyToolId || "unknown"} · ${item.accepted ? "validated" : "untrusted"}`).join(" · ") : "No evidence accepted"}</dd></div>
                      <div><dt>Budget</dt><dd>{run.budget?.consumed?.toolCalls || 0}/{run.limits?.maxToolCalls || 0} tool calls · ${Number(run.budget?.consumed?.monetaryCostUsd || 0).toFixed(3)} consumed</dd></div>
                      <div><dt>Decision impact</dt><dd>{run.decisionImpact?.status || "not evaluated"} · {run.decisionImpact?.finalLifecycleAuthority || "policy and human approval remain required"}</dd></div>
                      <div><dt>Next governed state</dt><dd>{run.status === "completed" ? "deterministic evaluation, policy decision, and human approval" : run.stopReason || "collect authorized evidence"}</dd></div>
                    </dl>
                  </details>
                </li>
              ))}
            </ol>
          ) : <p className="decision-empty">No QAgent evidence investigation is recorded for this tenant. Disabling this feature leaves the established reconsideration path unchanged.</p>}
          {qagentMetrics ? <p className="decision-empty">{qagentMetrics.acceptedEvidenceCount || 0} accepted evidence item(s) · {qagentMetrics.noDecisionEffectCount || 0} answer(s) with no decision effect · attribution is not a causal claim.</p> : null}
        </section>
        <section>
          <header><h3>BrainX model governance</h3><small>{brainx?.feature?.enabledForTenant ? "Registry / routing / controls" : "Feature disabled · baseline path preserved"}</small></header>
          {brainx ? (
            <>
              <p className="decision-empty">{brainx.metrics?.routes || 0} route decision(s) · {brainx.metrics?.completed || 0} completed isolated execution(s) · ${Number(brainx.metrics?.estimatedCostUsd || 0).toFixed(4)} recorded usage. Output content is never retained.</p>
              {brainx.routes?.length ? <ol className="decision-branch-list">{brainx.routes.slice(0, 4).map((route) => <li key={route.id}><div className="decision-branch-topline"><strong>{route.taskRole.replaceAll("_", " ")}</strong><span className={`decision-status ${route.status}`}>{route.status}</span></div><small>{route.selectedRegistrationId || "No eligible registration"} · policy {route.policy?.version || "not provisioned"}</small><p>{route.excludedCandidates?.length ? `${route.excludedCandidates.length} candidate exclusion(s) recorded` : "Selected from eligible, policy-constrained candidates."}</p></li>)}</ol> : <p className="decision-empty">No BrainX route evidence is recorded. Registrations, provider health, circuit state, and kill switches are operator-controlled.</p>}
              {brainx.controls?.some((control) => control.enabled === false) ? <p className="decision-empty">Active kill switch: {brainx.controls.filter((control) => control.enabled === false).map((control) => control.scope).join(", ")}.</p> : null}
            </>
          ) : <p className="decision-empty">Model registry details require the separate BrainX read permission. No browser route can invoke a model.</p>}
        </section>
        <section>
          <header><h3>Suggested Next / Intel review</h3><small>Evidence-backed, never self-executing</small></header>
          {suggestionGovernance ? <>{suggestionGovernance.suggestions?.length ? <ol className="decision-branch-list">{suggestionGovernance.suggestions.slice(0, 4).map((item) => <li key={item.id}><div className="decision-branch-topline"><strong>{item.objective}</strong><span className={`decision-status ${item.state}`}>{item.state.replaceAll("_", " ")}</span></div><small>Trusted trigger {item.authoritativeFacts?.triggerEventId || "not recorded"} · policy {item.policyState}</small><p>{item.remainingBlockers?.length ? `Blockers: ${item.remainingBlockers.join(" · ")}` : "No remaining blocker; independent review and Step 4 lifecycle still required."}</p><details><summary>Facts, rationale, and lifecycle links</summary><dl><div><dt>Authoritative facts</dt><dd>{item.authoritativeFacts?.evidenceIds?.join(", ") || "None"}</dd></div><div><dt>Model rationale</dt><dd>{item.modelRationale || "None supplied"}</dd></div><div><dt>Promotion link</dt><dd>{item.lifecycleLinks?.[0]?.promotionRequestId || "Not entered"}</dd></div></dl></details></li>)}</ol> : <p className="decision-empty">No reviewable suggestion is recorded. Generation or viewing cannot execute a change.</p>}<p className="decision-empty">{suggestionGovernance.intel?.length || 0} Intel capability proposal(s) retain their registry, ledger, graph, and authorized-vector reuse decision.</p></> : <p className="decision-empty">Suggestion review metadata requires its dedicated permission.</p>}
        </section>
      </div>
    </section>
  );
}

function MarketVisionPanel() {
  const [marketVision, setMarketVision] = useState(null);
  const [latest, setLatest] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [apifyPulling, setApifyPulling] = useState(false);
  const [apifyError, setApifyError] = useState("");
  const [apifyResult, setApifyResult] = useState(null);
  const [selectedInvestorCountry, setSelectedInvestorCountry] = useState("india");
  const [savedInvestors, setSavedInvestors] = useState([]);
  const [investorProposals, setInvestorProposals] = useState([]);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [proposalBusy, setProposalBusy] = useState("");
  const [reviewerNote, setReviewerNote] = useState("");
  const [outreachBusy, setOutreachBusy] = useState("");

  async function loadMarketVision() {
    setLoading(true);
    setError("");
    try {
      const [res, investorsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/self-improvement/market-vision`),
        fetch(`${BACKEND_URL}/api/self-improvement/investor-discovery/profiles?limit=100&country=${encodeURIComponent(selectedInvestorCountry)}`)
      ]);
      const [data, investorsData] = await Promise.all([res.json(), investorsRes.json()]);
      if (!res.ok) throw new Error(data.error || "Market vision is unavailable.");
      setMarketVision(data.marketVision || null);
      setLatest(data.latest || null);
      setPdf(data.pdf || null);
      if (!investorsRes.ok) {
        setApifyError(investorsData.error || "Saved investor profiles are unavailable.");
        return;
      }
      setSavedInvestors(Array.isArray(investorsData.profiles) ? investorsData.profiles : []);
      setInvestorProposals(Array.isArray(investorsData.proposals) ? investorsData.proposals : []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMarketVision();
  }, []);

  useEffect(() => {
    loadInvestorProfiles().catch((loadError) => setApifyError(loadError.message));
  }, [selectedInvestorCountry]);

  async function loadInvestorProfiles() {
    const res = await fetch(`${BACKEND_URL}/api/self-improvement/investor-discovery/profiles?limit=100&country=${encodeURIComponent(selectedInvestorCountry)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Investor profiles unavailable.");
    setSavedInvestors(Array.isArray(data.profiles) ? data.profiles : []);
    setInvestorProposals(Array.isArray(data.proposals) ? data.proposals : []);
    return data;
  }

  async function pullApifyInvestors(search = {}) {
    setApifyPulling(true);
    setApifyError("");
    try {
      const res = await fetch(`${BACKEND_URL}/api/self-improvement/investor-discovery/apify-linkedin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: search.query,
          label: search.label,
          country: selectedInvestorCountry,
          maxItems: 20,
          takePages: 1,
          rotate: search.rotate !== false
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apify investor pull failed.");
      setApifyResult(data.pull || null);
      if (Array.isArray(data.pull?.topInvestors)) setSavedInvestors(data.pull.topInvestors);
      await loadInvestorProfiles();
    } catch (pullError) {
      setApifyError(pullError.message);
    } finally {
      setApifyPulling(false);
    }
  }

  async function prepInvestorProposal(investor) {
    setProposalBusy(investor.id);
    setApifyError("");
    try {
      const res = await fetch(`${BACKEND_URL}/api/self-improvement/investor-discovery/profiles/${encodeURIComponent(investor.id)}/proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demoVideoUrl: "" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Investor proposal could not be prepared.");
      setSelectedProposal(data.proposal || null);
      setReviewerNote("");
      await loadInvestorProfiles();
    } catch (proposalError) {
      setApifyError(proposalError.message);
    } finally {
      setProposalBusy("");
    }
  }

  async function approveInvestorProposal(approved = true) {
    if (!selectedProposal?.id) return;
    setProposalBusy(selectedProposal.id);
    setApifyError("");
    try {
      const res = await fetch(`${BACKEND_URL}/api/self-improvement/investor-discovery/proposals/${encodeURIComponent(selectedProposal.id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved, reviewerNote })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Investor proposal review failed.");
      setSelectedProposal(data.proposal || null);
      await loadInvestorProfiles();
    } catch (approvalError) {
      setApifyError(approvalError.message);
    } finally {
      setProposalBusy("");
    }
  }

  async function stageApprovedOutreach() {
    if (!selectedProposal?.id) return;
    setOutreachBusy(selectedProposal.id);
    setApifyError("");
    try {
      const res = await fetch(`${BACKEND_URL}/api/self-improvement/investor-discovery/proposals/${encodeURIComponent(selectedProposal.id)}/send`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approved outreach could not be staged.");
      setSelectedProposal(data.proposal || null);
      await loadInvestorProfiles();
    } catch (sendError) {
      setApifyError(sendError.message);
    } finally {
      setOutreachBusy("");
    }
  }

  const pillars = marketVision?.marketReadyPillars || [];
  const roadmap = marketVision?.roadmap || [];
  const checkpointTimeline = marketVision?.checkpointTimeline || null;
  const checkpoints = checkpointTimeline?.checkpoints || [];
  const investorPlan = marketVision?.investorDiscoveryPlan || null;
  const manualLinkedInWindow = investorPlan?.manualLinkedInWindow || null;
  const automaticApifyWindow = investorPlan?.automaticApifyWindow || null;
  const planningArchitecture = [
    {
      label: "Plan",
      detail: "Turn market evidence into scoped milestones, owners, proof assets and validation gates.",
      owner: "self-improvement-planner"
    },
    {
      label: "Architect",
      detail: "Carry requirements, architecture, decisions, risks, environments and tests into the Project Intelligence Passport.",
      owner: "plutonix-literature-research-agent"
    },
    {
      label: "Validate",
      detail: "Require delivery evidence, cost notes, approval context and rollback readiness before progress is claimed.",
      owner: "plutonix-self-improvement-investigator-agent"
    },
    {
      label: "Learn",
      detail: "Feed investor and buyer objections back into the controlled-evolution roadmap.",
      owner: "plutonix-marketplace-research-agent"
    }
  ];
  const source = marketVision?.source || {};
  const pdfUrl = pdf?.url ? `${BACKEND_URL}${pdf.url}` : "";

  return (
    <section className="market-vision-panel" aria-label="Market vision source">
      <header className="market-vision-header">
        <div>
          <span className="eyebrow">Market readiness R&D</span>
          <h2>{marketVision?.positioning?.leadMessage || "Your persistent AI engineering organisation."}</h2>
          <p>{marketVision?.positioning?.oneSentence || latest?.summary || "Vision source loading."}</p>
        </div>
        <div className="self-improvement-actions">
          <button className="ghost-action" onClick={loadMarketVision} disabled={loading}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            Refresh
          </button>
          {pdfUrl ? (
            <a className="ghost-action" href={pdfUrl} download={pdf?.filename || "PlutoniX_Market_Differentiation_Investor_Quotation.pdf"}>
              <Download size={16} />
              Download PDF
            </a>
          ) : null}
        </div>
      </header>

      {error ? <div className="self-improvement-error">{error}</div> : null}

      <div className="market-vision-layout">
        <div className="market-vision-knowledge">
          <div className="market-vision-summary">
            <article>
              <span>Category</span>
              <strong>{marketVision?.positioning?.category || "Autonomous software engineering platform"}</strong>
              <small>{marketVision?.positioning?.coreMoat || "Verified delivery + cross-project learning + controlled continuous evolution"}</small>
            </article>
            <article>
              <span>Source</span>
              <strong>{source.title || pdf?.title || "Market differentiation report"}</strong>
              <small>{source.path || pdf?.path || "PDF source"} · {source.pages || "12"} pages</small>
              {source.supplementalConversationUrl ? (
                <a className="market-source-link" href={source.supplementalConversationUrl} target="_blank" rel="noreferrer">
                  ChatGPT readiness conversation
                </a>
              ) : null}
            </article>
          </div>

          <nav className="market-readiness-jumps" aria-label="Market readiness sections">
            <button type="button" onClick={() => document.getElementById("investor-connections")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <strong>LinkedIn & investor connections</strong>
              <span>Manual search, Apify pulls, target review and outreach staging</span>
            </button>
            <button type="button" onClick={() => document.getElementById("planning-architecture")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <strong>Planning architecture</strong>
              <span>Plan, architect, validate and learn across each readiness milestone</span>
            </button>
            <button type="button" onClick={() => document.getElementById("readiness-deadlines")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <strong>Deadlines & gates</strong>
              <span>{checkpoints.length} scheduled checkpoints with owners, deliverables and exit criteria</span>
            </button>
          </nav>

          <section className="market-vision-card">
            <h3>R&D agent mandate</h3>
            <ol>
              {(marketVision?.rAndDInstruction?.requiredAgentBehavior || []).map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ol>
          </section>

          <section className="market-vision-card planning-architecture-card" id="planning-architecture">
            <div className="market-card-heading">
              <div>
                <span>Operating model</span>
                <h3>Planning architecture</h3>
              </div>
              <small>Market evidence → approved product evolution</small>
            </div>
            <div className="planning-architecture-grid">
              {planningArchitecture.map((stage, index) => (
                <article key={stage.label}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{stage.label}</strong>
                  <p>{stage.detail}</p>
                  <small>{stage.owner}</small>
                </article>
              ))}
            </div>
          </section>

          {investorPlan ? (
            <section className="market-vision-card" id="investor-connections">
              <h3>Investor discovery approach</h3>
              <p>{investorPlan.objective}</p>
              <div className="market-pillar-grid investor-discovery-grid">
                <article>
                  <span>Owner</span>
                  <strong>{investorPlan.agentOwner}</strong>
                  <small>{(investorPlan.supportingAgents || []).join(" + ")}</small>
                </article>
                <article>
                  <span>Targets</span>
                  <strong>{(investorPlan.targetInvestorProfiles || []).length} investor profiles</strong>
                  <small>AI infra, devtools, workflow automation, operator angels and strategic partners.</small>
                </article>
                <article>
                  <span>Proof assets</span>
                  <strong>{(investorPlan.outreachAssets || []).length} outreach assets</strong>
                  <small>Investor memo, product demo, proof dashboard and targeted email variants.</small>
                </article>
                <article>
                  <span>Apollo API</span>
                  <strong>{investorPlan.apolloApiUsage?.status || "Optional enrichment"}</strong>
                  <small>{investorPlan.apolloApiUsage?.credentialEnvVar || "APOLLO_API_KEY"} · approval for incremental spend.</small>
                </article>
                <article>
                  <span>Success metrics</span>
                  <strong>{(investorPlan.successMetrics || []).length} measurable outcomes</strong>
                  <small>Scored targets, warm paths, booked conversations and objection-driven improvements.</small>
                </article>
              </div>
              <ol>
                {(investorPlan.targetInvestorProfiles || []).slice(0, 4).map((item, index) => (
                  <li key={`investor-target-${index}`}>{item}</li>
                ))}
              </ol>
              {manualLinkedInWindow ? (
                <div className="manual-linkedin-window">
                  <div className="manual-linkedin-header">
                    <div>
                      <span>Manual LinkedIn window</span>
                      <strong>{manualLinkedInWindow.title}</strong>
                    </div>
                    <small>No scraping or automated outreach.</small>
                  </div>
                  <ol>
                    {(manualLinkedInWindow.method || []).map((item, index) => (
                      <li key={`linkedin-method-${index}`}>{item}</li>
                    ))}
                  </ol>
                  <div className="linkedin-search-grid">
                    {(manualLinkedInWindow.searches || []).map((search) => {
                      const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(search.query)}`;
                      return (
                        <a key={search.label} href={searchUrl} target="_blank" rel="noreferrer">
                          <Search size={15} />
                          <span>{search.label}</span>
                          <small>{search.query}</small>
                          <ExternalLink size={14} />
                        </a>
                      );
                    })}
                  </div>
                  <div className="linkedin-candidate-fields">
                    {(manualLinkedInWindow.candidateFields || []).map((field) => (
                      <span key={field}>{field}</span>
                    ))}
                  </div>
                </div>
              ) : null}
              {automaticApifyWindow ? (
                <div className="automatic-apify-window">
                  <div className="manual-linkedin-header">
                    <div>
                      <span>Automatic</span>
                      <strong>{automaticApifyWindow.title}</strong>
                    </div>
                    <small>{automaticApifyWindow.provider} · {automaticApifyWindow.defaultMode} · max {automaticApifyWindow.defaultLimit}</small>
                  </div>
                  <p>{automaticApifyWindow.costGuard}</p>
                  <div className="investor-country-control">
                    <label htmlFor="investor-country-select">
                      <span>Country</span>
                      <select
                        id="investor-country-select"
                        value={selectedInvestorCountry}
                        onChange={(event) => {
                          setSelectedInvestorCountry(event.target.value);
                          setApifyResult(null);
                          setSelectedProposal(null);
                        }}
                      >
                        {investorCountryOptions.map((country) => (
                          <option key={country.id} value={country.id}>{country.label}</option>
                        ))}
                      </select>
                    </label>
                    <small>Search and saved profiles are filtered to this country.</small>
                  </div>
                  <div className="apify-search-actions">
                    <button type="button" onClick={() => pullApifyInvestors({})} disabled={apifyPulling}>
                      {apifyPulling ? <Loader2 className="spin" size={15} /> : <Database size={15} />}
                      <span>Find 20 new profiles</span>
                      <small>Rotates country-specific AI infra, devtools and angel searches.</small>
                    </button>
                    {(automaticApifyWindow.searches || []).map((search) => (
                      <button
                        key={search.label}
                        type="button"
                        onClick={() => pullApifyInvestors({ ...search, rotate: false })}
                        disabled={apifyPulling}
                      >
                        {apifyPulling ? <Loader2 className="spin" size={15} /> : <Database size={15} />}
                        <span>{search.label}</span>
                        <small>{search.query}</small>
                      </button>
                    ))}
                  </div>
                  {apifyError ? <div className="self-improvement-error">{apifyError}</div> : null}
                  {apifyResult ? (
                    <div className="apify-investor-results">
                      <div className="manual-linkedin-header">
                        <div>
                          <span>Last run</span>
                          <strong>{apifyResult.savedCount || 0} new saved · {apifyResult.duplicateCount || 0} duplicates</strong>
                        </div>
                        <small>{apifyResult.country || selectedInvestorCountry} · {apifyResult.label || "Investor search"} · {apifyResult.query}</small>
                      </div>
                    </div>
                  ) : null}
                  <div className="apify-investor-results investor-outreach-workspace">
                    <div className="manual-linkedin-header">
                      <div>
                        <span>Top investors for this product</span>
                        <strong>{savedInvestors.length} saved profiles</strong>
                      </div>
                      <small>{investorCountryOptions.find((country) => country.id === selectedInvestorCountry)?.label} only · ranked for AI infra, devtools, workflow automation and operator relevance.</small>
                    </div>
                    {savedInvestors.length ? (
                      <ol>
                        {savedInvestors.slice(0, 20).map((record) => (
                          <li key={record.id || record.linkedinUrl || record.name}>
                            <div className="investor-profile-row">
                              <div>
                                <strong>{record.name}</strong>
                                <span>{record.headline || record.role || "Profile returned by Apify"}</span>
                                <small>{[record.company, record.location].filter(Boolean).join(" · ") || record.thesisFit}</small>
                                {record.profileIntro ? <p className="investor-profile-intro">{record.profileIntro}</p> : null}
                              </div>
                              <div className="investor-score">
                                <strong>{record.fitScore || 0}</strong>
                                <span>{record.thesisFit || "Needs review"}</span>
                              </div>
                            </div>
                            <div className="investor-profile-actions">
                              {record.linkedinUrl ? (
                                <a href={record.linkedinUrl} target="_blank" rel="noreferrer">
                                  <ExternalLink size={13} />
                                  Open profile
                                </a>
                              ) : null}
                              <button type="button" onClick={() => prepInvestorProposal(record)} disabled={Boolean(proposalBusy)}>
                                {proposalBusy === record.id ? <Loader2 className="spin" size={13} /> : <FileText size={13} />}
                                Prep proposal
                              </button>
                              <small>{record.proposalStatus || "not_prepared"} · {record.outreachStatus || "not_started"}</small>
                            </div>
                            {record.organization ? (
                              <div className="investor-org-details">
                                <strong>{record.organization.name || record.company}</strong>
                                {record.organization.businessDetails ? <p>{record.organization.businessDetails}</p> : <p>Business details were not found from public enrichment.</p>}
                                <small>
                                  {record.organization.finance?.status === "found"
                                    ? `Finance: ${record.organization.finance.symbol} ${record.organization.finance.regularMarketPrice ?? ""} ${record.organization.finance.currency || ""}${record.organization.finance.marketCap ? ` · Market cap ${record.organization.finance.marketCap}` : ""}`
                                    : "Finance: public market data not found or organization is private."}
                                </small>
                                {record.organization.sourceUrl ? (
                                  <a href={record.organization.sourceUrl} target="_blank" rel="noreferrer">
                                    <ExternalLink size={13} />
                                    Org source
                                  </a>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p>No saved investor profiles yet. Run the rotating Apify search to save the first 20.</p>
                    )}
                  </div>
                  {selectedProposal ? (
                    <div className="investor-proposal-review">
                      <div className="manual-linkedin-header">
                        <div>
                          <span>Review proposal</span>
                          <strong>{selectedProposal.proposal?.title || selectedProposal.investorName}</strong>
                        </div>
                        <small>{selectedProposal.status}</small>
                      </div>
                      <div className="investor-proposal-grid">
                        <article>
                          <span>Profile information reviewed</span>
                          <strong>{selectedProposal.investorName}</strong>
                          <small>{(selectedProposal.profileEvidence || []).join(" · ")}</small>
                        </article>
                        <article>
                          <span>Fit reasons</span>
                          <strong>{(selectedProposal.fitReasons || []).slice(0, 2).join(" · ")}</strong>
                          <small>{(selectedProposal.fitReasons || []).slice(2).join(" · ")}</small>
                        </article>
                      </div>
                      <label className="investor-message-block">
                        <span>Inbox subject</span>
                        <input value={selectedProposal.proposal?.inbox?.subject || ""} readOnly />
                      </label>
                      <label className="investor-message-block">
                        <span>Inbox message</span>
                        <textarea value={selectedProposal.proposal?.inbox?.body || ""} readOnly rows={10} />
                      </label>
                      <label className="investor-message-block">
                        <span>Direct message</span>
                        <textarea value={selectedProposal.proposal?.directMessage || ""} readOnly rows={4} />
                      </label>
                      <label className="investor-message-block">
                        <span>Reviewer note</span>
                        <textarea value={reviewerNote} onChange={(event) => setReviewerNote(event.target.value)} rows={3} placeholder="Add approval notes or requested changes." />
                      </label>
                      <div className="investor-review-actions">
                        <button type="button" onClick={() => approveInvestorProposal(true)} disabled={Boolean(proposalBusy)}>
                          {proposalBusy === selectedProposal.id ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}
                          Approve
                        </button>
                        <button type="button" onClick={() => approveInvestorProposal(false)} disabled={Boolean(proposalBusy)}>
                          <XCircle size={14} />
                          Needs revision
                        </button>
                        <button type="button" onClick={stageApprovedOutreach} disabled={selectedProposal.status !== "approved" || Boolean(outreachBusy)}>
                          {outreachBusy === selectedProposal.id ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
                          Stage inbox + DM
                        </button>
                      </div>
                      <small className="investor-dispatch-note">Demo video link is intentionally empty until the video is ready. Approved outreach is staged for external/manual delivery because no live sender is configured.</small>
                    </div>
                  ) : null}
                  {investorProposals.length ? (
                    <div className="investor-proposal-history">
                      <strong>Recent proposal drafts</strong>
                      <ol>
                        {investorProposals.slice(0, 5).map((proposal) => (
                          <li key={proposal.id}>
                            <span>{proposal.investorName}</span>
                            <small>{proposal.status} · {proposal.updatedAt || proposal.createdAt}</small>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                  <ol>
                    {(automaticApifyWindow.operatingRules || []).map((item, index) => (
                      <li key={`apify-rule-${index}`}>{item}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
              <ol className="market-roadmap">
                {(investorPlan.standardDiscoveryWorkflow || []).slice(0, 6).map((item, index) => (
                  <li key={`investor-workflow-${index}`}>
                    <strong>Discovery step {index + 1}</strong>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
              {investorPlan.apolloApiUsage ? (
                <ol>
                  {(investorPlan.apolloApiUsage.operatingRules || []).map((item, index) => (
                    <li key={`apollo-rule-${index}`}>{item}</li>
                  ))}
                </ol>
              ) : null}
              <ol className="market-roadmap">
                {(investorPlan.selfImprovementLoop || []).map((item, index) => (
                  <li key={`${index}-${item}`}>
                    <strong>Loop {index + 1}</strong>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="market-vision-card">
            <h3>Market-ready pillars</h3>
            <div className="market-pillar-grid">
              {pillars.map((pillar) => (
                <article key={pillar.id}>
                  <span>{pillar.agentOwner}</span>
                  <strong>{pillar.label}</strong>
                  <p>{pillar.goal}</p>
                  <small>{pillar.proofKpi}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="market-vision-card">
            <h3>90-day proof roadmap</h3>
            <ol className="market-roadmap">
              {roadmap.map((item) => (
                <li key={item.period}>
                  <strong>{item.period}</strong>
                  <span>{item.build}</span>
                  <small>{item.measure} · {item.marketOutput}</small>
                </li>
              ))}
            </ol>
          </section>

          {checkpoints.length ? (
            <section className="market-vision-card" id="readiness-deadlines">
              <h3>Checkpoint timeline</h3>
              <p>{checkpointTimeline.cadence} Baseline: {checkpointTimeline.baselineDate} ({checkpointTimeline.timezone}).</p>
              <ol className="market-roadmap checkpoint-timeline">
                {checkpoints.map((checkpoint) => (
                  <li key={checkpoint.id}>
                    <strong>{checkpoint.deadline} · {checkpoint.label}</strong>
                    <span>{checkpoint.owner} · {checkpoint.status}</span>
                    <small>{(checkpoint.deliverables || []).slice(0, 2).join(" ")}</small>
                    <small>Gate: {(checkpoint.exitCriteria || []).slice(0, 2).join(" ")}</small>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>

      </div>
    </section>
  );
}

function ProductDocumentPanel() {
  const [documentText, setDocumentText] = useState("");
  const [status, setStatus] = useState("loading");
  const sections = useMemo(() => markdownSections(documentText), [documentText]);
  const summarySection = sections[0] || null;
  const bodySections = sections.slice(1);
  const capabilityCards = [
    {
      label: "Web and app surfaces",
      detail: "Web apps, dashboards, portals, SaaS flows, marketplaces, ecommerce, and responsive app shells.",
      Icon: MonitorSmartphone
    },
    {
      label: "Mobile products",
      detail: "iOS, Android, hybrid, mobile-first prototypes, and app-style flows selected by product shape.",
      Icon: Smartphone
    },
    {
      label: "Documents and PDFs",
      detail: "Reports, brochures, proposals, manuals, invoices, printable pages, and downloadable document layouts.",
      Icon: FileText
    },
    {
      label: "Creative artifacts",
      detail: "Flyers, posters, banners, thumbnails, logos, presentation-style assets, and media-led deliverables.",
      Icon: Palette
    },
    {
      label: "Data and workbooks",
      detail: "Excel workbooks, CSV tables, formulas, multi-sheet models, structured datasets, and export-ready calculations.",
      Icon: FileSpreadsheet
    },
    {
      label: "Tools and services",
      detail: "Python tools, scripts, automations, data workflows, API services, Swagger/OpenAPI, and executable outputs.",
      Icon: Server
    },
    {
      label: "Autonomous brain",
      detail: "Central orchestration, product-shape routing, agent memory, graph reasoning, and design workshop review.",
      Icon: Bot
    }
  ];
  const flowDiagrams = productDocumentWorkflowDefinitions();
  const docStats = [
    ["Native viewers", "9"],
    ["Primary scopes", "Multi-artifact"],
    ["Brain model", "Autonomous"],
    ["Evidence layers", "Logs + graph + memory"]
  ];

  useEffect(() => {
    let cancelled = false;
    async function loadProductDocument() {
      setStatus("loading");
      try {
        const response = await fetch("/docs/product-doc-plutonix.md", { cache: "no-store" });
        if (!response.ok) throw new Error(`Product document failed to load with ${response.status}`);
        const text = await response.text();
        if (!cancelled) {
          setDocumentText(text);
          setStatus("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setDocumentText("");
          setStatus(error.message || "Product document is unavailable.");
        }
      }
    }
    loadProductDocument();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="product-document-panel" aria-label="PlutoniX product document">
      <header className="product-document-header">
        <div>
          <p>Product source of truth</p>
          <h2>PlutoniX Product Document</h2>
          <span>Multi-artifact capabilities, autonomous central brain, workflows, requirements, architecture, safety model, roadmap, and open product questions.</span>
        </div>
        <div className="product-document-actions">
          <a className="ghost-action" href="/media/product-video/plutonix-product-video.mp4" target="_blank" rel="noreferrer">
            <Film size={15} />
            Watch demo
          </a>
          <button className="ghost-action" onClick={() => downloadProductDocumentPdf(documentText)} disabled={status !== "ready" || !documentText}>
            <Download size={15} />
            Download PDF
          </button>
          <a className="ghost-action" href="/docs/product-doc-plutonix.md" target="_blank" rel="noreferrer">
            <ExternalLink size={15} />
            Open source
          </a>
        </div>
      </header>

      {status === "loading" ? (
        <div className="product-document-state">
          <Loader2 className="spin" size={18} />
          Loading product document...
        </div>
      ) : status !== "ready" ? (
        <div className="product-document-state error-text">{status}</div>
      ) : (
        <div className="product-document-scroll">
          <section className="product-document-hero">
            <div>
              <span className="eyebrow">Universal builder contract</span>
              <h3>PlutoniX is a multi-artifact autonomous delivery cockpit, not only a web-app generator.</h3>
              <p>
                The central brain classifies the request, preserves the intended output shape, routes work to bounded agents, and validates the final product against artifact fidelity, real-data, UI functionality, and evidence rules.
              </p>
            </div>
            <div className="product-document-stat-grid" aria-label="Product document highlights">
              {docStats.map(([label, value]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </div>
          </section>

          <section className="product-document-capability-grid" aria-label="PlutoniX capabilities">
            {capabilityCards.map(({ label, detail, Icon }) => (
              <article key={label}>
                <span><Icon size={16} /></span>
                <div>
                  <strong>{label}</strong>
                  <p>{detail}</p>
                </div>
              </article>
            ))}
          </section>

          <section className="product-document-flow-grid" aria-label="Product document flow diagrams">
            {flowDiagrams.map((diagram) => (
              <ProductDocumentFlowDiagram key={diagram.title} {...diagram} />
            ))}
          </section>

          <div className="product-document-layout">
            <aside className="product-document-index" aria-label="Product document sections">
              <strong>Document sections</strong>
              <ol>
                {bodySections.map((section, index) => (
                  <li key={`${section.title}-${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {section.title}
                  </li>
                ))}
              </ol>
            </aside>
            <div className="product-document-content">
              {summarySection ? (
                <article className="product-document-summary">
                  <span className="eyebrow">Executive summary</span>
                  <h3>{summarySection.title}</h3>
                  <ProductDocumentRichContent content={summarySection.content} />
                </article>
              ) : null}
              <div className="product-document-sections">
                {bodySections.map((section, index) => (
                  <article className={`product-document-section-card level-${section.level}`} key={`${section.title}-${index}`}>
                    <header className="product-document-section-title">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <small>Product document section</small>
                        <h3>{section.title}</h3>
                      </div>
                    </header>
                    <ProductDocumentRichContent content={section.content} />
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SelfImprovementRunIndicator() {
  const [indicator, setIndicator] = useState(null);

  async function loadIndicator() {
    try {
      const res = await fetch(`${BACKEND_URL}/api/self-improvement/status`);
      const data = await res.json();
      if (res.ok) setIndicator(data.selfImprovement?.runIndicator || null);
    } catch {
      setIndicator(null);
    }
  }

  useEffect(() => {
    loadIndicator();
    const timer = setInterval(loadIndicator, 10000);
    return () => clearInterval(timer);
  }, []);

  const summary = selfImprovementRunSummary(indicator || {});
  return (
    <span
      className={`self-improvement-nav-indicator ${summary.running ? "running" : summary.blocked ? "blocked" : "ready"}`}
      title={`${summary.title}. ${summary.detail}`}
    >
      {summary.running ? <Loader2 className="spin" size={14} /> : <Activity size={14} />}
      <b>{summary.running ? "Improving" : "Self-improve"}</b>
      <small>{summary.running ? summary.phase : summary.nextRun || (summary.state === "adhoc_ready" ? "event-driven" : summary.phase)}</small>
    </span>
  );
}

function TechStackTopologySvg({ snapshot, categoryById, progress, variant = "compact", selectedStepId = "" }) {
  const graphId = useId().replace(/:/g, "-");
  const isLarge = variant === "large";
  const architectureRows = [
    { id: "frontend", x: 34, y: 40, width: 150, height: 62, lane: "Client" },
    { id: "backend", x: 220, y: 40, width: 150, height: 62, lane: "API" },
    { id: "services", x: 406, y: 40, width: 150, height: 62, lane: "Agent services" },
    { id: "database", x: 220, y: 144, width: 150, height: 62, lane: "Persistence" },
    { id: "cloud", x: 406, y: 144, width: 150, height: 62, lane: "Runtime" }
  ];
  const architectureLinks = [
    ["frontend", "backend"],
    ["backend", "services"],
    ["backend", "database"],
    ["services", "cloud"],
    ["database", "cloud"]
  ];
  const rowById = new Map(architectureRows.map((row) => [row.id, row]));
  const linkPath = (fromId, toId) => {
    const from = rowById.get(fromId);
    const to = rowById.get(toId);
    if (!from || !to) return "";
    if (from.x === to.x) {
      const startX = from.x + from.width / 2;
      const startY = from.y + from.height;
      const endY = to.y;
      return `M ${startX} ${startY} L ${startX} ${endY}`;
    }
    const startX = from.x + from.width;
    const startY = from.y + from.height / 2;
    const endX = to.x;
    const endY = to.y + to.height / 2;
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  };

  return (
    <svg className={`tech-stack-graph ${variant}`} viewBox="0 0 720 260" role="img" aria-label={`${snapshot.projectName} frontend backend database cloud services architecture`}>
      <defs>
        <marker id={`tech-stack-arrow-${graphId}`} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
          <path className="tech-stack-arrow-head" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      <g className="tech-stack-architecture-boundary">
        <rect x="18" y="18" width="684" height="224" rx="14" />
        <text x="34" y="31">{isLarge ? `${snapshot.projectName} architecture` : "High-level architecture"}</text>
      </g>
      <g className="tech-stack-architecture-links">
        {architectureLinks.map(([from, to]) => (
          <path key={`${from}-${to}`} d={linkPath(from, to)} markerEnd={`url(#tech-stack-arrow-${graphId})`} />
        ))}
      </g>
      <g className="tech-stack-architecture-progress">
        <rect x="592" y="42" width="78" height="164" rx="10" />
        <text x="631" y="70">Progress</text>
        <text x="631" y="97">{progress}%</text>
        <line x1="612" y1="184" x2="650" y2="184" />
        <line x1="612" y1={184 - Math.round(progress * 1.08)} x2="650" y2={184 - Math.round(progress * 1.08)} />
      </g>
      {architectureRows.map((row) => {
        const category = categoryById.get(row.id) || { label: displayEventType(row.id), items: [], state: "planned" };
        const stackNode = techStackNodeById.get(row.id);
        const StackIcon = stackNode?.icon || Code2;
        const color = stackNode?.color || "#475569";
        return (
          <g
            className={`tech-stack-architecture-block ${category.state} ${selectedStepId === row.id ? "selected" : ""}`}
            key={row.id}
            style={{ "--stack-color": color }}
            transform={`translate(${row.x} ${row.y})`}
          >
            <rect width={row.width} height={row.height} rx="8" />
            <g className="tech-stack-architecture-icon">
              <rect x="10" y="13" width="34" height="34" rx="7" />
              <StackIcon x={18} y={21} width={18} height={18} strokeWidth={2.2} />
            </g>
            <text className="tech-stack-architecture-lane" x="52" y="17">{row.lane}</text>
            <text className="tech-stack-architecture-title" x="52" y="35">{category.label}</text>
            <text className="tech-stack-architecture-detail" x="52" y="51">{isLarge ? stackText(category.items) || "Pending" : stackText(category.items).slice(0, 21) || "Pending"}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ProjectTechStackGraph({ snapshots, selectedIndex, onSelectIndex, hasProject }) {
  const [isModalOpen, setModalOpen] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState("frontend");
  const snapshot = snapshots[selectedIndex] || snapshots.at(-1) || buildTechStackSnapshot({});
  const categoryById = new Map(snapshot.categories.map((category) => [category.id, category]));
  const flowSteps = serviceFlowSteps(snapshot);
  const selectedStep = flowSteps.find((step) => step.id === selectedStepId) || flowSteps[0];
  const progress = Math.max(0, Math.min(100, Number(snapshot.progress || 0)));
  const timelineLabel = snapshots.length > 1
    ? `${selectedIndex + 1}/${snapshots.length} · ${shortDate(snapshot.createdAt)}`
    : shortDate(snapshot.createdAt);

  return (
    <section className="tech-stack-panel" aria-label="Generated project technology stack">
      <div className="tech-stack-header">
        <div>
          <span>D3 stack topology</span>
          <strong>{hasProject ? snapshot.projectName : "Empty canvas"}</strong>
        </div>
        <div className="tech-stack-header-actions">
          <small>{hasProject ? (snapshot.buildId ? `Build ${snapshot.buildId.slice(-8)}` : snapshot.status) : "Select a project"}</small>
        </div>
      </div>
      {hasProject ? (
        <div className="tech-stack-graph-wrap">
          <button className="tech-stack-graph-button" type="button" onClick={() => setModalOpen(true)} aria-label="Open technology stack topology in larger view">
            <TechStackTopologySvg snapshot={snapshot} categoryById={categoryById} progress={progress} />
            <span>Open architecture</span>
          </button>
          <div className="tech-stack-cards high-level">
            {flowSteps.map((step) => {
              const stackNode = techStackNodeById.get(step.id);
              const StackIcon = stackNode?.icon || Code2;
              return (
                <article className={`tech-stack-card ${step.state || "planned"}`} key={step.id} style={{ "--stack-color": stackNode?.color }}>
                  <StackIcon className="tech-stack-card-icon" size={16} aria-hidden="true" />
                  <span>{step.label}</span>
                  <strong>{stackText(step.items)}</strong>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="tech-stack-empty-canvas">
          <GitBranch size={24} />
          <strong>No project selected</strong>
          <span>Select a project to show its service control flow and stack topology.</span>
        </div>
      )}
      <div className="tech-stack-timeline">
        <label htmlFor="tech-stack-progress">Progress over time</label>
        <input
          id="tech-stack-progress"
          type="range"
          min="0"
          max={Math.max(0, snapshots.length - 1)}
          value={Math.min(selectedIndex, Math.max(0, snapshots.length - 1))}
          onChange={(event) => onSelectIndex(Number(event.target.value))}
          disabled={!hasProject || snapshots.length <= 1}
        />
        <span>{timelineLabel}</span>
      </div>
      {isModalOpen && hasProject ? (
        <div className="modal-backdrop agent-modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}>
          <section className="agent-modal tech-stack-modal" role="dialog" aria-modal="true" aria-label={`${snapshot.projectName} technology stack topology`} onMouseDown={(event) => event.stopPropagation()}>
            <header className="agent-modal-header">
              <div className="tech-stack-modal-mark">
                <GitBranch size={24} />
              </div>
              <div>
                <span>D3 stack topology</span>
                <h2>{snapshot.projectName}</h2>
                <p>{snapshot.buildId ? `Build ${snapshot.buildId}` : snapshot.status} · Progress {progress}% · {timelineLabel}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setModalOpen(false)} aria-label="Close technology stack topology">
                <X size={18} />
              </button>
            </header>
            <div className="tech-stack-control-detail">
              <div className="tech-stack-architecture-column">
                <div className="tech-stack-architecture-stage">
                  <TechStackTopologySvg snapshot={snapshot} categoryById={categoryById} progress={progress} variant="large" selectedStepId={selectedStep?.id} />
                </div>
                <div className="service-control-flow" aria-label="Detailed service architecture flow">
                  {flowSteps.map((step) => {
                    const stackNode = techStackNodeById.get(step.id);
                    const StackIcon = stackNode?.icon || Code2;
                    return (
                      <button
                        type="button"
                        className={`service-flow-block ${selectedStep?.id === step.id ? "active" : ""} ${step.state || "planned"}`}
                        key={step.id}
                        onClick={() => setSelectedStepId(step.id)}
                        style={{ "--stack-color": stackNode?.color }}
                      >
                        <i><StackIcon size={16} aria-hidden="true" /></i>
                        <strong>{step.label}</strong>
                        <span>{stackText(step.items)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <aside className="service-insight-panel">
                <span>Insight panel</span>
                <h3>{selectedStep.label}</h3>
                <p>{selectedStep.insight}</p>
                <p className="service-insight-description">
                  {selectedStep.label} is shown as an architecture layer in the topology. Its stack choices define how the generated project moves from user experience, through orchestration, into persistence, integrations, and runtime deployment.
                </p>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>{selectedStep.state || "planned"}</dd>
                  </div>
                  <div>
                    <dt>Stack</dt>
                    <dd>{stackText(selectedStep.items) || "Pending"}</dd>
                  </div>
                  <div>
                    <dt>Progress</dt>
                    <dd>{progress}%</dd>
                  </div>
                </dl>
              </aside>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function ProjectInstructionTimeline({ instructions, error, runningInstruction, now }) {
  const visibleInstructions = runningInstruction ? [runningInstruction, ...instructions] : instructions;
  const oldestIndex = visibleInstructions.length - 1;
  const expansionValue = (item, index) => {
    if (index === oldestIndex) return "Genesis";
    const fileScore = Array.isArray(item.changedFiles) ? item.changedFiles.length * 2 : 0;
    const scopeScore = item.taskType === "Large" ? 8 : item.taskType === "Medium" ? 5 : 3;
    const textScore = Math.min(12, Math.ceil(String(item.instruction || "").length / 220));
    return `+${Math.max(1, fileScore + scopeScore + textScore)} expansion`;
  };
  const instructionElapsedMs = (item) => {
    if (Number.isFinite(item.durationMs)) return item.durationMs;
    const startedAt = new Date(item.startedAt || item.recordedAt || 0).getTime();
    if (!startedAt) return null;
    const endAt = item.completedAt ? new Date(item.completedAt).getTime() : now;
    return Number.isFinite(endAt) ? Math.max(0, endAt - startedAt) : null;
  };
  const timingStatus = (item) => {
    if (item.status === "running") return "Running";
    if (item.status === "failed") return "Failed";
    return "Completed";
  };
  const agentTimingLabel = (item) => {
    const agents = item.flowPath?.activeAgents || [];
    if (!agents.length) return item.status === "running" ? "Agents active" : "Agents logged";
    const label = agents.length === 1 ? "agent" : "agents";
    return item.status === "running" ? `${agents.length} ${label} active` : `${agents.length} ${label} completed`;
  };
  const requiredDataRows = (item) =>
    (Array.isArray(item.requiredData) ? item.requiredData : [])
      .map((row) => ({
        id: row.id || row.label || "required-data",
        label: row.label || row.id || "Required data",
        value: String(row.value || "").trim()
      }))
      .filter((row) => row.value);
  const shortRequiredDataValue = (value = "") => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > 420 ? `${text.slice(0, 419)}...` : text;
  };
  return (
    <section className="instruction-history-card" aria-label="Project instruction history">
      <div className="section-heading">
        <GitBranch size={16} />
        <h2>Project instructions</h2>
      </div>
      {error ? <p className="instruction-history-error">{error}</p> : null}
      <ol>
        {visibleInstructions.length ? (
          visibleInstructions.map((item, index) => {
            const failed = item.status === "failed";
            const running = item.status === "running";
            const isInitiation = index === oldestIndex;
            const elapsedMs = instructionElapsedMs(item);
            return (
              <li className={`instruction-history-row ${failed ? "failed" : running ? "running" : "succeeded"}`} key={`${item.projectId || item.projectName}-${item.recordedAt}-${index}`}>
                <span className={`instruction-history-status ${isInitiation ? "initiation" : ""}`}>
                  {running ? <Loader2 className="spin" size={14} /> : isInitiation ? <FolderUp size={14} /> : failed ? <XCircle size={14} /> : <GitBranch size={14} />}
                </span>
                <div>
                  <strong>{item.projectName || "PlutoniX default workspace"}</strong>
                  <small>
                    {shortDate(item.recordedAt)} · {item.taskType || "Medium"} · {item.status || "received"}
                    {item.buildId ? ` · ${String(item.buildId).slice(-8)}` : ""}
                  </small>
                  <span className="instruction-completion-meta">
                    <b>{timingStatus(item)}</b>
                    <span>{elapsedMs ? formatElapsedTime(elapsedMs) : "0s"}</span>
                    <span>{agentTimingLabel(item)}</span>
                    <span>{item.completedAt ? formatIstTime(item.completedAt) : running ? "Timer live" : "Completion pending"}</span>
                  </span>
                  <em>{expansionValue(item, index)}</em>
                  <p>{item.instruction}</p>
                  {requiredDataRows(item).length ? (
                    <div className="instruction-required-data" aria-label="Required data supplied with this instruction">
                      <strong>Required data supplied</strong>
                      <dl>
                        {requiredDataRows(item).map((row, dataIndex) => (
                          <div key={`${row.id}-${dataIndex}`}>
                            <dt>{row.label}</dt>
                            <dd>{shortRequiredDataValue(row.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ) : null}
                  {item.flowPath?.activeAgents?.length ? (
                    <div className="instruction-agent-roster" aria-label="Agents used for this instruction">
                      {item.flowPath.activeAgents.map((agent, index) => (
                        <span key={`${agent.id}-${index}`} title={`${agent.name}: ${agent.action || agent.role}`}>
                          <AgentAvatar visual={agentVisualFromId(agent.id, { name: agent.name })} size="tiny" />
                          {agent.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })
        ) : (
          <li className="empty-state">Project instructions will appear here by time.</li>
        )}
      </ol>
    </section>
  );
}

function flowAgentCount(nodes = [], executedDecisions = []) {
  const agentTerms = /agent|orchestrator|qagent|human|gotham/i;
  const agentIds = new Set();
  [...nodes, ...executedDecisions].forEach((item) => {
    const value = `${item.id || ""} ${item.label || ""} ${item.value || ""} ${item.reason || ""}`;
    if (agentTerms.test(value)) agentIds.add(item.id || item.label || item.value);
  });
  return agentIds.size;
}

function flowFunctionalityCount(nodes = [], subObjectives = [], executedDecisions = []) {
  return [...nodes, ...subObjectives, ...executedDecisions].filter((item) => item?.id || item?.label).length;
}

function flowTraversalScore({ confidence, nodes, executedDecisions }) {
  const completed = nodes.filter((node) => ["completed", "selected"].includes(node.state)).length;
  const completionScore = nodes.length ? Math.round((completed / nodes.length) * 25) : 0;
  const decisionScore = Math.min(15, executedDecisions.length * 5);
  return Math.min(100, Math.round(Number(confidence || 0) * 0.6 + completionScore + decisionScore));
}

function DecisionTreeBranch({ node, depth = 0 }) {
  if (!node) return null;
  const isAgent = node.type === "agent";
  return (
    <li className={`adaptive-tree-node ${node.state || "pending"}`}>
      <div className="adaptive-tree-node-content">
        {isAgent ? <AgentAvatar visual={agentVisualFromId(node.id, { name: node.label })} size="table" /> : <GitBranch size={14} />}
        <div>
          <strong>{node.label || node.id}</strong>
          {node.role ? <span>{node.role}</span> : null}
          {node.detail || node.reason || node.action ? <small>{node.detail || node.reason || node.action}</small> : null}
        </div>
        <em>{node.state || node.type}</em>
      </div>
      {node.children?.length ? (
        <ul>{node.children.map((child) => <DecisionTreeBranch node={child} depth={depth + 1} key={`${node.id}-${child.id}`} />)}</ul>
      ) : null}
    </li>
  );
}

function OrchestrationD3Canvas({ snapshot }) {
  const svgRef = useRef(null);
  const viewportRef = useRef(null);
  const [selectedDatum, setSelectedDatum] = useState(null);
  const [agentRecords, setAgentRecords] = useState([]);
  const visualForAgent = (agentId) => {
    const snapshotAgent = (snapshot?.agents || []).find((agent) => agent.id === agentId);
    const record = agentRecords.find((agent) => agent.id === agentId) || agentRecords.find((agent) => snapshotAgent?.name && agent.name === snapshotAgent.name);
    if (record) return agentVisualFromRecord(record);
    return agentVisualFromId(agentId || "plutonix-fullstack-agent", snapshotAgent || {});
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/agents/global`)
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setAgentRecords(Array.isArray(data.agents) ? data.agents : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!snapshot || !svgRef.current || !viewportRef.current) return undefined;
    const svg = d3.select(svgRef.current);
    const viewport = viewportRef.current;
    const fallbackChoices = [
      ...(snapshot.selectedDecisions || []).map((item) => ({ ...item, state: "selected", responsibleAgentId: item.responsibleAgentId || "plutonix-fullstack-agent" })),
      ...(snapshot.rejectedDecisions || []).map((item) => ({ ...item, label: item.label || item.id, detail: item.reason, state: "rejected", responsibleAgentId: item.responsibleAgentId || "plutonix-fullstack-agent" }))
    ];
    const legacySelections = fallbackChoices.filter((item) => item.state === "selected");
    const legacyRejections = fallbackChoices.filter((item) => item.state === "rejected");
    const buildLegacyStage = (index = 0) => {
      const selection = legacySelections[index];
      if (!selection) return null;
      const rejectionStart = Math.floor((index * legacyRejections.length) / Math.max(1, legacySelections.length));
      const rejectionEnd = Math.floor(((index + 1) * legacyRejections.length) / Math.max(1, legacySelections.length));
      const selectedChoice = { ...selection, id: `legacy-selected-${index}-${selection.id}`, type: "choice", children: [] };
      const nextStage = buildLegacyStage(index + 1);
      if (nextStage) selectedChoice.children.push(nextStage);
      return {
        id: `legacy-stage-${index}`,
        label: selection.label || `Decision ${index + 1}`,
        type: "decision",
        state: "recorded",
        responsibleAgentId: selection.responsibleAgentId,
        children: [
          selectedChoice,
          ...legacyRejections.slice(rejectionStart, rejectionEnd).map((item, rejectionIndex) => ({ ...item, id: `legacy-rejected-${index}-${rejectionIndex}-${item.id}`, type: "choice", children: [] }))
        ]
      };
    };
    const graph = snapshot.decisionGraph || {
      id: `${snapshot.id}-start`, label: "Build instruction accepted", type: "start", state: "selected", responsibleAgentId: "plutonix-fullstack-agent",
      children: [buildLegacyStage()].filter(Boolean)
    };
    const hierarchy = d3.hierarchy(graph);
    const leafCount = Math.max(1, hierarchy.leaves().length);
    const width = Math.max(viewport.clientWidth || 900, (hierarchy.height + 1) * 285 + 160);
    const height = Math.max(560, leafCount * 124 + 100);
    d3.tree().nodeSize([124, 285])(hierarchy);
    const minTreeX = d3.min(hierarchy.descendants(), (item) => item.x) || 0;
    const allNodes = hierarchy.descendants().map((item) => ({
      ...item.data,
      graphId: item.data.id,
      x: item.y + 72,
      y: item.x - minTreeX + 55,
      kind: item.data.type === "choice" ? item.data.state : item.data.type,
      agentId: item.data.responsibleAgentId || "plutonix-fullstack-agent"
    }));
    const nodeById = new Map(allNodes.map((item) => [item.graphId, item]));
    const links = hierarchy.links().map((link) => ({
      source: nodeById.get(link.source.data.id),
      target: nodeById.get(link.target.data.id),
      kind: link.target.data.state || link.target.data.type || "recorded"
    }));

    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("height", height);
    const root = svg.append("g").attr("class", "orchestration-d3-root");
    const linkPath = (link) => {
      const midpoint = (link.source.x + link.target.x) / 2;
      return `M${link.source.x},${link.source.y} C${midpoint},${link.source.y} ${midpoint},${link.target.y} ${link.target.x},${link.target.y}`;
    };
    const linkSelection = root.append("g").selectAll("path").data(links).join("path")
      .attr("class", (link) => `d3-flow-link ${link.kind}`)
      .attr("d", linkPath);
    const node = root.append("g").selectAll("g").data(allNodes).join("g")
      .attr("class", (item) => `d3-flow-node ${item.kind} ${item.state || "recorded"}`)
      .attr("transform", (item) => `translate(${item.x},${item.y})`)
      .attr("tabindex", 0)
      .attr("role", "button")
      .on("click", (_event, item) => setSelectedDatum(item))
      .on("keydown", (event, item) => {
        if (event.key === "Enter" || event.key === " ") setSelectedDatum(item);
      });
    node.append("rect").attr("class", "d3-decision-card").attr("x", -110).attr("y", -39).attr("width", 220).attr("height", 78).attr("rx", 11);
    const avatarRoots = [];
    node.append("foreignObject")
      .attr("x", -12)
      .attr("y", 46)
      .attr("width", 24)
      .attr("height", 24)
      .each(function renderNodeAgent(item) {
        const mount = document.createElement("div");
        mount.className = "d3-agent-icon-mount";
        mount.onpointerdown = (event) => event.stopPropagation();
        mount.onclick = (event) => {
          event.stopPropagation();
          const workRecord = (snapshot.agentWork || []).find((record) => record.agentId === item.agentId);
          setSelectedDatum({
            kind: "agent-insight",
            state: item.state,
            agentId: item.agentId || "plutonix-fullstack-agent",
            label: workRecord?.name || visualForAgent(item.agentId).name,
            detail: workRecord?.role || "Responsible agent",
            work: workRecord?.work || [item.detail || item.reason || item.label].filter(Boolean)
          });
        };
        this.appendChild(mount);
        const avatarRoot = createRoot(mount);
        avatarRoot.render(<AgentAvatar visual={visualForAgent(item.agentId)} size="tiny" />);
        avatarRoots.push(avatarRoot);
      });
    node.append("text")
      .attr("class", "d3-flow-node-type")
      .attr("text-anchor", "middle")
      .attr("y", -16)
      .text((item) => displayEventType(item.kind || item.type));
    node.append("text")
      .attr("class", "d3-flow-node-label")
      .attr("text-anchor", "middle")
      .each(function wrapNodeLabel(item) {
        const words = String(item.label || "").split(/\s+/).filter(Boolean);
        const lines = [""];
        for (const word of words) {
          const candidate = `${lines.at(-1)} ${word}`.trim();
          if (candidate.length > 28 && lines.length < 3) lines.push(word);
          else lines[lines.length - 1] = candidate;
        }
        if (lines.length === 3 && lines[2].length > 28) lines[2] = `${lines[2].slice(0, 27)}…`;
        d3.select(this).selectAll("tspan").data(lines).join("tspan")
          .attr("x", 0)
          .attr("dy", (_line, index) => index === 0 ? 4 : 15)
          .text((line) => line);
      });
    node.call(d3.drag()
      .on("start", (event) => event.sourceEvent?.stopPropagation())
      .on("drag", function moveNode(event, item) {
        item.x = event.x;
        item.y = event.y;
        d3.select(this).attr("transform", `translate(${item.x},${item.y})`);
        linkSelection.attr("d", linkPath);
      })
      .on("end", (_event, item) => setSelectedDatum(item)));
    const zoom = d3.zoom().scaleExtent([0.55, 2.4]).on("zoom", (zoomEvent) => root.attr("transform", zoomEvent.transform));
    svg.call(zoom).call(zoom.transform, d3.zoomIdentity);
    return () => {
      svg.on(".zoom", null);
      avatarRoots.forEach((avatarRoot) => avatarRoot.unmount());
    };
  }, [agentRecords, snapshot]);

  if (!snapshot) return <div className="d3-flow-empty">No orchestration snapshot is available for this build.</div>;
  return (
    <div className="orchestration-d3-shell">
      <div className="orchestration-d3-toolbar">
        <div className="d3-flow-legend">
          <span className="selected">Selected</span><span className="rejected">Rejected</span><span className="agent">Agent</span><span className="failed">Failed</span>
        </div>
        <small>Drag nodes to arrange · drag background to pan · scroll to zoom</small>
      </div>
      <div className="orchestration-d3-workspace">
        <div className="orchestration-d3-viewport" ref={viewportRef}>
          <svg ref={svgRef} aria-label={`Orchestrator execution canvas for ${snapshot.snapshotBuildId || snapshot.buildId}`} />
        </div>
        <aside className={`d3-flow-inspector ${selectedDatum ? "visible" : ""}`}>
        {selectedDatum ? (
          <>
            <div>
              <span className="d3-inspector-agent"><AgentAvatar visual={visualForAgent(selectedDatum.agentId)} size="tiny" /><b>{selectedDatum.label || displayEventType(selectedDatum.type)}</b></span>
              <em>{selectedDatum.state || selectedDatum.kind}</em>
            </div>
            <p>{selectedDatum.detail || selectedDatum.reason || selectedDatum.message || "No additional evidence recorded."}</p>
            {selectedDatum.kind === "agent-insight" && selectedDatum.work?.length ? (
              <ul className="d3-agent-work-list">
                {selectedDatum.work.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
              </ul>
            ) : null}
            {selectedDatum.kind !== "agent-insight" && selectedDatum.type === "choice" ? (
              <small className="d3-feature-evidence">{selectedDatum.state === "rejected" ? "This option was not generated." : "This selection contributed to the generated build."}</small>
            ) : null}
            <small>{selectedDatum.agentId ? `Agent: ${selectedDatum.agentId} · ` : ""}{selectedDatum.createdAt ? shortDate(selectedDatum.createdAt) : ""}</small>
          </>
        ) : <div className="d3-inspector-empty"><GitBranch size={22} /><b>Insights</b><p>Select a decision card or agent icon to inspect its evidence.</p></div>}
        </aside>
      </div>
    </div>
  );
}

function PlutonixBrainXCanvas() {
  const svgRef = useRef(null);
  const viewportRef = useRef(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const svgElement = svgRef.current;
    if (!viewport || !svgElement) return undefined;
    let frame = 0;

    const render = () => {
      const width = Math.max(720, viewport.clientWidth || 900);
      const height = Math.max(480, viewport.clientHeight || 560);
      const center = { x: width / 2, y: height / 2 };
      const coreNodes = [
        { id: "intent", label: "Directive intake", detail: "Intent and context", x: center.x - 260, y: center.y - 122 },
        { id: "memory", label: "Memory fabric", detail: "Knowledge and recall", x: center.x + 260, y: center.y - 122 },
        { id: "policy", label: "Policy guard", detail: "Authority and safety", x: center.x - 260, y: center.y + 122 },
        { id: "control", label: "Execution control", detail: "Workflow coordination", x: center.x + 260, y: center.y + 122 }
      ];
      const thinker = {
        id: "main-thinker",
        label: "PlutoniX Main Thinker",
        detail: "Main Orchestrator Agent",
        x: center.x,
        y: center.y
      };
      const svg = d3.select(svgElement);
      svg.selectAll("*").remove();
      svg.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");
      const defs = svg.append("defs");
      const glow = defs.append("filter").attr("id", "brainx-glow").attr("x", "-80%").attr("y", "-80%").attr("width", "260%").attr("height", "260%");
      glow.append("feGaussianBlur").attr("stdDeviation", 9).attr("result", "blur");
      const merge = glow.append("feMerge");
      merge.append("feMergeNode").attr("in", "blur");
      merge.append("feMergeNode").attr("in", "SourceGraphic");
      const coreGradient = defs.append("linearGradient").attr("id", "brainx-core-fill").attr("x1", "0%").attr("y1", "0%").attr("x2", "100%").attr("y2", "100%");
      coreGradient.append("stop").attr("offset", "0%").attr("stop-color", "#0B2447");
      coreGradient.append("stop").attr("offset", "55%").attr("stop-color", "#19376D");
      coreGradient.append("stop").attr("offset", "100%").attr("stop-color", "#576CBC");
      const root = svg.append("g").attr("class", "brainx-d3-root");
      const linkGroup = root.append("g").attr("class", "brainx-d3-links");
      linkGroup.selectAll("path")
        .data(coreNodes)
        .join("path")
        .attr("d", (node) => {
          const midpointX = (node.x + thinker.x) / 2;
          return `M${thinker.x},${thinker.y} Q${midpointX},${thinker.y} ${node.x},${node.y}`;
        });
      const outer = root.append("g").attr("class", "brainx-d3-orbit").attr("transform", `translate(${thinker.x},${thinker.y})`);
      outer.append("circle").attr("r", 112).attr("class", "brainx-orbit-ring outer");
      outer.append("circle").attr("r", 91).attr("class", "brainx-orbit-ring inner");
      const core = root.append("g").attr("class", "brainx-main-thinker").attr("transform", `translate(${thinker.x},${thinker.y})`);
      core.append("circle").attr("r", 68).attr("filter", "url(#brainx-glow)").attr("class", "brainx-main-glow");
      core.append("circle").attr("r", 64).attr("fill", "url(#brainx-core-fill)").attr("class", "brainx-main-circle");
      core.append("path").attr("class", "brainx-main-mark").attr("d", "M-19,3 L-7,3 L-2,-17 L7,21 L13,3 L23,3");
      core.append("text").attr("class", "brainx-main-label").attr("text-anchor", "middle").attr("y", 90).text(thinker.label);
      core.append("text").attr("class", "brainx-main-detail").attr("text-anchor", "middle").attr("y", 108).text(thinker.detail);
      const node = root.append("g").selectAll("g").data(coreNodes).join("g")
        .attr("class", "brainx-system-node")
        .attr("transform", (item) => `translate(${item.x},${item.y})`);
      node.append("rect").attr("x", -102).attr("y", -38).attr("width", 204).attr("height", 76).attr("rx", 14);
      node.append("circle").attr("cx", -74).attr("cy", 0).attr("r", 12);
      node.append("text").attr("class", "brainx-system-label").attr("x", -52).attr("y", -4).text((item) => item.label);
      node.append("text").attr("class", "brainx-system-detail").attr("x", -52).attr("y", 15).text((item) => item.detail);
      const zoom = d3.zoom().scaleExtent([0.7, 2.2]).on("zoom", (event) => root.attr("transform", event.transform));
      svg.call(zoom).call(zoom.transform, d3.zoomIdentity);
    };

    const scheduleRender = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(render);
    };
    const observer = new ResizeObserver(scheduleRender);
    observer.observe(viewport);
    scheduleRender();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      d3.select(svgElement).on(".zoom", null);
    };
  }, []);

  return (
    <section className="plutonix-brainx-canvas">
      <header className="plutonix-brainx-header">
        <div>
          <span>PlutoniX-BrainX</span>
          <h2>Core reasoning system</h2>
        </div>
        <small>System core only · no generated-project agents or nodes</small>
      </header>
      <div className="plutonix-brainx-viewport" ref={viewportRef}>
        <svg ref={svgRef} aria-label="PlutoniX BrainX core system canvas" />
      </div>
    </section>
  );
}

function FunctionalityGraphWorkspace({ graph, selectedNodeId, onSelectNode, onOpenStudioResource, detailed = false }) {
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const graphLayerRef = useRef(null);
  const nodeDragRef = useRef(null);
  const zoomRef = useRef(null);
  const zoomTransformRef = useRef(d3.zoomIdentity);
  const [nodeOverrides, setNodeOverrides] = useState({});
  const previousNodeIdsRef = useRef(null);
  const [newNodeIds, setNewNodeIds] = useState(() => new Set());
  const graphResetKey = useMemo(() => {
    const nodes = (graph?.nodes || [])
      .map((node) => `${node.id}:${node.kind || ""}:${node.state || ""}:${node.changeKind || ""}`)
      .sort()
      .join("|");
    const links = (graph?.links || [])
      .map((link) => `${link.source}->${link.target}:${link.kind || ""}`)
      .sort()
      .join("|");
    return `${graph?.projectId || ""}:${graph?.name || ""}:${nodes}:${links}`;
  }, [graph]);
  const layout = useMemo(
    () => layoutFunctionalityGraph(graph, detailed ? 1080 : 620, detailed ? 700 : 520),
    [detailed, graph]
  );
  const displayNodes = useMemo(
    () =>
      layout.nodes.map((node) => ({
        ...node,
        ...(nodeOverrides[node.id] || {})
      })),
    [layout.nodes, nodeOverrides]
  );
  const displayNodeMap = useMemo(() => new Map(displayNodes.map((node) => [node.id, node])), [displayNodes]);
  const displayLinks = useMemo(
    () =>
      layout.links
        .map((link) => ({
          ...link,
          sourceNode: displayNodeMap.get(link.source),
          targetNode: displayNodeMap.get(link.target)
        }))
        .filter((link) => link.sourceNode && link.targetNode),
    [displayNodeMap, layout.links]
  );
  const insights = useMemo(
    () => functionalityNodeInsights(graph, selectedNodeId),
    [graph, selectedNodeId]
  );
  const shortNodeLabel = (label, limit = 22) => {
    const value = String(label || "");
    return value.length > limit ? `${value.slice(0, limit - 1)}...` : value;
  };
  const isNodeInProgress = (node) => /running|working|progress|pending|queued|executing|building/i.test(String(node.state || graph.status || ""));

  useEffect(() => {
    const currentIds = new Set((graph.nodes || []).map((node) => node.id));
    const previousIds = previousNodeIdsRef.current;
    previousNodeIdsRef.current = currentIds;
    if (!previousIds) return undefined;
    const additions = [...currentIds].filter((id) => !previousIds.has(id));
    if (!additions.length) return undefined;
    setNewNodeIds(new Set(additions));
    const timer = window.setTimeout(() => setNewNodeIds(new Set()), 720);
    return () => window.clearTimeout(timer);
  }, [graphResetKey, graph.nodes]);

  useEffect(() => {
    setNodeOverrides({});
    zoomTransformRef.current = d3.zoomIdentity;
    if (graphLayerRef.current) {
      d3.select(graphLayerRef.current).attr("transform", d3.zoomIdentity.toString());
    }
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).call(zoomRef.current.transform, d3.zoomIdentity);
    }
  }, [detailed, graphResetKey]);

  useEffect(() => {
    if (!detailed || !svgRef.current || !graphLayerRef.current) return undefined;
    const svg = d3.select(svgRef.current);
    const graphLayer = d3.select(graphLayerRef.current);
    const zoom = d3
      .zoom()
      .scaleExtent([0.35, 2.8])
      .extent([[0, 0], [layout.width, layout.height]])
      .filter((event) => {
        if (event.type === "wheel") return true;
        return !event.target.closest?.(".functionality-graph-node");
      })
      .on("zoom", (event) => {
        zoomTransformRef.current = event.transform;
        graphLayer.attr("transform", event.transform.toString());
      });
    zoomRef.current = zoom;
    svg.call(zoom);
    svg.call(zoom.transform, zoomTransformRef.current);
    return () => {
      svg.on(".zoom", null);
      if (zoomRef.current === zoom) zoomRef.current = null;
    };
  }, [detailed, layout.width, layout.height]);

  useEffect(() => {
    if (!detailed || !graphLayerRef.current) return;
    d3.select(graphLayerRef.current).attr("transform", zoomTransformRef.current.toString());
  });

  useEffect(() => {
    if (!detailed || !canvasRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (canvas) canvas.scrollLeft = Math.max(0, (canvas.scrollWidth - canvas.clientWidth) / 2);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detailed, layout.width]);

  function graphPointFromEvent(event) {
    const svg = svgRef.current;
    const graphLayer = graphLayerRef.current;
    if (!svg || !graphLayer) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = graphLayer.getScreenCTM();
    if (!matrix) return null;
    return point.matrixTransform(matrix.inverse());
  }

  function startNodeDrag(event, node) {
    if (!detailed) return;
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent?.stopImmediatePropagation?.();
    const point = graphPointFromEvent(event);
    if (!point) return;
    nodeDragRef.current = {
      id: node.id,
      pointerId: event.pointerId,
      offsetX: node.x - point.x,
      offsetY: node.y - point.y
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveNodeDrag(event) {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = graphPointFromEvent(event);
    if (!point) return;
    setNodeOverrides((current) => ({
      ...current,
      [drag.id]: {
        x: Math.max(40, Math.min(layout.width - 40, point.x + drag.offsetX)),
        y: Math.max(40, Math.min(layout.height - 40, point.y + drag.offsetY))
      }
    }));
  }

  function stopNodeDrag(event) {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    nodeDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  return (
    <div className={`functionality-graph-layout ${detailed ? "detailed" : ""}`}>
      <div className="functionality-graph-canvas" ref={canvasRef}>
        <svg
          ref={svgRef}
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={`Functionality graph for ${graph.projectName || "project"}`}
        >
          <defs>
            <linearGradient id={`functionality-rainbow-${detailed ? "detail" : "compact"}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ef4444" /><stop offset="18%" stopColor="#f59e0b" /><stop offset="36%" stopColor="#eab308" /><stop offset="54%" stopColor="#22c55e" /><stop offset="72%" stopColor="#06b6d4" /><stop offset="88%" stopColor="#6366f1" /><stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
          </defs>
          <g className="functionality-graph-viewport" ref={graphLayerRef}>
          <g className="functionality-graph-links">
            {displayLinks.map((link) => (
              <line
                key={link.id}
                className={link.type === "contains_subfunctionality" ? "subfunction-link" : "function-link"}
                x1={link.sourceNode.x}
                y1={link.sourceNode.y}
                x2={link.targetNode.x}
                y2={link.targetNode.y}
              />
            ))}
          </g>
          <g className="functionality-graph-nodes">
            {displayNodes.map((node) => {
              const selected = node.id === insights.node?.id;
              const labelLimit = node.type === "subfunctionality" ? 18 : 22;
              return (
                <g
                  key={node.id}
                  className={`functionality-graph-node ${node.type} ${node.origin || "execution"} ${node.changeKind || ""} ${node.state || "recorded"} ${selected ? "selected" : ""} ${newNodeIds.has(node.id) ? "node-enter" : ""} ${isNodeInProgress(node) ? "node-in-progress" : ""} ${detailed ? "draggable" : ""}`}
                  role="button"
                  tabIndex="0"
                  aria-label={`${node.type}: ${node.label}`}
                  onClick={() => onSelectNode(node.id)}
                  onPointerDown={(event) => startNodeDrag(event, node)}
                  onPointerMove={moveNodeDrag}
                  onPointerUp={stopNodeDrag}
                  onPointerCancel={stopNodeDrag}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectNode(node.id);
                    }
                  }}
                >
                  {selected ? <circle className="node-focus-ring" cx={node.x} cy={node.y} r={node.radius + 7} /> : null}
                  {isNodeInProgress(node) ? <circle className="node-progress-ring" cx={node.x} cy={node.y} r={node.radius + 7} /> : null}
                  <circle className="node-body" cx={node.x} cy={node.y} r={node.radius} />
                  <text
                    className="node-type-mark"
                    x={node.x}
                    y={node.y + 3}
                    textAnchor="middle"
                  >
                    {node.type === "project" ? "P" : node.type === "functionality" ? "F" : "S"}
                  </text>
                  <text
                    className="node-label"
                    x={node.x}
                    y={node.y + node.radius + 14}
                    textAnchor="middle"
                  >
                    {shortNodeLabel(node.label, labelLimit)}
                  </text>
                </g>
              );
            })}
          </g>
          </g>
        </svg>
      </div>
      <aside className="functionality-node-insights" aria-live="polite">
        {insights.node ? (
          <>
            <span className="functionality-node-kind">
              {insights.node.origin === "initial_instruction" ? "first instruction · " : ""}
              {String(insights.node.type || "node").replaceAll("_", " ")}
            </span>
            <h3>{insights.node.label}</h3>
            <p>{insights.node.detail || "No additional detail was recorded for this node."}</p>
            {insights.node.studioResource ? (
              <button
                type="button"
                className="functionality-studio-resource-action"
                onClick={() => onOpenStudioResource?.(insights.node.studioResource)}
              >
                <FlaskConical size={13} />
                {insights.node.studioResource.type === "ml_pipeline" ? "Open ML pipeline" : "Open in Gotham Studio"}
              </button>
            ) : null}
            <dl>
              <div><dt>Status</dt><dd>{insights.node.state || graph.status || "recorded"}</dd></div>
              <div><dt>Child nodes</dt><dd>{insights.children.length}</dd></div>
            </dl>
            <div className="functionality-agent-insights">
              <strong>Working agents</strong>
              {insights.agents.length ? (
                <ul>
                  {insights.agents.map((agent, index) => (
                    <li key={`${agent.id}-${index}`}>
                      <AgentAvatar visual={agentVisualFromRecord(agent)} size="tiny" />
                      <span><b>{agent.name}</b><small>{agent.role} · {agent.status}</small></span>
                    </li>
                  ))}
                </ul>
              ) : <small>No agent assignment was recorded for this node.</small>}
            </div>
            {insights.node.evidence?.length ? (
              <div className="functionality-node-evidence">
                <strong>Evidence</strong>
                <ul>{insights.node.evidence.slice(0, 3).map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
              </div>
            ) : null}
          </>
        ) : null}
      </aside>
    </div>
  );
}

function FunctionalityNodalAnalysis({ projectId = "", flowPath, onOpenStudioResource }) {
  const graph = useMemo(
    () => normalizeFunctionalityGraph(flowPath || {}, projectId),
    [flowPath, projectId]
  );
  const [selectedNodeId, setSelectedNodeId] = useState(graph.rootId || graph.nodes[0]?.id || "");
  const [showDetail, setShowDetail] = useState(false);
  const detailCloseRef = useRef(null);
  const summary = graph.summary || {};

  useEffect(() => {
    if (!graph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(graph.rootId || graph.nodes[0]?.id || "");
    }
  }, [graph, selectedNodeId]);

  useEffect(() => {
    if (!showDetail) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setShowDetail(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    detailCloseRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showDetail]);

  const graphSummary = (
    <>
      {summary.initialFunctionalityCount ? `${summary.initialFunctionalityCount} initial · ` : ""}
      {summary.functionalityCount || 0} functions · {summary.subfunctionalityCount || 0} sub-functions
    </>
  );

  const detailModal =
    showDetail && typeof document !== "undefined"
      ? createPortal(
          <div className="modal-backdrop functionality-detail-backdrop" role="presentation" onMouseDown={() => setShowDetail(false)}>
            <section
              className="functionality-detail-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`Functionality analysis for ${graph.projectName || "project"}`}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="functionality-detail-header">
                <span className="functionality-detail-mark"><Network size={20} /></span>
                <div>
                  <span>Functionality analysis</span>
                  <h2>{graph.projectName || "Project functionality"}</h2>
                  <p>{graphSummary}</p>
                </div>
                <button
                  ref={detailCloseRef}
                  className="icon-button"
                  type="button"
                  onClick={() => setShowDetail(false)}
                  aria-label="Close functionality analysis"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </header>
              <FunctionalityGraphWorkspace
                graph={graph}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onOpenStudioResource={onOpenStudioResource}
                detailed
              />
            </section>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <section className="functionality-analysis" aria-label="Project functionality nodal analysis">
        <header className="functionality-analysis-heading">
          <span><Network size={15} /></span>
          <div>
            <strong>Functionality analysis</strong>
            <small>{graphSummary}</small>
          </div>
          <button
            className="icon-button functionality-detail-action"
            type="button"
            onClick={() => setShowDetail(true)}
            aria-label="Open detailed functionality analysis"
            title="Open detail window"
          >
            <Maximize2 size={15} />
          </button>
        </header>
        <FunctionalityGraphWorkspace
          graph={graph}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onOpenStudioResource={onOpenStudioResource}
        />
      </section>
      {detailModal}
    </>
  );
}

function ProjectFlowPanel({ projectId = "", flowPath, decisionHistory = [], expanded, running, onToggle, onHumanChoice, onOpenStudioResource }) {
  const [detailPage, setDetailPage] = useState(() => typeof window !== "undefined" && window.location.hash === "#execution-snapshot" ? "snapshot" : "");
  const [historyCursor, setHistoryCursor] = useState(0);
  const [isHistoryPlaying, setHistoryPlaying] = useState(false);
  const [selectedSnapshotIndex, setSelectedSnapshotIndex] = useState(0);
  const historyStorageKey = `plutonix-flow-path-history:${projectId || String(flowPath?.projectName || "plutonix-default").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const [pathHistory, setPathHistory] = useState(() => {
    try {
      const scopedValue = localStorage.getItem(historyStorageKey);
      const legacy = JSON.parse(localStorage.getItem("plutonix-flow-path-history") || "[]");
      const stored = scopedValue
        ? JSON.parse(scopedValue)
        : (Array.isArray(legacy) ? legacy.filter((entry) => entry.projectName === flowPath?.projectName) : []);
      return Array.isArray(stored) ? stored.slice(-20) : [];
    } catch {
      return [];
    }
  });
  const nodes = flowPath?.nodes?.length ? flowPath.nodes : defaultProjectFlowNodes;
  const subObjectives = flowPath?.subObjectives?.length ? flowPath.subObjectives : defaultSubObjectiveFlow;
  const executedDecisions = flowPath?.executedDecisions || [];
  const rejectedPaths = flowPath?.rejectedPaths || [];
  const activeAgents = flowPath?.activeAgents || [];
  const functionalities = flowPath?.functionalities || [];
  const featureActions = flowPath?.featureActions || [];
  const decisionTree = flowPath?.decisionTree || null;
  const intelRuntime = flowPath?.intel || null;
  const intelProposals = intelRuntime?.proposals || [];
  const intelTaskNodes = intelRuntime?.taskGraph?.nodes || [];
  const intelRuns = intelRuntime?.agentRuns || [];
  const persistedDecisionHistory = useMemo(
    () => decisionHistory.filter((entry) => entry?.flowPath?.decisionTree),
    [decisionHistory]
  );
  const buildSnapshots = useMemo(() => persistedDecisionHistory.map((entry) => entry.orchestrationSnapshot || {
    schemaVersion: 0,
    id: `${entry.parentWorkflowId || entry.buildId || entry.recordedAt}:legacy`,
    snapshotBuildId: entry.buildId || `legacy_${String(entry.parentWorkflowId || "build").slice(-10)}`,
    buildId: entry.buildId || "",
    parentWorkflowId: entry.parentWorkflowId || "",
    projectId: entry.projectId || projectId,
    projectName: entry.projectName,
    instruction: entry.instruction,
    taskType: entry.taskType,
    status: entry.status,
    startedAt: entry.recordedAt,
    completedAt: entry.recordedAt,
    durationMs: 0,
    route: entry.adaptiveRoute,
    agents: entry.flowPath?.activeAgents || [],
    selectedDecisions: entry.flowPath?.executedDecisions || [],
    rejectedDecisions: entry.flowPath?.rejectedPaths || [],
    decisionTree: entry.flowPath?.decisionTree || null,
    changedFiles: entry.changedFiles || [],
    validation: { status: entry.status === "succeeded" ? "passed" : "failed", error: entry.error || "" },
    timeline: [{
      id: `${entry.parentWorkflowId || entry.buildId || entry.recordedAt}-terminal`,
      sequence: 1,
      type: entry.status === "succeeded" ? "plutonix-complete" : "plutonix-failed",
      message: entry.error || `Legacy ${entry.status} build snapshot`,
      createdAt: entry.recordedAt,
      elapsedMs: 0,
      agentId: "plutonix-fullstack-agent",
      status: entry.status
    }]
  }).reverse(), [persistedDecisionHistory, projectId]);
  const selectedBuildSnapshot = buildSnapshots[selectedSnapshotIndex] || buildSnapshots.at(-1) || null;
  const selectedNode = nodes.find((node) => node.state === "selected") || nodes.find((node) => node.id === flowPath?.selectedPath);
  const summary =
    flowPath?.summary ||
    (running ? "PlutoniX is selecting the project creation path." : "Project creation path is ready for review.");
  const confidence = Number(flowPath?.confidence || (running ? 68 : 0));
  const agentCount = flowAgentCount(nodes, executedDecisions);
  const functionalityCount = flowFunctionalityCount(nodes, subObjectives, executedDecisions);
  const traversalScore = flowTraversalScore({ confidence, nodes, executedDecisions });
  const orderedPathHistory = useMemo(() => pathHistory.slice(), [pathHistory]);
  const activeHistoryEntry = orderedPathHistory[historyCursor] || orderedPathHistory.at(-1) || null;
  const canPlayHistory = orderedPathHistory.length > 1;
  const historyKey = [
    flowPath?.projectName || "Project creation",
    selectedNode?.id || flowPath?.selectedPath || "none",
    flowPath?.status || "ready",
    confidence,
    traversalScore
  ].join(":");
  const flowStatusIcon = (state) => {
    if (state === "completed") return <CheckCircle2 className="flow-status-icon success" size={16} aria-label="Completed" />;
    if (state === "blocked" || state === "failed") return <XCircle className="flow-status-icon failed" size={16} aria-label="Failed" />;
    return null;
  };

  const openDetailPage = (page) => {
    setDetailPage(page);
    if (page === "snapshot" && window.location.hash !== "#execution-snapshot") {
      window.history.pushState({ flowPage: "execution-snapshot" }, "", "#execution-snapshot");
    }
  };

  const closeDetailPage = () => {
    if (detailPage === "snapshot" && window.location.hash === "#execution-snapshot") {
      window.history.back();
      return;
    }
    setDetailPage("");
  };

  useEffect(() => {
    const syncPageFromHistory = () => setDetailPage(window.location.hash === "#execution-snapshot" ? "snapshot" : "");
    window.addEventListener("popstate", syncPageFromHistory);
    return () => window.removeEventListener("popstate", syncPageFromHistory);
  }, []);

  useEffect(() => {
    if (!selectedNode) return;
    setPathHistory((current) => {
      if (current.at(-1)?.key === historyKey) return current;
      const next = [
        ...current,
        {
          key: historyKey,
          recordedAt: new Date().toISOString(),
          projectName: flowPath?.projectName || "Project creation",
          selectedPath: selectedNode.label || selectedNode.id,
          status: flowPath?.status || "ready",
          traversalScore,
          agentCount,
          functionalityCount
        }
      ].slice(-20);
      localStorage.setItem(historyStorageKey, JSON.stringify(next));
      return next;
    });
  }, [agentCount, flowPath?.projectName, flowPath?.status, functionalityCount, historyKey, historyStorageKey, selectedNode, traversalScore]);

  useEffect(() => {
    if (!orderedPathHistory.length) {
      setHistoryCursor(0);
      setHistoryPlaying(false);
      return;
    }
    setHistoryCursor((current) => Math.min(current, orderedPathHistory.length - 1));
  }, [orderedPathHistory.length]);

  useEffect(() => {
    if (detailPage && orderedPathHistory.length) {
      setHistoryCursor(orderedPathHistory.length - 1);
    }
    if (detailPage && buildSnapshots.length) {
      setSelectedSnapshotIndex(buildSnapshots.length - 1);
    }
  }, [buildSnapshots.length, detailPage, orderedPathHistory.length]);

  useEffect(() => {
    if (!isHistoryPlaying || !canPlayHistory) return undefined;
    const timer = window.setInterval(() => {
      setHistoryCursor((current) => {
        if (current >= orderedPathHistory.length - 1) {
          setHistoryPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [canPlayHistory, isHistoryPlaying, orderedPathHistory.length]);

  const flowDetailModal =
    detailPage && typeof document !== "undefined"
      ? createPortal(
          <div className={detailPage === "snapshot" ? "flow-route-page" : "modal-backdrop agent-modal-backdrop flow-detail-backdrop"} role={detailPage === "snapshot" ? undefined : "presentation"} onMouseDown={detailPage === "snapshot" ? undefined : closeDetailPage}>
            <section className={`${detailPage === "snapshot" ? "flow-route-surface" : "agent-modal"} flow-detail-modal ${detailPage}-page`} role={detailPage === "snapshot" ? "main" : "dialog"} aria-modal={detailPage === "snapshot" ? undefined : "true"} aria-label={`${detailPage} flow page`} onMouseDown={(event) => event.stopPropagation()}>
              <header className="agent-modal-header">
                <div className="flow-detail-mark">
                  <GitBranch size={24} />
                </div>
                <div>
                  <span>{detailPage === "decision" ? "Decision path" : "Execution snapshot"}</span>
                  <h2>{flowPath?.projectName || "Project creation"}</h2>
                  <p>{selectedNode ? `Selected path: ${selectedNode.label}` : "No selected path yet"} · Score {traversalScore}/100</p>
                </div>
                <button className="icon-button" type="button" onClick={closeDetailPage} aria-label={detailPage === "snapshot" ? "Back to PlutoniX" : "Close flow path detail"}>
                  {detailPage === "snapshot" ? <ChevronRight className="flow-back-icon" size={18} /> : <X size={18} />}
                </button>
              </header>
              <div className="flow-detail-body">
                {detailPage === "decision" ? <>
                <div className="flow-selected-path-card">
                  <span>Selected path</span>
                  <strong>{selectedNode?.label || flowPath?.selectedPath || "Not selected"}</strong>
                  <p>{selectedNode?.detail || summary}</p>
                </div>
                <div className="flow-detail-metrics">
                  <div>
                    <span>Traversal score</span>
                    <strong>{traversalScore}/100</strong>
                  </div>
                  <div>
                    <span>Total agents</span>
                    <strong>{agentCount}</strong>
                  </div>
                  <div>
                    <span>Total functionalities</span>
                    <strong>{functionalityCount}</strong>
                  </div>
                  <div>
                    <span>History</span>
                    <strong>{pathHistory.length}</strong>
                  </div>
                </div>
                </> : null}
                {detailPage === "snapshot" ? (
                <section className="flow-build-canvas-card" aria-label="Build orchestration snapshots">
                  <header>
                    <div>
                      <span>Execution snapshot</span>
                      <strong>{selectedBuildSnapshot?.snapshotBuildId || "No build recorded"}</strong>
                      <small>
                        {selectedBuildSnapshot
                          ? `${selectedBuildSnapshot.status} · ${selectedBuildSnapshot.timeline?.length || 0} timed events · ${selectedBuildSnapshot.agents?.length || 0} agents`
                          : "Run an instruction to create the first snapshot."}
                      </small>
                    </div>
                    {buildSnapshots.length ? (
                      <select value={selectedSnapshotIndex} onChange={(event) => setSelectedSnapshotIndex(Number(event.target.value))} aria-label="Select build snapshot">
                        {buildSnapshots.map((snapshot, index) => (
                          <option value={index} key={snapshot.id || snapshot.snapshotBuildId}>
                            {snapshot.status === "succeeded" ? "✓" : "×"} {snapshot.snapshotBuildId} · {shortDate(snapshot.completedAt)}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </header>
                  <OrchestrationD3Canvas snapshot={selectedBuildSnapshot} />
                </section>
                ) : null}
                {detailPage === "decision" ? (
                <div className="flow-tree-layout flow-history-layout">
                  <div className="flow-tree-card">
                    <h3>Adaptive decision tree</h3>
                    {decisionTree ? <ul className="adaptive-decision-tree"><DecisionTreeBranch node={decisionTree} /></ul> : <ul className="flow-tree">
                      <li>
                        <span className="tree-root">{flowPath?.projectName || "Project creation"}</span>
                        <ul>
                          <li>
                            <span>Sub objectives</span>
                            <ul>
                              {subObjectives.map((item) => (
                                <li className={item.state || "pending"} key={item.id || item.label}>
                                  <span>{item.label}</span>
                                  <small>{item.detail}</small>
                                </li>
                              ))}
                            </ul>
                          </li>
                          <li>
                            <span>Path traversal</span>
                            <ul>
                              {nodes.map((node) => (
                                <li className={`${node.state || "pending"} ${node.id === selectedNode?.id ? "current" : ""}`} key={node.id}>
                                  <span>{node.label}</span>
                                  <small>{node.detail}</small>
                                </li>
                              ))}
                            </ul>
                          </li>
                          {executedDecisions.length ? (
                            <li>
                              <span>Executed decisions</span>
                              <ul>
                                {executedDecisions.map((decision) => (
                                  <li className="completed" key={decision.id || decision.label}>
                                    <span>{decision.label}</span>
                                    <small>{decision.reason}</small>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ) : null}
                          {rejectedPaths.length ? (
                            <li>
                              <span>Rejected paths</span>
                              <ul>
                                {rejectedPaths.map((pathOption) => (
                                  <li className="disabled" key={pathOption.id || pathOption.reason}>
                                    <span>{pathOption.id}</span>
                                    <small>{pathOption.reason}</small>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ) : null}
                        </ul>
                      </li>
                    </ul>}
                  </div>
                  <div className="flow-history-card">
                    <h3>Decision history over time</h3>
                    <div className="flow-history-runtime" aria-label="Selected path history runtime">
                      <button
                        className="icon-button flow-history-play"
                        type="button"
                        onClick={() => {
                          if (isHistoryPlaying) {
                            setHistoryPlaying(false);
                            return;
                          }
                          if (historyCursor >= orderedPathHistory.length - 1) {
                            setHistoryCursor(0);
                          }
                          setHistoryPlaying(true);
                        }}
                        disabled={!canPlayHistory}
                        aria-label={isHistoryPlaying ? "Pause selected path history" : "Play selected path history"}
                        title={isHistoryPlaying ? "Pause" : "Play"}
                      >
                        {isHistoryPlaying ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <div className="flow-history-slider-wrap">
                        <div className="flow-history-current">
                          <strong>{activeHistoryEntry?.selectedPath || "No history yet"}</strong>
                          <span>
                            {activeHistoryEntry
                              ? `${shortDate(activeHistoryEntry.recordedAt)} · Score ${activeHistoryEntry.traversalScore}/100`
                              : "Selected paths will appear after execution."}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={Math.max(0, orderedPathHistory.length - 1)}
                          value={Math.min(historyCursor, Math.max(0, orderedPathHistory.length - 1))}
                          disabled={!orderedPathHistory.length}
                          onChange={(event) => {
                            setHistoryPlaying(false);
                            setHistoryCursor(Number(event.target.value));
                          }}
                          aria-label="Scrub selected path history"
                        />
                        <div className="flow-history-runtime-meta">
                          <span>{orderedPathHistory.length ? historyCursor + 1 : 0}</span>
                          <span>{orderedPathHistory.length}</span>
                        </div>
                      </div>
                    </div>
                    <ol>
                      {persistedDecisionHistory.map((entry) => (
                        <li key={`${entry.recordedAt}-${entry.parentWorkflowId || entry.buildId}`}>
                          <strong>{entry.flowPath?.adaptiveRoute?.mode || entry.flowPath?.selectedPath || "workflow"}</strong>
                          <span>{shortDate(entry.recordedAt)} · {entry.taskType}</span>
                          <small>{entry.instruction}</small>
                          <small>{entry.flowPath?.activeAgents?.length || 0} agents · {entry.flowPath?.featureActions?.length || entry.changedFiles?.length || 0} actions</small>
                        </li>
                      ))}
                      {orderedPathHistory.slice().reverse().map((entry) => (
                        <li className={entry.key === activeHistoryEntry?.key ? "active" : ""} key={entry.key}>
                          <strong>{entry.selectedPath}</strong>
                          <span>{shortDate(entry.recordedAt)} · {entry.projectName}</span>
                          <small>Score {entry.traversalScore}/100 · {entry.agentCount} agents · {entry.functionalityCount} functionalities</small>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
                ) : null}
              </div>
            </section>
          </div>,
          document.body
        )
      : null;

  return (
    <section className={`project-flow-panel ${expanded ? "expanded" : "collapsed"} ${running ? "running" : ""}`} aria-label="Project creation flow path">
      <button className="project-flow-toggle" type="button" onClick={onToggle} aria-expanded={expanded} title={expanded ? "Collapse flow path" : "Expand flow path"}>
        {expanded ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        <GitBranch size={17} />
        <span>Flow path</span>
        {!expanded && selectedNode ? <b>{selectedNode.label}</b> : null}
      </button>
      {expanded ? (
        <div className="project-flow-body flow-matrix-only">
          <div className="flow-matrix-heading">
            <div><strong>{flowPath?.projectName || "Project creation"}</strong><span>Orchestration matrix</span></div>
            <b className={flowPath?.status || "idle"}>{flowPath?.status || "idle"}</b>
          </div>
          <dl className="path-score-grid" aria-label="Flow path matrix">
            <div><dt>Traversal</dt><dd>{traversalScore}/100</dd></div>
            <div><dt>Confidence</dt><dd>{confidence || 0}%</dd></div>
            <div><dt>Agents</dt><dd>{activeAgents.length || agentCount}</dd></div>
            <div><dt>Builds</dt><dd>{buildSnapshots.length}</dd></div>
            <div><dt>Selected</dt><dd>{executedDecisions.length}</dd></div>
            <div><dt>Rejected</dt><dd>{rejectedPaths.length}</dd></div>
          </dl>
          {intelRuntime ? (
            <section className="intel-runtime-card" aria-label="PlutoniX Intel runtime">
              <header>
                <div>
                  <span>PlutoniX Intel</span>
                  <strong>{intelRuntime.profile?.displayName || intelRuntime.profile?.id || "Profile pending"}</strong>
                </div>
                <b className={intelRuntime.profile?.status || intelRuntime.status || "pending"}>{intelRuntime.profile?.status || intelRuntime.status || "pending"}</b>
              </header>
              <dl>
                <div><dt>Detection</dt><dd>{intelRuntime.profileSelection?.confidence ?? 0}%</dd></div>
                <div><dt>Phase</dt><dd>{String(intelRuntime.phase || "pending").replaceAll("-", " ")}</dd></div>
                <div><dt>Transport</dt><dd>{intelRuntime.provider?.transport || "not started"}{intelRuntime.provider?.fallback ? " fallback" : ""}</dd></div>
                <div><dt>Proposals</dt><dd>{intelProposals.filter((proposal) => proposal.status === "accepted").length} accepted · {intelProposals.filter((proposal) => proposal.status === "rejected").length} rejected · {intelProposals.filter((proposal) => proposal.status === "deferred").length} deferred</dd></div>
              </dl>
              <div className="intel-runtime-list">
                <strong>Executed agents</strong>
                {intelRuns.length ? intelRuns.map((run) => <span key={run.id} className={run.status}>{run.name || run.role} · {run.status}</span>) : <span className="planned">No agent run has started.</span>}
              </div>
              <div className="intel-runtime-list">
                <strong>Plan status</strong>
                {intelTaskNodes.map((node) => <span key={node.id} className={node.status}>{node.role.replaceAll("-", " ")} · {node.status}</span>)}
              </div>
              {intelRuntime.failure?.reason ? <p className="intel-runtime-failure">{intelRuntime.failure.reason}{intelRuntime.failure.retryable ? " Retryable when the provider is available." : ""}</p> : null}
            </section>
          ) : null}
          <div className="flow-page-actions">
            <button type="button" onClick={() => openDetailPage("decision")}>
              <GitBranch size={16} /><span><strong>Decision path</strong><small>Choices, reasons and history</small></span><ChevronRight size={15} />
            </button>
            <button type="button" onClick={() => openDetailPage("snapshot")}>
              <Activity size={16} /><span><strong>Execution snapshot</strong><small>Movable sequential graph</small></span><ChevronRight size={15} />
            </button>
          </div>
          <FunctionalityNodalAnalysis projectId={projectId} flowPath={flowPath} onOpenStudioResource={onOpenStudioResource} />
        </div>
      ) : null}
      {flowDetailModal}
    </section>
  );
}

function usageValue(value, suffix = "") {
  return value === null || value === undefined || value === "" ? "Not exposed by provider" : `${Number.isFinite(Number(value)) ? Number(value).toLocaleString() : value}${suffix}`;
}

function usageTimestamp(value) {
  if (!value) return "Not updated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not updated";
  return `${date.toLocaleString()} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
}

function GothamAccountUsagePanel({ data, loading, error, expanded, onExpandedChange, onRefresh }) {
  const [openProvider, setOpenProvider] = useState("");
  const providers = Array.isArray(data?.providers) ? data.providers : [];
  const activeProvider = providers.find((provider) => provider.id === data?.activeProvider) || providers[0] || null;

  useEffect(() => {
    if (activeProvider?.id) setOpenProvider(activeProvider.id);
  }, [activeProvider?.id]);

  async function copyProviderAccountId(accountId) {
    if (!accountId || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(accountId).catch(() => {});
  }

  function providerCard(provider) {
    const account = provider.account || {};
    const conversation = provider.conversation || {};
    const allowance = provider.allowance || {};
    const context = provider.contextWindow || {};
    const isOpen = openProvider === provider.id;
    const providerId = `gotham-account-provider-${provider.id}`;
    return (
      <article className={`gotham-usage-provider ${provider.active ? "active" : ""}`} key={provider.id}>
        <button
          type="button"
          className="gotham-usage-provider-head"
          onClick={() => setOpenProvider(isOpen ? "" : provider.id)}
          aria-expanded={isOpen}
          aria-controls={providerId}
        >
          <span><UserRound size={14} /><strong>{provider.label}</strong>{provider.active ? <b>Active conversation</b> : null}</span>
          <span className={`gotham-usage-status ${provider.connection?.status || "unavailable"}`}>{provider.connection?.status || "unavailable"}<ChevronDown size={14} /></span>
        </button>
        {isOpen ? (
          <div id={providerId} className="gotham-usage-provider-body">
            <dl className="gotham-usage-fields">
              <div><dt>Provider account ID</dt><dd title={account.providerAccountId || account.providerAccountIdReason || "Not exposed by provider"}>{account.providerAccountId || "Not exposed by provider"}{account.providerAccountId ? <button type="button" onClick={() => copyProviderAccountId(account.providerAccountId)} aria-label={`Copy ${provider.label} provider account ID`}><Copy size={12} /></button> : null}</dd></div>
              <div><dt>Identity</dt><dd>{account.displayName || account.email || account.username || "Not exposed by provider"}</dd></div>
              <div><dt>Organization / plan</dt><dd>{[account.organization, account.workspace, account.plan].filter(Boolean).join(" · ") || "Not exposed by provider"}</dd></div>
              <div><dt>Authentication</dt><dd>{account.authenticationMode || "Not exposed by provider"}</dd></div>
            </dl>
            <section className="gotham-usage-group" aria-label={`${provider.label} conversation usage`}>
              <header><strong>This conversation</strong><small>{conversation.availability === "available" ? `${conversation.classification || "estimated"} · ${conversation.source || "Gotham runtime"}` : conversation.availabilityReason}</small></header>
              <div className="gotham-usage-metrics">
                <span><small>Input</small><b>{usageValue(conversation.inputTokens)}</b></span>
                <span><small>Output</small><b>{usageValue(conversation.outputTokens)}</b></span>
                <span><small>Cached</small><b>{usageValue(conversation.cachedTokens)}</b></span>
                <span><small>Total</small><b>{usageValue(conversation.totalTokens)}</b></span>
              </div>
              <p>{conversation.model ? `${conversation.provider || provider.label} · ${conversation.model}` : "Provider/model details unavailable."}{conversation.cost ? ` · Estimated cost ${conversation.cost.currency} ${conversation.cost.amount}` : ""}</p>
            </section>
            <section className="gotham-usage-group" aria-label={`${provider.label} account allowance`}>
              <header><strong>Account allowance</strong><small>{allowance.availability === "available" ? allowance.source : allowance.availabilityReason}</small></header>
              {allowance.buckets?.length ? allowance.buckets.map((bucket) => <div className="gotham-usage-quota" key={bucket.id}><span><strong>{bucket.label}</strong><small>{bucket.resetAt ? `Resets ${usageTimestamp(bucket.resetAt)}` : "Reset time unavailable"}</small></span><b>{usageValue(bucket.percentUsed, "%")}</b></div>) : <p>Not exposed by provider. Allowance may include usage outside PlutoniX.</p>}
            </section>
            <section className="gotham-usage-group" aria-label={`${provider.label} context window`}>
              <header><strong>Context window</strong><small>Separate from subscription quota</small></header>
              <p>{context.availability === "available" ? `${usageValue(context.occupancyTokens)} of ${usageValue(context.capacityTokens)} tokens` : context.availabilityReason || "Not exposed by provider."}</p>
            </section>
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <details className="gotham-account-usage" open={expanded} onToggle={(event) => onExpandedChange(event.currentTarget.open)}>
      <summary>
        <span><Gauge size={15} /><strong>Account &amp; Usage</strong><small>{activeProvider ? `${activeProvider.label} · ${activeProvider.connection?.status || "unavailable"}` : loading ? "Loading" : "Sign in to view"}</small></span>
        <ChevronDown size={15} />
      </summary>
      <div className="gotham-account-usage-body" aria-live="polite">
        <div className="gotham-usage-toolbar">
          <span>PlutoniX profile ID: <b title={data?.profile?.id || "Not available"}>{data?.profile?.id || "Not available"}</b></span>
          <button type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh account and usage"><RefreshCcw size={13} />Refresh</button>
        </div>
        {loading && !data ? <p className="gotham-usage-notice"><Loader2 className="spin" size={14} /> Loading connected provider data…</p> : null}
        {error ? <p className="gotham-usage-notice error">{error}</p> : null}
        {data?.stale ? <p className="gotham-usage-notice stale">Last known values may be stale.</p> : null}
        {providers.length ? providers.map(providerCard) : !loading && !error ? <p className="gotham-usage-notice">No connected Gotham provider is available for this profile.</p> : null}
        {data ? <small className="gotham-usage-updated">Last updated {usageTimestamp(data.updatedAt)}{data.refresh?.status === "throttled" ? " · Refresh is temporarily rate-limited." : ""}</small> : null}
      </div>
    </details>
  );
}

export default function App() {
  const [deepLink] = useState(readWorkspaceDeepLink);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState(() => authorizedStudioWorkspace(deepLink.workspace, getStoredUser()));
  const [activeAgenticSystemTab, setActiveAgenticSystemTab] = useState("graph");
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem("plutonix-theme") || "system");
  const [instruction, setInstruction] = useState(starterPrompt);
  const [taskType, setTaskType] = useState("Medium");
  const [gothamWorkflowMode, setGothamWorkflowMode] = useState("executor");
  const [gothamIntelEnabled, setGothamIntelEnabled] = useState(() => localStorage.getItem("plutonix-gotham-intel") === "true");
  const [studioSelectedJobId, setStudioSelectedJobId] = useState(deepLink.studioJob);
  const [studioInitialTab, setStudioInitialTab] = useState(deepLink.studioJob ? "jobs" : "");
  const [pendingStudioContext, setPendingStudioContext] = useState(null);
  const [brandingPalette, setBrandingPalette] = useState(null);
  const [customPalette, setCustomPalette] = useState(["#111827", "#0F766E", "#2563EB", "#F8FAFC"]);
  const [showPalettePicker, setShowPalettePicker] = useState(false);
  const [backendStatus, setBackendStatus] = useState("offline");
  const [mcpStatus, setMcpStatus] = useState("offline");
  const [mcpId, setMcpId] = useState("");
  const [gothamAccountUsage, setGothamAccountUsage] = useState(null);
  const [gothamAccountUsageOpen, setGothamAccountUsageOpen] = useState(false);
  const [gothamAccountUsageLoading, setGothamAccountUsageLoading] = useState(false);
  const [gothamAccountUsageError, setGothamAccountUsageError] = useState("");
  const [useGothamMcp, setUseGothamMcp] = useState(() => localStorage.getItem("plutonix-use-gotham-mcp") === "true");
  const [generatedStatus, setGeneratedStatus] = useState("ready");
  const [, setEvents] = useState([]);
  const [runtimeLogs, setRuntimeLogs] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [chatPrompts, setChatPrompts] = useState([]);
  const [lastBuild, setLastBuild] = useState(null);
  const [projectInstructions, setProjectInstructions] = useState([]);
  const [runningInstruction, setRunningInstruction] = useState(null);
  const [instructionTimerNow, setInstructionTimerNow] = useState(Date.now());
  const [instructionsError, setInstructionsError] = useState("");
  const [techStackSnapshots, setTechStackSnapshots] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("plutonix-tech-stack-snapshots") || "[]");
      return Array.isArray(stored) ? stored.slice(-12) : [];
    } catch {
      return [];
    }
  });
  const [techStackIndex, setTechStackIndex] = useState(0);
  const [isGenerating, setGenerating] = useState(false);
  const [isStoppingGotham, setStoppingGotham] = useState(false);
  const [projectName, setProjectName] = useState("Bag commerce studio");
  const [projectResult, setProjectResult] = useState(null);
  const projectNotificationRef = useRef("");
  const [projectFlowPath, setProjectFlowPath] = useState(null);
  const [isFlowExpanded, setFlowExpanded] = useState(false);
  const [isCreatingProject, setCreatingProject] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [isSelectingProject, setSelectingProject] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [isUpdatingProjectIdentity, setUpdatingProjectIdentity] = useState(false);
  const [isUploadingMedia, setUploadingMedia] = useState(false);
  const [isStagingProjectMedia, setStagingProjectMedia] = useState(false);
  const [stagedProjectMedia, setStagedProjectMedia] = useState([]);
  const [requiredDataFields, setRequiredDataFields] = useState([]);
  const [requiredDataValues, setRequiredDataValues] = useState({});
  const [requiredDataContext, setRequiredDataContext] = useState(null);
  const [showRequiredDataModal, setShowRequiredDataModal] = useState(false);
  const [isCheckingRequiredData, setCheckingRequiredData] = useState(false);
  const [requiredDataMessage, setRequiredDataMessage] = useState("");
  const [requiredDataUploadingFieldId, setRequiredDataUploadingFieldId] = useState("");
  const [isRemovingMediaId, setRemovingMediaId] = useState("");
  const [projectArtifacts, setProjectArtifacts] = useState([]);
  const [selectedArtifactPath, setSelectedArtifactPath] = useState("");
  const [artifactPreviewData, setArtifactPreviewData] = useState(null);
  const [artifactPreviewLoading, setArtifactPreviewLoading] = useState(false);
  const [artifactPreviewError, setArtifactPreviewError] = useState("");
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [isImportingProject, setImportingProject] = useState(false);
  const [architectureBranchReport, setArchitectureBranchReport] = useState(null);
  const [isAnalyzingArchitecture, setAnalyzingArchitecture] = useState(false);
  const [architectureBranchError, setArchitectureBranchError] = useState("");
  const [isRebuildingProject, setRebuildingProject] = useState(false);
  const [projectInstanceAction, setProjectInstanceAction] = useState("");
  const [isDeletingProject, setDeletingProject] = useState(false);
  const [previewKey, setPreviewKey] = useState(Date.now());
  const [previewDeviceId, setPreviewDeviceId] = useState("desktop");
  const [isPickingReference, setPickingReference] = useState(false);
  const [selectedReferences, setSelectedReferences] = useState([]);
  const [gothamChatWidth, setGothamChatWidth] = useState(() => {
    const stored = Number(localStorage.getItem("plutonix-gotham-chat-width"));
    return Number.isFinite(stored) ? Math.max(GOTHAM_CHAT_MIN_WIDTH, Math.min(GOTHAM_CHAT_MAX_WIDTH, stored)) : GOTHAM_CHAT_MIN_WIDTH;
  });
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [activityFilter, setActivityFilter] = useState("all");
  const [activityTarget, setActivityTarget] = useState(deepLink.logs);
  const [resolvedTheme, setResolvedTheme] = useState(() => document.documentElement.dataset.theme || "light");
  const [isGoogleSsoReady, setGoogleSsoReady] = useState(false);
  const [googleSignInMessage, setGoogleSignInMessage] = useState("");
  const previewFrameRef = useRef(null);
  const instructionEditorRef = useRef(null);
  const instructionCursorRef = useRef(null);
  const instructionEditorValueRef = useRef("");
  const instructionDraftRef = useRef({ key: "", value: "" });
  const instructionHistoryCaretIntentRef = useRef("");
  const googleIdentityRef = useRef(null);
  const instructionHistoryIndexRef = useRef(-1);
  const gothamResizeRef = useRef(null);
  const taskModeMenuRef = useRef(null);
  const instructionSettingsMenuRef = useRef(null);
  const instructionProjectMenuRef = useRef(null);
  const gothamAccountUsageRequestRef = useRef(0);

  const isSystemTarget = selectedProjectId === SYSTEM_TARGET_VALUE;
  const selectedProject = selectedProjectId && !isSystemTarget ? projects.find((project) => project.id === selectedProjectId) : null;
  const selectedPreviewUrl = selectedProject?.previewUrl || "";
  const selectedBackendInterface = selectedProject?.backendInterface?.available ? selectedProject.backendInterface : null;
  const activeIntelProfile = projectResult?.flowPath?.intel?.profile || projectFlowPath?.intel?.profile || null;
  const previewStrategy = activeIntelProfile?.previewAdapter || selectedProject?.previewStrategy || selectedProject?.productDecision?.previewStrategy || "browser";
  const browserPreview = previewStrategy === "browser";
  const apiContractPreview = previewStrategy === "api-contract";
  const selectedArtifact = projectArtifacts.find((artifact) => artifact.path === selectedArtifactPath) || projectArtifacts[0] || null;
  const selectedArtifactUrl = selectedArtifact?.url
    ? `${BACKEND_URL}${selectedArtifact.url}&userId=${encodeURIComponent(currentUser?.id || "")}&userName=${encodeURIComponent(currentUser?.name || "")}`
    : "";
  const selectedRuntimeStatus = selectedProject?.runtime?.status || selectedProject?.status || "";
  const selectedRuntimeStopped = /stopped|not-found/i.test(selectedRuntimeStatus);
  const projectInstanceBusy = Boolean(projectInstanceAction);
  const previewDevice = devicePresets.find((device) => device.id === previewDeviceId) || devicePresets.at(-1);
  const recommendedPalette = useMemo(
    () => recommendBrandPalette(`${instruction}\n${selectedProject?.name || projectName}`),
    [instruction, projectName, selectedProject?.name]
  );
  const projectCreationPalette = selectedProject?.brandingPalette || null;
  const activePalette = brandingPalette?.name === "Custom"
    ? { name: "Custom", colors: customPalette, reason: "Custom palette selected manually." }
    : brandingPalette || projectCreationPalette || (!selectedProject && !isSystemTarget ? recommendedPalette : null);
  const palettePickerPreview = activePalette || recommendedPalette;
  const activeAppIcon = selectedProject?.appIcon || selectedProject?.media?.find((item) => item.purpose === "app-icon");
  const requiredDataMissingCount = requiredDataFields.filter((field) => !String(requiredDataValues[field.id] || "").trim()).length;
  const activeMediaItems = selectedProject?.media?.length ? selectedProject.media : !selectedProject ? stagedProjectMedia : [];
  const instructionTooLong = instruction.length > MAX_INSTRUCTION_CHARS;
  const canSubmit = (Boolean(selectedProject) || isSystemTarget) && instruction.trim().length > 12 && !instructionTooLong && !isGenerating && !isCheckingRequiredData && !requiredDataUploadingFieldId;
  const canCreateProject = projectName.trim().length > 1 && !instructionTooLong && !isCreatingProject && !selectedProject && !isSystemTarget && !isCheckingRequiredData && !isStagingProjectMedia && !requiredDataUploadingFieldId;
  const projectIdentityChanged = Boolean(
    selectedProject &&
      !selectedProject.isDefault &&
      (projectName.trim() !== selectedProject.name || workspaceName.trim() !== (selectedProject.folderName || ""))
  );
  const canUpdateProjectIdentity = projectIdentityChanged && projectName.trim().length > 1 && workspaceName.trim().length > 1 && !isUpdatingProjectIdentity;
  const workflowRunning =
    isGenerating || generatedStatus === "working" || isCreatingProject || isSelectingProject || isUpdatingProjectIdentity || isRebuildingProject || projectInstanceBusy || isCheckingRequiredData || isStagingProjectMedia || Boolean(requiredDataUploadingFieldId);
  const projectRuntimeLabel = isSystemTarget
    ? "System"
    : selectedProject
    ? selectedRuntimeStopped
      ? "Stopped"
      : generatedStatus === "ready"
        ? "Live"
        : "Building"
    : "Idle";
  const mcpWorkflowRunning = isGenerating || isCreatingProject;
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.GOOGLE_CLIENT_ID;
  const selectedProjectInstructions = isSystemTarget
    ? []
    : projectInstructions.filter((entry) => (!selectedProjectId || entry.projectId === selectedProjectId) && entry?.instruction);
  const latestProjectInstruction = selectedProjectInstructions.find((entry) => entry?.flowPath) || null;
  const initialProjectInstruction =
    selectedProjectInstructions
      .slice()
      .reverse()
      .find((entry) => entry.source === "plutonix-project-creation") ||
    selectedProjectInstructions.at(-1) ||
    null;
  const latestPersistedFlowPath = latestProjectInstruction?.flowPath || null;
  const activeProjectFlowSource = projectResult?.flowPath || projectFlowPath || latestPersistedFlowPath;
  const activePersistedFlowRecord = activeProjectFlowSource === latestPersistedFlowPath ? latestProjectInstruction : null;
  const previousProjectFlowPaths = selectedProjectInstructions
    .filter((entry) => entry?.flowPath && entry !== activePersistedFlowRecord)
    .slice()
    .reverse()
    .map((entry) => ({
      ...entry.flowPath,
      sourceInstruction: entry.flowPath.sourceInstruction || entry.instruction || "",
      changedFiles: entry.flowPath.changedFiles?.length ? entry.flowPath.changedFiles : entry.changedFiles || []
    }));
  const activeProjectFlowPath = activeProjectFlowSource
    ? {
        ...activeProjectFlowSource,
        sourceInstruction: activeProjectFlowSource.sourceInstruction || latestProjectInstruction?.instruction || "",
        changedFiles: activeProjectFlowSource.changedFiles?.length
          ? activeProjectFlowSource.changedFiles
          : latestProjectInstruction?.changedFiles || [],
        productDecision:
          activeProjectFlowSource.productDecision ||
          latestProjectInstruction?.productDecision ||
          selectedProject?.productDecision ||
          null,
        initialInstruction: initialProjectInstruction?.instruction || "",
        initialFlowPath: initialProjectInstruction?.flowPath || null,
        initialChangedFiles: initialProjectInstruction?.changedFiles || [],
        previousFlowPaths: previousProjectFlowPaths
      }
    : null;
	  const selectedProjectFlowPath = activeProjectFlowPath || (isSystemTarget ? {
    ...gothamSystemFlowPath({ taskType }),
    status: "idle",
    summary: "System target selected. Platform improvements will create proposals before code changes.",
    subObjectives: gothamSystemFlowPath({ taskType }).subObjectives.map((node) => ({ ...node, state: node.id === "observe" ? "selected" : "pending" }))
  } : selectedProject ? {
    projectName: selectedProject.name,
    status: "idle",
    summary: "No adaptive flow has been recorded for this project yet.",
    selectedPath: "none",
    nodes: defaultProjectFlowNodes.map((node) => ({ ...node, state: "pending", detail: "Waiting for this project's first instruction." })),
    subObjectives: defaultSubObjectiveFlow.map((node) => ({ ...node, state: "pending", detail: "No project-specific execution recorded." })),
    activeAgents: [],
    functionalities: [],
    featureActions: [],
    sourceInstruction: latestProjectInstruction?.instruction || "",
    changedFiles: latestProjectInstruction?.changedFiles || [],
    productDecision: latestProjectInstruction?.productDecision || selectedProject.productDecision || null,
    initialInstruction: initialProjectInstruction?.instruction || "",
    initialFlowPath: initialProjectInstruction?.flowPath || null,
    initialChangedFiles: initialProjectInstruction?.changedFiles || [],
    previousFlowPaths: previousProjectFlowPaths,
    executedDecisions: [],
	    rejectedPaths: []
	  } : null);
	  const workflowNextSuggestion = useMemo(
	    () =>
	      buildWorkflowNextInstructionSuggestion({
	        flowPath: selectedProjectFlowPath,
	        projectId: isSystemTarget ? "system:plutonix" : selectedProject?.id || selectedProjectId,
	        selectedReferences,
	        intelEnabled: gothamIntelEnabled && !isSystemTarget,
	        instructionHistory: selectedProjectInstructions,
	        branding: activePalette || { name: "PlutoniX", colors: ["#753FD9", "#171321", "#FFFFFF"] }
	      }),
	    [activePalette, gothamIntelEnabled, isSystemTarget, selectedProject?.id, selectedProjectFlowPath, selectedProjectId, selectedProjectInstructions, selectedReferences]
	  );
	  const showExpandedFlow = isFlowExpanded || isCreatingProject || isSystemTarget;
  const currentTechStackSnapshot = useMemo(
    () =>
      buildTechStackSnapshot({
        project: selectedProject,
        lastBuild,
        flowPath: activeProjectFlowPath,
        generatedStatus
      }),
    [activeProjectFlowPath, generatedStatus, lastBuild, selectedProject]
  );
  const visibleTechStackSnapshots = useMemo(() => {
    if (!selectedProject) return [currentTechStackSnapshot];
    const rows = techStackSnapshots.filter((snapshot) => snapshot.projectId === selectedProject.id);
    return rows.length ? rows : [currentTechStackSnapshot];
  }, [currentTechStackSnapshot, selectedProject, techStackSnapshots]);
  const instructionHistory = useMemo(() => {
    const rows = [
      ...projectInstructions.map((item) => item.instruction),
      ...chatPrompts.filter((item) => item.role === "user").map((item) => String(item.message || "").replace(/^Task Type:\s*[^\n]+\nTask:\s*/i, ""))
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return [...new Set(rows)];
  }, [chatPrompts, projectInstructions]);

  useEffect(() => {
    if (!selectedProject) return;
    setTechStackSnapshots((current) => {
      const previous = current.at(-1);
      if (previous?.key === currentTechStackSnapshot.key) return current;
      return [...current, currentTechStackSnapshot].slice(-24);
    });
  }, [currentTechStackSnapshot, selectedProject]);

  useEffect(() => {
    if (visibleTechStackSnapshots.length) setTechStackIndex(visibleTechStackSnapshots.length - 1);
  }, [selectedProject?.id, visibleTechStackSnapshots.length]);

  useEffect(() => {
    localStorage.setItem("plutonix-tech-stack-snapshots", JSON.stringify(techStackSnapshots.slice(-24)));
  }, [techStackSnapshots]);

  useEffect(() => {
    function syncUser(event) {
      setCurrentUser(event.detail || getStoredUser());
      setSelectedProjectId("");
      setProjects([]);
    }
    window.addEventListener("plutonix-user-updated", syncUser);
    return () => window.removeEventListener("plutonix-user-updated", syncUser);
  }, []);

  useEffect(() => {
    if (!currentUser?.id && activeWorkspaceTab !== "studio") setActiveWorkspaceTab("studio");
  }, [activeWorkspaceTab, currentUser?.id]);

  useEffect(() => {
    setGoogleSsoReady(false);
    setGoogleSignInMessage("");
    googleIdentityRef.current = null;
    if (currentUser) return undefined;
    if (!googleClientId) {
      setGoogleSignInMessage("Google client ID is missing. Set VITE_GOOGLE_CLIENT_ID or GOOGLE_CLIENT_ID and restart the frontend.");
      return undefined;
    }
    let attempts = 0;
    const initializeGoogleSso = () => {
      const identity = window.google?.accounts?.id;
      if (!identity) return false;
      identity.initialize({
        client_id: googleClientId,
        ux_mode: "popup",
        cancel_on_tap_outside: true,
        callback: async (credentialResponse) => {
          try {
            if (!credentialResponse?.credential) throw new Error("Google did not return a sign-in credential.");
            const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: credentialResponse.credential })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Google sign in failed");
            setGoogleSignInMessage("");
            storeUser(data.user, { token: credentialResponse.credential });
          } catch (error) {
            setGoogleSignInMessage(error.message || "Google sign in failed");
            setRuntimeLogs((current) =>
              mergeRuntimeRows([{ id: `auth-${Date.now()}`, type: "error", message: error.message, createdAt: new Date().toISOString(), time: formatIstTime() }], current)
            );
          }
        }
      });
      googleIdentityRef.current = identity;
      setGoogleSsoReady(true);
      setGoogleSignInMessage("");
      return true;
    };
    if (initializeGoogleSso()) return undefined;
    const retry = window.setInterval(() => {
      attempts += 1;
      if (initializeGoogleSso()) {
        window.clearInterval(retry);
        return;
      }
      if (attempts > 24) {
        window.clearInterval(retry);
        setGoogleSignInMessage("Google sign-in script did not initialize. Check network access to accounts.google.com and restart the frontend if the client ID changed.");
      }
    }, 250);
    return () => window.clearInterval(retry);
  }, [currentUser, googleClientId]);

  function startGoogleSignIn() {
    const identity = googleIdentityRef.current;
    if (!identity) {
      setGoogleSignInMessage(
        googleSignInMessage ||
          `Google sign-in is not ready from ${window.location.origin}. Add this exact JavaScript origin in Google Cloud Console and restart the frontend.`
      );
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `auth-${Date.now()}`,
              type: "error",
              message:
                googleSignInMessage ||
                `Google sign-in is not ready from ${window.location.origin}. Add this exact JavaScript origin in Google Cloud Console and restart the frontend.`,
              createdAt: new Date().toISOString(),
              time: formatIstTime()
            }
          ],
          current
        )
      );
      return;
    }
    identity.prompt((notification) => {
      if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
        setGoogleSignInMessage(
          `Google sign-in could not open from ${window.location.origin}. Add this exact JavaScript origin to the OAuth client in Google Cloud Console.`
        );
        setRuntimeLogs((current) =>
          mergeRuntimeRows(
            [
              {
                id: `auth-${Date.now()}`,
                type: "error",
                message: `Google sign-in could not open from ${window.location.origin}. Add this exact JavaScript origin to the OAuth client in Google Cloud Console.`,
                createdAt: new Date().toISOString(),
                time: formatIstTime()
              }
            ],
            current
          )
        );
      }
    });
  }

  async function useLocalProfile() {
    const name = window.prompt("Name for this local PlutoniX profile", "Local PlutoniX User");
    if (!name) return;
    const user = {
      id: `local:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "user"}`,
      name,
      email: "",
      authProvider: "local-dev"
    };
    storeDevelopmentUser(user, { subject: import.meta.env.VITE_PLUTONIX_DEV_AUTH_SUBJECT || "local:local-plutonix-user" });
  }

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme = themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themeMode = themeMode;
      setResolvedTheme(resolvedTheme);
      localStorage.setItem("plutonix-theme", themeMode);
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  useEffect(() => {
    if (!activityTarget || activeWorkspaceTab !== "builder") return undefined;
    const timer = window.setTimeout(() => {
      document.getElementById("activity-log")?.scrollIntoView({ block: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeWorkspaceTab, activityTarget]);

  useEffect(() => {
    const closeInstructionMenus = (event) => {
      [taskModeMenuRef.current, instructionSettingsMenuRef.current, instructionProjectMenuRef.current].forEach((menu) => {
        if (menu?.open && !menu.contains(event.target)) menu.removeAttribute("open");
      });
    };
    document.addEventListener("pointerdown", closeInstructionMenus);
    return () => document.removeEventListener("pointerdown", closeInstructionMenus);
  }, []);

  const metrics = useMemo(
    () => [
      { label: "Runtime", value: projectRuntimeLabel },
      { label: "Backend", value: backendStatus === "online" ? "Online" : "Offline" },
      { label: "Gotham MCP", value: mcpStatus === "online" ? "External" : "Offline", detail: mcpId ? `ID ${mcpId}` : null },
      { label: "Orchestrator", value: lastBuild?.orchestrated?.pageType ? "Structured" : "Ready" },
      { label: "Last build", value: lastBuild?.buildId ? lastBuild.buildId.slice(-6) : "None" }
    ],
    [backendStatus, lastBuild, mcpId, mcpStatus, projectRuntimeLabel]
  );
  const activityEvents = useMemo(() => {
    const rows = collapseCodexProgressRows(
      markCurrentSession(normalizeRuntimeRows([...runtimeLogs, ...chatPrompts]).slice(0, MAX_RUNTIME_LOG_ROWS), sessionStartedAt)
    );
    const categoryRows = activityFilter === "all" ? rows : rows.filter((event) => activityCategory(event) === activityFilter);
    return activityTarget ? categoryRows.filter((event) => activityMatchesTarget(event, activityTarget)) : categoryRows;
  }, [activityFilter, activityTarget, chatPrompts, runtimeLogs, sessionStartedAt]);
  const playgroundNotifications = useMemo(() => {
    const cutoff = Date.now() - NOTIFICATION_RETENTION_MS;
    const selectedId = selectedProject?.id || "";
    const selectedName = selectedProject?.name || "";
    return normalizeRuntimeRows(runtimeLogs)
      .filter((event) => new Date(event.createdAt || 0).getTime() >= cutoff)
      .filter((event) => {
        if (!selectedId && !selectedName) return !event.projectId && !event.projectName;
        return !event.projectId || event.projectId === selectedId || event.projectName === selectedName;
      })
      .slice(0, 60);
  }, [runtimeLogs, selectedProject]);
  const notificationAttentionCount = useMemo(
    () => playgroundNotifications.filter((event) => /failed|error|upgrade-required|fallback-failed/i.test(event.type || "")).length,
    [playgroundNotifications]
  );
  const chatMessages = useMemo(
    () => collapseAgentActivityThreads(markCurrentSession(normalizeRuntimeRows([...runtimeLogs, ...chatPrompts]).slice(0, 80), sessionStartedAt), selectedProject),
    [chatPrompts, runtimeLogs, selectedProject, sessionStartedAt]
  );
  const activeChatAgent = useMemo(() => {
    const activeEvent =
      chatMessages.find((event) => event.currentSession && event.role !== "user" && event.type !== "connected") ||
      chatMessages.find((event) => event.role !== "user" && event.type !== "connected");
    return activeEvent ? agentVisualFromEvent(activeEvent, selectedProject) : agentVisualFromId("plutonix-fullstack-agent", { name: "PlutoniX Fullstack Agent" });
  }, [chatMessages, selectedProject]);

  useEffect(() => {
    let cancelled = false;
    async function checkHealth() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/status`);
        const data = await res.json();
        if (!cancelled) {
          setBackendStatus(data.status === "ok" ? "online" : "offline");
          setMcpStatus(data.localGothamMcp === "ready" || data.codexMcp === "external" ? "online" : "offline");
          setMcpId(useGothamMcp ? data.localGothamMcpId || "" : data.codexMcpId || "");
        }
      } catch {
        if (!cancelled) {
          setBackendStatus("offline");
          setMcpStatus("offline");
          setMcpId("");
        }
      }
    }
    checkHealth();
    const id = setInterval(checkHealth, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [useGothamMcp]);

  useEffect(() => {
    localStorage.setItem("plutonix-use-gotham-mcp", String(useGothamMcp));
  }, [useGothamMcp]);

  useEffect(() => {
    localStorage.setItem("plutonix-gotham-intel", String(gothamIntelEnabled));
  }, [gothamIntelEnabled]);

  useEffect(() => {
    localStorage.setItem("plutonix-gotham-chat-width", String(Math.round(gothamChatWidth)));
  }, [gothamChatWidth]);

  async function loadGothamAccountUsage({ refresh = false } = {}) {
    if (!currentUser?.id) {
      setGothamAccountUsage(null);
      setGothamAccountUsageError("Sign in to view Account & Usage.");
      return;
    }
    const requestId = ++gothamAccountUsageRequestRef.current;
    setGothamAccountUsageLoading(true);
    setGothamAccountUsageError("");
    try {
      const params = new URLSearchParams();
      if (selectedProject?.id) params.set("projectId", selectedProject.id);
      if (refresh) params.set("refresh", "true");
      const res = await authFetch(`${BACKEND_URL}/api/gotham/account-usage?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Account & Usage could not be loaded.");
      if (requestId !== gothamAccountUsageRequestRef.current) return;
      setGothamAccountUsage(data);
    } catch (error) {
      if (requestId !== gothamAccountUsageRequestRef.current) return;
      setGothamAccountUsageError(error.message || "Account & Usage could not be loaded.");
      setGothamAccountUsage(null);
    } finally {
      if (requestId === gothamAccountUsageRequestRef.current) setGothamAccountUsageLoading(false);
    }
  }

  useEffect(() => {
    gothamAccountUsageRequestRef.current += 1;
    setGothamAccountUsage(null);
    setGothamAccountUsageError("");
  }, [currentUser?.id]);

  useEffect(() => {
    if (!gothamAccountUsageOpen) return undefined;
    loadGothamAccountUsage();
    const intervalId = window.setInterval(() => loadGothamAccountUsage(), 90_000);
    return () => window.clearInterval(intervalId);
  }, [gothamAccountUsageOpen, currentUser?.id, selectedProject?.id]);

  useEffect(() => {
    setBrandingPalette(null);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!projectResult) return;
    const detail = projectResult.error || projectResult.message || (projectResult.status === "succeeded"
      ? `Preview ready${projectResult.container ? ` in ${projectResult.container}` : ""}`
      : projectResult.status === "staged" ? "Reference staged" : "Building project...");
    const key = [projectResult.projectId, projectResult.projectName, projectResult.status, detail].join("|");
    if (projectNotificationRef.current === key) return;
    projectNotificationRef.current = key;
    setRuntimeLogs((current) => mergeRuntimeRows([{
      id: `playground-status-${Date.now()}`,
      type: projectResult.status === "failed" ? "project-status-failed" : "project-status",
      projectId: projectResult.projectId || selectedProject?.id || "",
      projectName: projectResult.projectName || selectedProject?.name || "PlutoniX",
      message: detail,
      createdAt: new Date().toISOString(),
      time: formatIstTime()
    }], current));
  }, [projectResult, selectedProject]);

  function startGothamPanelResize(event) {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = gothamChatWidth;
    const maxWidth = Math.max(GOTHAM_CHAT_MIN_WIDTH, Math.min(GOTHAM_CHAT_MAX_WIDTH, Math.round(window.innerWidth * 0.58)));
    gothamResizeRef.current = { pointerId: event.pointerId, startX, startWidth, maxWidth };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add("gotham-panel-resizing");
  }

  function resizeGothamPanel(event) {
    const resizeState = gothamResizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const nextWidth = resizeState.startWidth + (resizeState.startX - event.clientX);
    setGothamChatWidth(Math.max(GOTHAM_CHAT_MIN_WIDTH, Math.min(resizeState.maxWidth, nextWidth)));
  }

  function stopGothamPanelResize(event) {
    const resizeState = gothamResizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    gothamResizeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    document.body.classList.remove("gotham-panel-resizing");
  }

  async function loadProjects() {
    const res = await authFetch(`${BACKEND_URL}/api/projects`);
    const data = await res.json();
    if (Array.isArray(data.projects)) {
      setProjects(data.projects);
      if (selectedProjectId && selectedProjectId !== SYSTEM_TARGET_VALUE && !data.projects.some((project) => project.id === selectedProjectId)) {
        setSelectedProjectId("");
      }
    }
  }

  async function loadProjectInstructions(projectId = selectedProjectId) {
    if (projectId === SYSTEM_TARGET_VALUE) {
      setInstructionsError("");
      setProjectInstructions([]);
      return;
    }
    setInstructionsError("");
    try {
      const url = projectId
        ? `${BACKEND_URL}/api/project-instructions?projectId=${encodeURIComponent(projectId)}`
        : `${BACKEND_URL}/api/project-instructions`;
      const res = await authFetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Project instructions could not be loaded.");
      setProjectInstructions(Array.isArray(data.instructions) ? data.instructions : []);
    } catch (error) {
      setInstructionsError(error.message);
      setProjectInstructions([]);
    }
  }

  async function loadProjectArtifacts(projectId = selectedProjectId) {
    if (!projectId || projectId === SYSTEM_TARGET_VALUE) {
      setProjectArtifacts([]);
      return;
    }
    setArtifactsLoading(true);
    try {
      const res = await authFetch(`${BACKEND_URL}/api/projects/${encodeURIComponent(projectId)}/artifacts`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Project artifacts could not be loaded.");
      const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
      setProjectArtifacts(artifacts);
      setSelectedArtifactPath((current) => artifacts.some((artifact) => artifact.path === current) ? current : artifacts[0]?.path || "");
    } catch {
      setProjectArtifacts([]);
      setSelectedArtifactPath("");
    } finally {
      setArtifactsLoading(false);
    }
  }

  useEffect(() => {
    loadProjects().catch(() => setProjects([]));
  }, [currentUser?.id]);

  useEffect(() => {
    loadProjectInstructions(selectedProjectId).catch(() => {});
  }, [selectedProjectId, currentUser?.id]);

  useEffect(() => {
    loadProjectArtifacts(selectedProjectId).catch(() => {});
  }, [selectedProjectId, currentUser?.id, previewKey]);

  useEffect(() => {
    const structuredKinds = new Set(["spreadsheet", "presentation", "document", "code"]);
    if (!selectedProjectId || !selectedArtifact || !structuredKinds.has(selectedArtifact.kind)) {
      setArtifactPreviewData(null);
      setArtifactPreviewError("");
      setArtifactPreviewLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setArtifactPreviewLoading(true);
    setArtifactPreviewError("");
    authFetch(
      `${BACKEND_URL}/api/projects/${encodeURIComponent(selectedProjectId)}/artifacts/preview?path=${encodeURIComponent(selectedArtifact.path)}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Structured artifact preview could not be loaded.");
        setArtifactPreviewData(data.preview || null);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setArtifactPreviewData(null);
          setArtifactPreviewError(error.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setArtifactPreviewLoading(false);
      });
    return () => controller.abort();
  }, [selectedProjectId, selectedArtifact?.path, selectedArtifact?.kind, currentUser?.id]);

  useEffect(() => {
    if (!runningInstruction) return undefined;
    setInstructionTimerNow(Date.now());
    const timer = window.setInterval(() => setInstructionTimerNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runningInstruction]);

  const exportUrl = selectedProject
    ? `${BACKEND_URL}/api/projects/${selectedProject.id}/export?userId=${encodeURIComponent(currentUser?.id || "")}&userName=${encodeURIComponent(currentUser?.name || "")}`
    : undefined;

  useEffect(() => {
    if (isSystemTarget) {
      setProjectName("PlutoniX System");
      setWorkspaceName("plutonix");
    } else if (selectedProject) {
      setProjectName(selectedProject.name);
      setWorkspaceName(selectedProject.isDefault ? "" : selectedProject.folderName || "");
    } else if (!selectedProject) {
      setWorkspaceName("");
    }
    setProjectFlowPath(null);
    setProjectResult(null);
    setPickingReference(false);
    setSelectedReferences([]);
  }, [isSystemTarget, selectedProject?.id, selectedProject?.folderName]);

  useEffect(() => {
    if (!selectedProject) {
      setArchitectureBranchReport(null);
      setArchitectureBranchError("");
      return undefined;
    }
    let active = true;
    setArchitectureBranchReport(null);
    setArchitectureBranchError("");
    authFetch(`${BACKEND_URL}/api/decision-continuity/projects/${encodeURIComponent(selectedProject.id)}/architecture-branches`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Architecture branch analysis could not be loaded.");
        if (active) setArchitectureBranchReport(data.report || null);
      })
      .catch((error) => {
        // A project can still be used normally when the user has no Decision
        // Continuity read membership; surface the detail only in project tools.
        if (active) setArchitectureBranchError(error.message);
      });
    return () => { active = false; };
  }, [selectedProject?.id, currentUser?.id]);

  function sendReferenceMode(enabled) {
    setPickingReference(enabled);
    previewFrameRef.current?.contentWindow?.postMessage({ type: "plutonix-reference-mode", enabled }, "*");
  }

  function highlightUiReference(reference, active) {
    previewFrameRef.current?.contentWindow?.postMessage({
      type: "plutonix-reference-highlight",
      reference,
      active: Boolean(active)
    }, "*");
  }

  function rememberInstructionCaret() {
    const editor = instructionEditorRef.current;
    const selection = window.getSelection?.();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) instructionCursorRef.current = range.cloneRange();
  }

  function instructionDraftStorageKey() {
    return `plutonix-instruction-draft:${selectedProject?.id || (isSystemTarget ? "system" : "new")}`;
  }

  function persistInstructionDraft(value) {
    const draft = String(value || "");
    const key = instructionDraftStorageKey();
    instructionDraftRef.current = { key, value: draft };
    try {
      window.localStorage.setItem(key, draft);
    } catch {
      // Browsers with disabled storage can still preserve the draft for this session.
    }
  }

  function savedInstructionDraft() {
    const key = instructionDraftStorageKey();
    if (instructionDraftRef.current.key === key) return instructionDraftRef.current.value;
    try {
      return window.localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function instructionCursorAtEdge(edge) {
    const editor = instructionEditorRef.current;
    const selection = window.getSelection?.();
    if (!editor || !selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed || !editor.contains(range.commonAncestorContainer)) return false;
    const boundary = document.createRange();
    boundary.selectNodeContents(editor);
    boundary.collapse(edge === "top");
    const comparison = edge === "top" ? Range.START_TO_START : Range.END_TO_END;
    return range.compareBoundaryPoints(comparison, boundary) === 0;
  }

  function syncInstructionFromEditor({ preserveHistoryPosition = false } = {}) {
    const value = instructionEditorValue(instructionEditorRef.current);
    instructionEditorValueRef.current = value;
    if (!preserveHistoryPosition) {
      instructionHistoryIndexRef.current = -1;
      persistInstructionDraft(value);
    }
    setInstruction(value);
    if (requiredDataFields.length) {
      setRequiredDataFields([]);
      setRequiredDataContext(null);
      setRequiredDataMessage("");
    }
  }

  function insertUiReferenceTag(reference) {
    const editor = instructionEditorRef.current;
    if (!editor) return;
    const range = instructionCursorRef.current?.cloneRange?.();
    const selection = window.getSelection?.();
    const insertionRange = range && editor.contains(range.commonAncestorContainer) ? range : document.createRange();
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      insertionRange.selectNodeContents(editor);
      insertionRange.collapse(false);
    }
    const chip = document.createElement("span");
    chip.className = "inline-ui-reference";
    chip.contentEditable = "false";
    chip.dataset.uiReferenceKey = uiReferenceKey(reference);
    chip.title = uiReferenceLabel(reference);
    chip.setAttribute("aria-label", `Playground reference ${uiReferenceLabel(reference)}`);
    chip.textContent = uiReferenceAcronym(reference);
    const spacer = document.createTextNode(" ");
    insertionRange.deleteContents();
    insertionRange.insertNode(spacer);
    insertionRange.insertNode(chip);
    insertionRange.setStartAfter(spacer);
    insertionRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(insertionRange);
    instructionCursorRef.current = insertionRange.cloneRange();
    editor.focus();
    syncInstructionFromEditor();
  }

  function appendUiReference(reference) {
    setSelectedReferences((current) => {
      const nextKey = uiReferenceKey(reference);
      if (!nextKey || current.some((item) => uiReferenceKey(item) === nextKey)) return current;
      return [...current, reference].slice(0, 8);
    });
    insertUiReferenceTag(reference);
  }

  function handleInstructionKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSubmit && !event.repeat) generatePage();
      return;
    }
    if (!instructionHistory.length || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const movingUp = event.key === "ArrowUp";
    if (!instructionCursorAtEdge(movingUp ? "top" : "bottom")) return;
    if (!movingUp && instructionHistoryIndexRef.current < 0) return;
    event.preventDefault();
    if (movingUp) {
      if (instructionHistoryIndexRef.current < 0) persistInstructionDraft(instructionEditorValue(instructionEditorRef.current));
      const nextIndex = Math.min(instructionHistoryIndexRef.current + 1, instructionHistory.length - 1);
      instructionHistoryIndexRef.current = nextIndex;
      instructionHistoryCaretIntentRef.current = "end";
      setInstruction(instructionHistory[nextIndex]);
      return;
    }
    if (instructionHistoryIndexRef.current === 0) {
      instructionHistoryIndexRef.current = -1;
      instructionHistoryCaretIntentRef.current = "end";
      setInstruction(savedInstructionDraft());
      return;
    }
    instructionHistoryIndexRef.current -= 1;
    instructionHistoryCaretIntentRef.current = "end";
    setInstruction(instructionHistory[instructionHistoryIndexRef.current]);
  }

  function handleInstructionEditorInput() {
    rememberInstructionCaret();
    syncInstructionFromEditor();
  }

  function handleInlineReferenceHover(event, active) {
    const chip = event.target.closest?.(".inline-ui-reference");
    if (!chip) return;
    const nextTarget = event.relatedTarget;
    if (!active && nextTarget && chip.contains(nextTarget)) return;
    const reference = selectedReferences.find((item) => uiReferenceKey(item) === chip.dataset.uiReferenceKey);
    if (reference) highlightUiReference(reference, active);
  }

  useEffect(() => {
    const editor = instructionEditorRef.current;
    if (!editor || instructionEditorValueRef.current === instruction) return;
    editor.replaceChildren(document.createTextNode(instruction));
    instructionEditorValueRef.current = instruction;
    instructionCursorRef.current = null;
    if (instructionHistoryCaretIntentRef.current) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(instructionHistoryCaretIntentRef.current === "start");
      const selection = window.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(range);
      instructionCursorRef.current = range.cloneRange();
      instructionHistoryCaretIntentRef.current = "";
    }
  }, [instruction]);

  useEffect(() => {
    const editor = instructionEditorRef.current;
    if (!editor) return;
    const allowed = new Set(selectedReferences.map(uiReferenceKey));
    editor.querySelectorAll(".inline-ui-reference").forEach((chip) => {
      if (allowed.has(chip.dataset.uiReferenceKey)) return;
      const spacer = chip.nextSibling;
      chip.remove();
      if (spacer?.nodeType === Node.TEXT_NODE && /^\s*$/.test(spacer.textContent || "")) spacer.remove();
    });
    syncInstructionFromEditor();
  }, [selectedReferences]);

  function clearRequiredDataState() {
    setRequiredDataFields([]);
    setRequiredDataValues({});
    setRequiredDataContext(null);
    setRequiredDataMessage("");
    setShowRequiredDataModal(false);
  }

  function requiredDataPayload() {
    return requiredDataFields
      .map((field) => ({
        id: field.id,
        label: field.label,
        value: String(requiredDataValues[field.id] || "").trim()
      }))
      .filter((item) => item.value);
  }

  function applyInputConsumption(result, { planner = false } = {}) {
    if (planner) return false;
    const submitted = requiredDataPayload();
    if (!submitted.length) {
      clearRequiredDataState();
      return true;
    }
    const status = result?.inputConsumption?.status;
    if (status === "verified" || status === "not_applicable") {
      clearRequiredDataState();
      return true;
    }
    const unresolvedLabels = requiredDataFields
      .filter((field) => result?.inputConsumption?.unresolvedInputIds?.includes(field.id))
      .map((field) => field.label);
    setRequiredDataMessage(
      unresolvedLabels.length
        ? `Gotham needs a narrower clarification for: ${unresolvedLabels.join(", ")}.`
        : "Supplied data is retained until Gotham confirms where it was used."
    );
    setShowRequiredDataModal(false);
    return false;
  }

  function formatRequiredDataInstruction(fields = requiredDataFields, values = requiredDataValues) {
    const rows = fields
      .map((field) => {
        const value = String(values[field.id] || "").trim();
        if (!value) return "";
        return `- ${field.label} [source-id: ${field.id}]:\n${value.split(/\r?\n/).map((line) => `  ${line}`).join("\n")}`;
      })
      .filter(Boolean);
    if (!rows.length) return "";
    return [
      "User-supplied required data for this Gotham iteration:",
      ...rows,
      "Use the data above as source material. If backend or integration data remains unavailable, show explicit empty states/placeholders/TODO hooks; do not invent records."
    ].join("\n");
  }

  function requiredDataFallbackText(field) {
    const uiElements = Array.isArray(field?.uiElements) && field.uiElements.length
      ? field.uiElements.join(", ")
      : Array.isArray(field?.usedFor) && field.usedFor.length
        ? field.usedFor.join(", ")
        : "the visible UI surfaces, forms, lists, filters, states, and generated content that depend on this input";
    const backendElements = Array.isArray(field?.backendElements) && field.backendElements.length
      ? field.backendElements.join(", ")
      : /integration|backend|api|database|source_data/i.test(`${field?.id || ""} ${field?.inputKind || ""} ${field?.label || ""}`)
        ? "backend adapter, API/client contract, database or external-service configuration hooks, loading/error states, and credential placeholders"
        : "data model, client-side state, validation rules, source metadata, and explicit empty/loading/error states";
    return [
      `Gotham should research/explore the best available approach for ${field.label}.`,
      `UI elements affected: ${uiElements}.`,
      `Backend/data elements affected: ${backendElements}.`,
      "If reliable source data, credentials, or integration access cannot be found from supplied project context, implement truthful empty states, TODO configuration hooks, fallback sample schemas without fake production records, and document what remains user-provided."
    ].join("\n");
  }

  function allowGothamResearchForRequiredData() {
    setRequiredDataValues((current) => {
      const next = { ...current };
      requiredDataFields.forEach((field) => {
        if (!String(next[field.id] || "").trim()) {
          next[field.id] = requiredDataFallbackText(field);
        }
      });
      return next;
    });
    setRequiredDataMessage("Gotham will research/explore the safest implementation path for missing inputs and use honest fallbacks instead of invented data.");
    setShowRequiredDataModal(false);
  }

  function requiredDataFileAccept(field) {
    if (field?.accept !== undefined) return field.accept;
    const value = `${field?.id || ""} ${field?.label || ""} ${field?.placeholder || ""} ${field?.reason || ""}`.toLowerCase();
    if (field?.id === "integration_source") return "";
    if (!/(media|image|photo|video|audio|voice|pdf|document|flyer|brochure|deck|presentation|logo|asset|reference|source data|content|dataset|csv|json|spreadsheet|file)/.test(value)) return "";
    const accept = [];
    if (/(image|photo|logo|poster|banner|flyer|thumbnail|creative|asset|reference)/.test(value)) accept.push("image/*");
    if (/(video|reel|motion|demo)/.test(value)) accept.push("video/*");
    if (/(audio|voice|podcast|sound)/.test(value)) accept.push("audio/*");
    if (/(pdf|document|report|brochure|deck|presentation)/.test(value)) accept.push("application/pdf");
    if (/(data|dataset|csv|json|spreadsheet|content|source)/.test(value)) accept.push(".csv", ".json", ".txt", ".md", ".xlsx", ".xls");
    return [...new Set(accept.length ? accept : ["image/*", "video/*", "audio/*", "application/pdf", ".csv", ".json", ".txt", ".md"])].join(",");
  }

  function appendRequiredDataMediaValue(fieldId, media = []) {
    if (!media.length) return;
    const rows = media.map((item) => {
      const name = item.originalName || item.name || "uploaded-media";
      const location = item.urlPath || item.path || item.relativePath || "";
      const mimeType = item.mimeType || "media";
      return `- ${name} (${mimeType})${location ? ` at ${location}` : ""}`;
    });
    const block = ["Uploaded media references:", ...rows].join("\n");
    setRequiredDataValues((current) => {
      const existing = String(current[fieldId] || "").trim();
      return {
        ...current,
        [fieldId]: existing ? `${existing}\n\n${block}` : block
      };
    });
  }

  async function uploadRequiredDataMedia(event, field) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !field?.id) return;
    setRequiredDataUploadingFieldId(field.id);
    try {
      const body = new FormData();
      for (const file of files) body.append("media", file);
      let uploaded = [];
      if (selectedProject && !selectedProject.isDefault) {
        const res = await authFetch(`${BACKEND_URL}/api/projects/${selectedProject.id}/media`, {
          method: "POST",
          body
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Required media upload failed");
        uploaded = Array.isArray(data.media) ? data.media : [];
        if (data.project) {
          setProjects((current) => current.map((project) => (project.id === data.project.id ? data.project : project)));
        } else {
          await loadProjects();
        }
      } else if (!selectedProject && !isSystemTarget) {
        const res = await authFetch(`${BACKEND_URL}/api/project-media/stage`, {
          method: "POST",
          body
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Required media staging failed");
        uploaded = Array.isArray(data.media) ? data.media : [];
        setStagedProjectMedia((current) => [...current, ...uploaded]);
      } else {
        throw new Error("Media upload needs a managed project or a new project draft.");
      }
      appendRequiredDataMediaValue(field.id, uploaded);
    } catch (error) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [{ id: `required-media-error-${Date.now()}`, type: "error", message: error.message, createdAt: new Date().toISOString(), time: formatIstTime() }],
          current
        )
      );
    } finally {
      setRequiredDataUploadingFieldId("");
    }
  }

  async function ensureRequiredDataForInstruction(baseInstruction, mode) {
    setCheckingRequiredData(true);
    try {
      const res = await authFetch(`${BACKEND_URL}/api/generate/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: baseInstruction,
          projectName: isSystemTarget ? "PlutoniX System" : selectedProject?.name || projectName.trim(),
          mediaIds: mediaReferenceIds(selectedProject?.media),
          stagedMediaIds: mediaReferenceIds(stagedProjectMedia),
          referenceCount: selectedReferences.length,
          suppliedData: suppliedDataRecord(requiredDataValues)
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Required data check failed");
      const fields = Array.isArray(data.requiredFields) ? data.requiredFields : [];
      const missing = fields.filter((field) => !String(requiredDataValues[field.id] || "").trim());
      if (!fields.length) {
        setRequiredDataFields([]);
        setRequiredDataContext(null);
        setRequiredDataMessage("");
        return "";
      }
      setRequiredDataFields(fields);
      setRequiredDataContext({
        mode,
        instruction: baseInstruction,
        requestedArtifacts: Array.isArray(data.requestedArtifacts) ? data.requestedArtifacts : [],
        productDecision: data.productDecision || null
      });
      setRequiredDataMessage(data.message || "");
      if (missing.length) {
        setShowRequiredDataModal(true);
        return null;
      }
      return formatRequiredDataInstruction(fields, requiredDataValues);
    } catch (error) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [{ id: `required-data-error-${Date.now()}`, type: "error", message: error.message, createdAt: new Date().toISOString(), time: formatIstTime() }],
          current
        )
      );
      return null;
    } finally {
      setCheckingRequiredData(false);
    }
  }

  async function stopGothamExecution() {
    if (!isGenerating || isStoppingGotham) return;
    setStoppingGotham(true);
    try {
      const res = await authFetch(`${BACKEND_URL}/api/generate/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: isSystemTarget ? "" : selectedProjectId,
          target: isSystemTarget ? { type: "system", systemId: "plutonix" } : { type: "project", projectId: selectedProjectId }
        })
      });
      const data = await res.json().catch(() => ({}));
      const stopEvent = {
        id: `gotham-stop-${Date.now()}`,
        type: data.status === "idle" ? "warning" : "gotham-stop-requested",
        message: data.message || "Stop requested for ongoing Gotham instruction execution.",
        createdAt: new Date().toISOString(),
        time: formatIstTime()
      };
      setRuntimeLogs((current) => mergeRuntimeRows([stopEvent], current));
      if (!res.ok) throw new Error(data.error || "Stop request failed");
    } catch (error) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows([{ id: `gotham-stop-error-${Date.now()}`, type: "error", message: error.message, createdAt: new Date().toISOString(), time: formatIstTime() }], current)
      );
    } finally {
      setStoppingGotham(false);
    }
  }

  useEffect(() => {
    function receiveReference(event) {
      if (event.data?.type === "plutonix-ui-reference-selected") {
        const reference = event.data.reference;
        appendUiReference(reference);
      }
      if (event.data?.type === "plutonix-ui-reference-cancelled") {
        setPickingReference(false);
      }
    }
    window.addEventListener("message", receiveReference);
    return () => window.removeEventListener("message", receiveReference);
  }, []);

  async function selectProject(projectId) {
    if (!projectId) {
      setSelectedProjectId("");
      setProjectFlowPath(null);
      setProjectResult(null);
      sendReferenceMode(false);
      setSelectedReferences([]);
      setPreviewKey(Date.now());
      return;
    }
    if (projectId === SYSTEM_TARGET_VALUE) {
      setSelectedProjectId(SYSTEM_TARGET_VALUE);
      setProjectName("PlutoniX System");
      setProjectResult(null);
      setProjectFlowPath(gothamSystemFlowPath({ taskType }));
      sendReferenceMode(false);
      setSelectedReferences([]);
      setPreviewKey(Date.now());
      setGeneratedStatus("ready");
      return;
    }
    setSelectingProject(true);
    setGeneratedStatus("working");
    try {
      const res = await authFetch(`${BACKEND_URL}/api/projects/${projectId}/select`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Project preview failed to start");
      await loadProjects();
      if (data.project) {
        setProjects((current) => current.map((project) => (project.id === data.project.id ? { ...project, ...data.project } : project)));
      }
      setSelectedProjectId(data.project?.id || projectId);
      setProjectResult(null);
      setProjectFlowPath(null);
      sendReferenceMode(false);
      setSelectedReferences([]);
      setPreviewKey(Date.now());
    } catch (error) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `project-select-error-${Date.now()}`,
              type: "error",
              message: error.message,
              createdAt: new Date().toISOString(),
              time: formatIstTime()
            }
          ],
          current
        )
      );
    } finally {
      setSelectingProject(false);
      setGeneratedStatus("ready");
    }
  }

  function applyReadyProject(project) {
    if (!project?.id) return;
    setProjects((current) => [...current.filter((item) => item.id !== project.id), project]);
    setSelectedProjectId(project.id);
    sendReferenceMode(false);
    setSelectedReferences([]);
    setPreviewKey(Date.now());
  }

  async function updateSelectedProjectIdentity() {
    if (!selectedProject || selectedProject.isDefault || !canUpdateProjectIdentity) return;
    const nextName = projectName.trim();
    const nextWorkspaceName = workspaceName.trim();
    setUpdatingProjectIdentity(true);
    try {
      const res = await authFetch(`${BACKEND_URL}/api/projects/${selectedProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nextName,
          workspaceName: nextWorkspaceName
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Project identity update failed");
      await loadProjects();
      applyReadyProject(data.project);
      setProjectName(data.project?.name || nextName);
      setWorkspaceName(data.project?.folderName || nextWorkspaceName);
      setProjectFlowPath((current) => current ? { ...current, projectName: data.project?.name || nextName } : current);
      setProjectResult({
        status: "succeeded",
        projectName: data.project?.name || nextName,
        container: `workspace ${data.project?.folderName || nextWorkspaceName}`
      });
    } catch (error) {
      setProjectResult({ status: "failed", projectName: selectedProject.name, error: error.message });
      setRuntimeLogs((current) =>
        mergeRuntimeRows([{ id: `project-rename-error-${Date.now()}`, type: "error", message: error.message, createdAt: new Date().toISOString(), time: formatIstTime() }], current)
      );
    } finally {
      setUpdatingProjectIdentity(false);
    }
  }

  async function controlProjectInstance(action) {
    if (!selectedProject || projectInstanceBusy) return;
    const targetProject = selectedProject;
    const startedAt = Date.now();
    const actionLabel = action === "start" ? "Starting" : "Stopping";
    setProjectInstanceAction(action);
    setGeneratedStatus("working");
    setRuntimeLogs((current) =>
      mergeRuntimeRows(
        [
          {
            id: `project-instance-${action}-${startedAt}`,
            type: `project-instance-${action}`,
            message: `${actionLabel} ${targetProject.name} playground instance...`,
            createdAt: new Date(startedAt).toISOString(),
            time: formatIstTime()
          }
        ],
        current
      )
    );
    try {
      const res = await authFetch(`${BACKEND_URL}/api/projects/${targetProject.id}/instance/${action}`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Project instance ${action} failed`);
      await loadProjects();
      applyReadyProject(data.project);
      setProjectResult({
        status: "succeeded",
        projectName: data.project?.name || targetProject.name,
        container: action === "start" ? `port ${data.project?.port || targetProject.port} started` : "instance stopped"
      });
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `project-instance-${action}-ready-${Date.now()}`,
              type: `project-instance-${action}-ready`,
              message: `${data.project?.name || targetProject.name} instance ${action === "start" ? "started" : "stopped"}.`,
              createdAt: new Date().toISOString(),
              time: formatIstTime()
            }
          ],
          current
        )
      );
    } catch (error) {
      setProjectResult({ status: "failed", projectName: targetProject.name, error: error.message });
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `project-instance-${action}-error-${Date.now()}`,
              type: "error",
              message: error.message,
              createdAt: new Date().toISOString(),
              time: formatIstTime()
            }
          ],
          current
        )
      );
    } finally {
      setProjectInstanceAction("");
      setGeneratedStatus("ready");
    }
  }

  async function rebuildSelectedProject() {
    if (!selectedProject || selectedProject.isDefault || isRebuildingProject) return;
    const targetProject = selectedProject;
    const startedAt = Date.now();
    const queuedEvent = {
      id: `project-rebuild-${startedAt}`,
      type: "project-rebuild",
      message: `Rebuilding ${targetProject.name} playground runtime...`,
      createdAt: new Date(startedAt).toISOString(),
      time: formatIstTime()
    };
    setRebuildingProject(true);
    setGeneratedStatus("working");
    setRuntimeLogs((current) => mergeRuntimeRows([queuedEvent], current));
    try {
      const res = await authFetch(`${BACKEND_URL}/api/projects/${targetProject.id}/rebuild`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Project rebuild failed");
      await loadProjects();
      applyReadyProject(data.project);
      setProjectResult({
        status: "succeeded",
        projectName: data.project.name,
        container: `port ${data.project.port} after rebuild`
      });
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `project-rebuild-ready-${Date.now()}`,
              type: "project-runtime-ready",
              message: `${data.project.name} rebuilt and reloaded in the playground.`,
              createdAt: new Date().toISOString(),
              time: formatIstTime()
            }
          ],
          current
        )
      );
    } catch (error) {
      setProjectResult({ status: "failed", projectName: targetProject.name, error: error.message });
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `project-rebuild-error-${Date.now()}`,
              type: "error",
              message: error.message,
              createdAt: new Date().toISOString(),
              time: formatIstTime()
            }
          ],
          current
        )
      );
    } finally {
      setRebuildingProject(false);
      setGeneratedStatus("ready");
    }
  }

  function chooseHumanFlowPath(choice) {
    const applyChoice = (flow) => {
      if (!flow) return flow;
      return {
        ...flow,
        summary: `Human Agent selected ${choice.label}.`,
        humanInLoop: {
          ...(flow.humanInLoop || {}),
          required: false,
          choice: choice.id,
          choiceLabel: choice.label,
          choiceImpact: choice.impact
        },
        nextRecommendation: choice.impact
      };
    };
    setProjectFlowPath((current) => applyChoice(current));
    setProjectResult((current) => (current ? { ...current, flowPath: applyChoice(current.flowPath || projectFlowPath) } : current));
  }

  function clearActivityFocus() {
    setActivityTarget("");
    const url = new URL(window.location.href);
    url.searchParams.delete("logs");
    window.history.replaceState({}, "", url);
  }

  useEffect(() => {
    let cancelled = false;
    let source;
    let reconnectTimer;
    let pollTimer;
    let runtimeDisconnected = false;

    async function loadRuntimeLog() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/runtime-log`);
        if (!res.ok) throw new Error(`Runtime log request failed with ${res.status}`);
        const data = await res.json();
        if (!cancelled && Array.isArray(data.logs)) {
          setRuntimeLogs((current) => mergeRuntimeRows(data.logs, current));
          runtimeDisconnected = false;
        }
      } catch {
        if (!cancelled && !runtimeDisconnected) {
          runtimeDisconnected = true;
          const errorRow = {
            id: "runtime-log-disconnected",
            type: "log-disconnected",
            message: "Runtime log endpoint is not reachable yet.",
            createdAt: new Date().toISOString(),
            time: formatIstTime()
          };
          setRuntimeLogs((current) => mergeRuntimeRows([errorRow], current));
        }
      }
    }

    function connect() {
      source = new EventSource(`${BACKEND_URL}/api/events`);
      source.onmessage = (message) => {
        const event = JSON.parse(message.data);
        setEvents((current) => [event, ...current].slice(0, 8));
        setRuntimeLogs((current) => mergeRuntimeRows([event], current));
        if (event.type === "adaptive-route-selected" && event.adaptiveRoute) {
          setProjectFlowPath((current) => {
            const projectLabel = event.projectName || current?.projectName || "Selected project";
            const projectAgentId = agentIdFromProjectName(projectLabel);
            const workingAgents = [
              { id: "plutonix-fullstack-agent", name: "PlutoniX Fullstack Agent", role: "Canonical authority", status: "working", action: "Selecting and supervising the adaptive execution path." },
              ...(event.adaptiveRoute.mode === "single" ? [] : [{ id: projectAgentId, name: `${projectLabel} Orchestrator Agent`, role: "Bounded project executor", status: "working", action: "Executing the selected project task." }]),
              ...(event.adaptiveRoute.requiresIndependentReview ? [{ id: "plutonix-independent-reviewer", name: "PlutoniX Independent Reviewer", role: "Read-only validator", status: "pending", action: "Will independently inspect execution evidence." }] : [])
            ];
            const routeChoices = ["single", "delegated", "delegated_reviewed"].map((mode) => ({
              id: mode,
              label: mode.replaceAll("_", " "),
              type: mode === event.adaptiveRoute.mode ? "decision" : "rejection",
              state: mode === event.adaptiveRoute.mode ? "selected" : "rejected",
              reason: mode === event.adaptiveRoute.mode ? event.adaptiveRoute.reasons?.join(" ") : "Not selected by the current task, risk, and model-call constraints."
            }));
            return {
              ...(current || {}),
              projectName: projectLabel,
              status: "running",
              selectedPath: "plutonix-global-orchestration",
              adaptiveRoute: event.adaptiveRoute,
              activeAgents: workingAgents,
              decisionTree: {
                id: event.parentWorkflowId || `route-${Date.now()}`,
                label: `${projectLabel} adaptive workflow`,
                type: "workflow",
                state: "selected",
                children: [
                  { id: "adaptive-routing", label: `Adaptive route: ${event.adaptiveRoute.mode}`, type: "decision", state: "selected", children: routeChoices },
                  { id: "working-agents", label: "Working agents", type: "agents", state: "selected", children: workingAgents.map((agent) => ({ ...agent, label: agent.name, type: "agent", state: agent.status })) },
                  { id: "selected-functionalities", label: "Selected features and functionalities", type: "functionalities", state: "pending", detail: "Feature evidence will appear as the execution produces changes." },
                  { id: "rejected-choices", label: "Rejected or not selected", type: "rejections", state: "completed", children: routeChoices.filter((choice) => choice.state === "rejected") }
                ]
              },
              summary: `Adaptive route ${event.adaptiveRoute.mode} selected with ${event.adaptiveRoute.plannedModelCalls} planned model call${event.adaptiveRoute.plannedModelCalls === 1 ? "" : "s"}.`
            };
          });
        }
        if (event.type === "generated") {
          setGeneratedStatus("ready");
          setPreviewKey(Date.now());
        }
        if (
          [
            "request-received",
            "orchestrated",
            "file-plan",
            "generating",
            "codex-start",
            "codex-progress",
            "build-start",
            "files-written",
            "files-applied",
            "runtime-refresh-requested",
            "restarted"
          ].includes(event.type)
        ) {
          setGeneratedStatus("working");
        }
      };
      source.onerror = () => {
        source.close();
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };
    }

    loadRuntimeLog();
    pollTimer = window.setInterval(loadRuntimeLog, 1500);
    connect();
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      window.clearTimeout(reconnectTimer);
      if (source) source.close();
    };
  }, []);

  async function generatePage() {
    if (!canSubmit) return;
    const baseInstruction = instruction.trim();
    const requiredDataInstruction = gothamWorkflowMode === "planner"
      ? ""
      : await ensureRequiredDataForInstruction(baseInstruction, "gotham-chat");
    if (requiredDataInstruction === null) return;
    const startedAt = Date.now();
    const workflowMode = gothamWorkflowMode;
    const studioContextForRun = pendingStudioContext;
    const workflowModeLabel = gothamWorkflowModes.find((mode) => mode.id === workflowMode)?.label || "Execution";
    const intelEnabledForRun = gothamIntelEnabled && !isSystemTarget;
    const submittedInstruction = [
      baseInstruction,
      requiredDataInstruction,
      selectedReferences.length ? uiReferencesInstruction(selectedReferences) : "",
      activePalette ? `Branding colours: ${activePalette.name} (${activePalette.colors.join(", ")}). ${activePalette.reason || "Selected manually."} Use these as brand direction while maintaining accessible text/background contrast.` : "",
      activeAppIcon ? `Use uploaded app icon asset "${activeAppIcon.name}" at ${activeAppIcon.urlPath || activeAppIcon.path}.` : ""
    ].filter(Boolean).join("\n\n");
    const displayInstruction = [
      baseInstruction,
      requiredDataInstruction ? "Required data supplied." : "",
      selectedReferences.length ? `UI references: ${selectedReferences.map((reference) => `#${uiReferenceLabel(reference)}`).join(", ")}` : "",
      activePalette ? `Branding colours: ${activePalette.name}.` : "",
      activeAppIcon ? `App icon: ${activeAppIcon.name}.` : ""
    ].filter(Boolean).join("\n\n");
    const submittedPrompt = [
      `Task Type: ${taskType}`,
      `Gotham Mode: ${workflowModeLabel}`,
      intelEnabledForRun ? `Intel: enabled; select a profile, score proposals, and run only accepted work at score >= ${gothamIntelConfig.minExpansionScore}.` : "",
      `Task: ${displayInstruction}`
    ].filter(Boolean).join("\n");
    setInstruction("");
    setSessionStartedAt(startedAt);
    setRunningInstruction({
      recordedAt: new Date(startedAt).toISOString(),
      startedAt: new Date(startedAt).toISOString(),
      completedAt: "",
      durationMs: null,
      source: "plutonix-gotham-chat",
      projectId: isSystemTarget ? "system:plutonix" : selectedProject?.id || "",
      projectName: isSystemTarget ? "PlutoniX System" : selectedProject?.name || "PlutoniX default workspace",
      taskType,
      workflowMode,
      instruction: displayInstruction,
      intel: intelEnabledForRun ? { enabled: true, ...gothamIntelConfig } : { enabled: false },
      requiredData: requiredDataPayload(),
      status: "running",
      buildId: "",
      childExecutionIds: [],
      changedFiles: [],
      flowPath: isSystemTarget
        ? gothamSystemFlowPath({ taskType, workflowMode })
        : gothamChatFlowPath({
            projectName: selectedProject && !selectedProject.isDefault ? selectedProject.name : "PlutoniX default workspace",
            taskType,
            workflowMode,
            useProjectOrchestrator: Boolean(selectedProject && !selectedProject.isDefault)
          })
    });
    const queuedEvent = {
      id: `queued-${Date.now()}`,
      type: "queued",
      message: `${workflowModeLabel} clicked${intelEnabledForRun ? " with Intel enabled" : ""}. Sending ${isSystemTarget ? "system improvement" : "project"} instruction through ${useGothamMcp ? "local Gotham MCP" : "current Gotham workflow"}...`,
      createdAt: new Date(startedAt).toISOString(),
      time: formatIstTime()
    };
    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      type: "instruction",
      message: submittedPrompt,
      taskType,
      workflowMode,
      promptTarget: isSystemTarget ? "plutonix.system-improvement" : selectedProject ? `${selectedProject.name}.orchestrator-agent` : "plutonix-fullstack-agent",
      createdAt: new Date(startedAt).toISOString(),
      time: formatIstTime()
    };
    setChatPrompts((current) => normalizeRuntimeRows([userMessage, ...current]));
    setEvents((current) => [queuedEvent, ...current].slice(0, 8));
    setRuntimeLogs((current) => mergeRuntimeRows([queuedEvent], current));
    const runningFlowPath = isSystemTarget
      ? gothamSystemFlowPath({ taskType, workflowMode })
      : gothamChatFlowPath({
          projectName: selectedProject && !selectedProject.isDefault ? selectedProject.name : "PlutoniX default workspace",
          taskType,
          workflowMode,
          useProjectOrchestrator: Boolean(selectedProject && !selectedProject.isDefault)
        });
    setFlowExpanded(true);
    setProjectFlowPath(runningFlowPath);
    setProjectResult((current) => ({
      ...(current || {}),
      status: "running",
      projectName: runningFlowPath.projectName,
      flowPath: runningFlowPath
    }));
    setGenerating(true);
    setGeneratedStatus("working");
    try {
      const res = await authFetch(`${BACKEND_URL}${useGothamMcp ? "/api/generate/mcp" : "/api/generate"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: submittedInstruction,
          taskType,
          workflowMode,
          intel: intelEnabledForRun
            ? {
                enabled: true,
                minExpansionScore: gothamIntelConfig.minExpansionScore
              }
            : { enabled: false },
          projectId: isSystemTarget ? "" : selectedProjectId,
          workspaceId: isSystemTarget ? "" : selectedProjectId,
          studioContext: studioContextForRun || undefined,
          target: isSystemTarget
            ? { type: "system", systemId: "plutonix" }
            : { type: "project", projectId: selectedProjectId },
          mediaIds: mediaReferenceIds(selectedProject?.media),
          requiredData: requiredDataPayload()
        })
      });
      const data = await res.json();
      if (data.plan) {
        const planMessage = [
          data.plan.summary,
          "",
          "Approach:",
          ...(data.plan.approach || []).map((item) => `- ${item}`),
          "",
          "Validation:",
          ...(data.plan.validationPlan || []).map((item) => `- ${item}`),
          "",
          data.plan.nextInstruction ? `Next: ${data.plan.nextInstruction}` : ""
        ].filter(Boolean).join("\n");
        setChatPrompts((current) => normalizeRuntimeRows([
          {
            id: `planner-response-${Date.now()}`,
            role: "assistant",
            type: "planner-response",
            message: planMessage,
            taskType,
            workflowMode,
            promptTarget: "plutonix-fullstack-agent",
            createdAt: new Date().toISOString(),
            time: formatIstTime()
          },
          ...current
        ]));
      }
      if (data.flowPath) {
        setProjectFlowPath(data.flowPath);
        setProjectResult((current) => ({
          ...(current || {}),
          status: data.status || "succeeded",
          projectName: data.flowPath.projectName,
          flowPath: data.flowPath
        }));
      }
      if (!res.ok) throw new Error(gothamText(data.error || "Gotham MCP workflow failed"));
      setLastBuild(data);
      if (!isSystemTarget) {
        await loadProjects();
        await loadProjectInstructions(selectedProjectId);
        applyReadyProject(data.restart?.project);
      }
      setSelectedReferences([]);
      applyInputConsumption(data, { planner: workflowMode === "planner" });
      setPreviewKey(Date.now());
    } catch (error) {
      const errorEvent = {
        id: `error-${Date.now()}`,
        type: "error",
        message: error.message,
        createdAt: new Date().toISOString(),
        time: formatIstTime()
      };
      setEvents((current) => [errorEvent, ...current].slice(0, 8));
      setRuntimeLogs((current) => mergeRuntimeRows([errorEvent], current));
      const markFlowFailed = (current) => {
        const activeFlow = current || runningFlowPath;
        const selectedExecutionPath = activeFlow.selectedPath && activeFlow.selectedPath !== "human-choice-review"
          ? activeFlow.selectedPath
          : (activeFlow.adaptiveRoute ? "plutonix-global-orchestration" : runningFlowPath.selectedPath);
        return {
        ...activeFlow,
        status: "failed",
        selectedPath: selectedExecutionPath,
        summary: "Gotham chat instruction failed after the selected execution path ran. A recovery choice is now pending.",
        humanInLoop: {
          required: true,
          reason: "A human choice is needed before retrying or changing the development path.",
          choices: [
            { id: "retry-same-path", label: "Retry same path", impact: "Use the same workflow path again." },
            { id: "simplify-scope", label: "Simplify scope", impact: "Reduce requirements before retrying." },
            { id: "change-architecture", label: "Change architecture", impact: "Choose a different technical direction before generation." }
          ]
        },
        nextRecommendation: "Choose retry, simplify scope, or change architecture."
        };
      };
      setProjectFlowPath((current) => markFlowFailed(current));
      setProjectResult((current) => ({
        ...(current || {}),
        status: "failed",
        projectName: (current?.flowPath || runningFlowPath).projectName,
        flowPath: markFlowFailed(current?.flowPath)
      }));
      await loadProjectInstructions(selectedProjectId);
      await loadProjects().catch(() => {});
      setSelectedReferences([]);
    } finally {
      setPendingStudioContext(null);
      setGenerating(false);
      setStoppingGotham(false);
      setFlowExpanded(false);
      setGeneratedStatus("ready");
      setRunningInstruction(null);
    }
  }

  async function createNewProject() {
    if (!canCreateProject) return;
    const baseInstruction = instruction.trim();
    const requiredDataInstruction = await ensureRequiredDataForInstruction(
      baseInstruction || `Create the smallest useful starter for ${projectName.trim()} without assuming a website, dashboard, or marketing page.`,
      "new-project"
    );
    if (requiredDataInstruction === null) return;
    const startedAt = Date.now();
    const creationPalette = activePalette;
    const stagedMediaInstruction = stagedProjectMedia.length
      ? `New project media references staged before creation:\n${stagedProjectMedia.map((item) => `- ${item.originalName || item.name} (${item.mimeType || "media"})`).join("\n")}`
      : "";
    const submittedInstruction = [
      baseInstruction,
      requiredDataInstruction,
      stagedMediaInstruction,
      creationPalette ? `Branding colours: ${creationPalette.name} (${creationPalette.colors.join(", ")}). ${creationPalette.reason || "Selected manually."} Use these as brand direction while maintaining accessible text/background contrast.` : "",
      activeAppIcon ? `Use uploaded app icon asset "${activeAppIcon.name}" at ${activeAppIcon.urlPath || activeAppIcon.path}.` : ""
    ].filter(Boolean).join("\n\n");
    if (submittedInstruction.length > 12) {
      const submittedPrompt = `Task Type: ${taskType}\nTask: ${submittedInstruction}`;
      const userMessage = {
        id: `new-project-instruction-${Date.now()}`,
        role: "user",
        type: "instruction",
        message: submittedPrompt,
        taskType,
        promptTarget: `${projectName.trim()}.orchestrator-agent`,
        createdAt: new Date(startedAt).toISOString(),
        time: formatIstTime()
      };
      setChatPrompts((current) => normalizeRuntimeRows([userMessage, ...current]));
    }
    setCreatingProject(true);
    setGeneratedStatus("working");
    setFlowExpanded(true);
    setProjectFlowPath({
      status: "running",
      selectedPath: "project-local-orchestrator",
      confidence: 68,
      projectName: projectName.trim(),
      taskType,
      summary: "PlutoniX is selecting the project-local creation path and preparing Gotham handoff.",
      humanInLoop: { required: false, reason: "" },
      nodes: defaultProjectFlowNodes.map((node) => ({
        ...node,
        state:
          node.id === "intake" || node.id === "path-selection"
            ? "completed"
            : node.id === "project-local-orchestrator"
              ? "selected"
              : node.id === "template-only" || node.id === "human-choice-review"
                ? "disabled"
                : "pending"
      })),
      nextRecommendation: "Wait for Gotham generation to finish, then review the preview and generated files."
    });
    setProjectResult({ status: "running", projectName: projectName.trim(), previewUrl: selectedPreviewUrl });
    if (submittedInstruction.length > 12) setInstruction("");
    try {
      const res = await authFetch(`${BACKEND_URL}/api/projects/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          instruction: submittedInstruction.length > 12 ? submittedInstruction : undefined,
          taskType,
          brandingPalette: creationPalette
            ? { name: creationPalette.name, colors: creationPalette.colors, reason: creationPalette.reason || "" }
            : undefined,
          mediaIds: mediaReferenceIds(selectedProject?.media),
          stagedMediaIds: mediaReferenceIds(stagedProjectMedia),
          requiredData: requiredDataPayload()
        })
      });
      const data = await res.json();
      setProjectResult(data);
      if (data.flowPath) setProjectFlowPath(data.flowPath);
      if (!res.ok) throw new Error(data.error || "Project creation failed");
      await loadProjects();
      await loadProjectInstructions(data.project?.id || selectedProjectId);
      applyReadyProject(data.project);
      setStagedProjectMedia([]);
      applyInputConsumption(data);
    } catch (error) {
      setProjectResult((current) => ({
        ...(current || { projectName: projectName.trim(), previewUrl: GENERATED_SITE_URL }),
        status: "failed",
        error: error.message,
        flowPath: current?.flowPath || projectFlowPath
      }));
      await loadProjectInstructions(selectedProjectId);
    } finally {
      setCreatingProject(false);
      setFlowExpanded(false);
      setGeneratedStatus("ready");
    }
  }

  async function uploadMedia(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !selectedProject || selectedProject.isDefault) return;
    setUploadingMedia(true);
    try {
      const body = new FormData();
      for (const file of files) body.append("media", file);
      const res = await authFetch(`${BACKEND_URL}/api/projects/${selectedProject.id}/media`, {
        method: "POST",
        body
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Media upload failed");
      await loadProjects();
    } catch (error) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `media-error-${Date.now()}`,
              type: "error",
              message: error.message,
              createdAt: new Date().toISOString(),
              time: formatIstTime()
            }
          ],
          current
        )
      );
    } finally {
      setUploadingMedia(false);
    }
  }

  async function removeMedia(item) {
    if (!item?.id) return;
    if (!selectedProject || selectedProject.isDefault) {
      setStagedProjectMedia((current) => current.filter((media) => media.id !== item.id));
      return;
    }
    setRemovingMediaId(item.id);
    try {
      const res = await authFetch(`${BACKEND_URL}/api/projects/${selectedProject.id}/media/${encodeURIComponent(item.id)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Media removal failed");
      if (data.project) {
        setProjects((current) => current.map((project) => (project.id === data.project.id ? data.project : project)));
      } else {
        await loadProjects();
      }
    } catch (error) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [{ id: `media-remove-error-${Date.now()}`, type: "error", message: error.message, createdAt: new Date().toISOString(), time: formatIstTime() }],
          current
        )
      );
    } finally {
      setRemovingMediaId("");
    }
  }

  async function stageNewProjectMedia(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || selectedProject || isSystemTarget) return;
    setStagingProjectMedia(true);
    try {
      const body = new FormData();
      for (const file of files) body.append("media", file);
      const res = await authFetch(`${BACKEND_URL}/api/project-media/stage`, {
        method: "POST",
        body
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Media staging failed");
      const staged = Array.isArray(data.media) ? data.media : [];
      setStagedProjectMedia((current) => [...current, ...staged]);
      setProjectResult({
        status: "staged",
        projectName: projectName.trim() || "New project",
        message: `${staged.length} media reference${staged.length === 1 ? "" : "s"} staged`
      });
    } catch (error) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [{ id: `media-stage-error-${Date.now()}`, type: "error", message: error.message, createdAt: new Date().toISOString(), time: formatIstTime() }],
          current
        )
      );
    } finally {
      setStagingProjectMedia(false);
    }
  }

  async function uploadAppIcon(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedProject || selectedProject.isDefault) return;
    setUploadingMedia(true);
    try {
      const body = new FormData();
      body.append("media", file);
      const res = await authFetch(`${BACKEND_URL}/api/projects/${selectedProject.id}/media?purpose=app-icon`, {
        method: "POST",
        body
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "App icon upload failed");
      await loadProjects();
      setProjectResult({
        status: "succeeded",
        projectName: selectedProject.name,
        container: `App icon uploaded: ${file.name}`
      });
    } catch (error) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `app-icon-error-${Date.now()}`,
              type: "error",
              message: error.message,
              createdAt: new Date().toISOString(),
              time: formatIstTime()
            }
          ],
          current
        )
      );
    } finally {
      setUploadingMedia(false);
    }
  }

  async function importProject(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportingProject(true);
    setGeneratedStatus("working");
    try {
      const body = new FormData();
      body.append("name", file.name.replace(/\.zip$/i, ""));
      body.append("project", file);
      const res = await authFetch(`${BACKEND_URL}/api/projects/import`, {
        method: "POST",
        body
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Project import failed");
      await loadProjects();
      applyReadyProject(data.project);
      setProjectResult({ status: "succeeded", projectName: data.project.name, container: `port ${data.project.port}` });
    } catch (error) {
      setProjectResult({ status: "failed", projectName: file.name, error: error.message });
    } finally {
      setImportingProject(false);
      setGeneratedStatus("ready");
    }
  }

  async function analyzeArchitectureBranches() {
    if (!selectedProject || isAnalyzingArchitecture) return;
    setAnalyzingArchitecture(true);
    setArchitectureBranchError("");
    try {
      const res = await authFetch(`${BACKEND_URL}/api/decision-continuity/projects/${encodeURIComponent(selectedProject.id)}/architecture-branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedFrom: "plutonix-page" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Architecture branch analysis failed.");
      const report = data.report || null;
      setArchitectureBranchReport(report);
      setProjectResult({
        status: "succeeded",
        projectName: selectedProject.name,
        container: `${report?.functionalities?.length || 0} source-evidenced functionalities · ${report?.publishedBranchCount || 0} deferred alternatives`
      });
    } catch (error) {
      setArchitectureBranchError(error.message);
      setProjectResult({ status: "failed", projectName: selectedProject.name, error: error.message });
    } finally {
      setAnalyzingArchitecture(false);
    }
  }

  async function deleteSelectedProject() {
    if (!selectedProject || selectedProject.isDefault || isDeletingProject) return;
    const confirmed = window.confirm(
      `Permanently delete ${selectedProject.name}? This removes its workspace, containers, database volumes, agents, and generated files.`
    );
    if (!confirmed) return;
    setDeletingProject(true);
    setGeneratedStatus("working");
    try {
      const res = await authFetch(`${BACKEND_URL}/api/projects/${selectedProject.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Project deletion failed");
      setSelectedProjectId("");
      await loadProjects();
      setProjectResult({
        status: "succeeded",
        projectName: data.project.name,
        container: "workspace and runtime data deleted"
      });
      setPreviewKey(Date.now());
    } catch (error) {
      setProjectResult({ status: "failed", projectName: selectedProject.name, error: error.message });
    } finally {
      setDeletingProject(false);
      setGeneratedStatus("ready");
    }
  }

  function openStudioWorkspace(workspace, { plutonixTab = "" } = {}) {
    const authorizedWorkspace = authorizedStudioWorkspace(workspace, currentUser);
    if (authorizedWorkspace === "studio" && workspace !== "studio") {
      setActiveWorkspaceTab("studio");
      window.requestAnimationFrame(() => document.getElementById("studio-access")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    if (plutonixTab) setActiveAgenticSystemTab(plutonixTab);
    setActiveWorkspaceTab(authorizedWorkspace);
  }

  function askGothamFromStudio(prompt, studioContext = {}) {
    const nextPrompt = String(prompt || "").trim();
    if (!nextPrompt) return;
    setInstruction(nextPrompt);
    setPendingStudioContext(studioContext);
    if (studioContext.selectedJobId) setStudioSelectedJobId(studioContext.selectedJobId);
    openStudioWorkspace("builder");
    window.requestAnimationFrame(() => instructionEditorRef.current?.focus());
  }

  function openStudioJob(jobId) {
    setStudioSelectedJobId(jobId);
    setStudioInitialTab("jobs");
    openStudioWorkspace("gotham-studio");
  }

  function openStudioResource(resource = {}) {
    const resourceType = String(resource.type || "");
    const resourceId = String(resource.id || "");
    setStudioSelectedJobId(resourceType === "ml_job" ? resourceId : "");
    setStudioInitialTab(resourceType === "ml_pipeline" ? "pipelines" : "jobs");
    openStudioWorkspace("gotham-studio");
  }

  function openStudioFunctionality(functionalityId) {
    setActivityTarget(functionalityId);
    setFlowExpanded(true);
    openStudioWorkspace("builder");
  }

  const visibleWorkspaceTab = authorizedStudioWorkspace(activeWorkspaceTab, currentUser);

  return (
    <div className="workspace-shell">
      <nav className="workspace-tabs" aria-label="PlutoniX workspace tabs">
        <div className="workspace-brand">
          <img
            className="brand-mark"
            src={`/branding/${resolvedTheme === "dark" ? "plutonix-dark-icon.png" : "plutonix-icon.png"}`}
            alt="PlutoniX logo"
          />
          <div>
            <h1>PlutoniX</h1>
            <p>Autonomous multi-artifact creation system</p>
          </div>
        </div>
        <button
          type="button"
          className={visibleWorkspaceTab === "studio" ? "active" : ""}
          onClick={() => openStudioWorkspace("studio")}
          aria-selected={visibleWorkspaceTab === "studio"}
        >
          <Palette size={15} />
          Studio
        </button>
        {currentUser?.id ? <>
        <button
          type="button"
          className={visibleWorkspaceTab === "builder" ? "active" : ""}
          onClick={() => openStudioWorkspace("builder")}
          aria-selected={visibleWorkspaceTab === "builder"}
        >
          <Sparkles size={15} />
          Builder
        </button>
        <button
          type="button"
          className={visibleWorkspaceTab === "agentic-system" ? "active" : ""}
          onClick={() => openStudioWorkspace("agentic-system")}
          aria-selected={visibleWorkspaceTab === "agentic-system"}
        >
          <BrainCircuit size={15} />
          PlutoniX
        </button>
        <button
          type="button"
          className={visibleWorkspaceTab === "agents" ? "active" : ""}
          onClick={() => openStudioWorkspace("agents")}
          aria-selected={visibleWorkspaceTab === "agents"}
        >
          <Bot size={15} />
          Agents
        </button>
        <button
          type="button"
          className={visibleWorkspaceTab === "hosting" ? "active" : ""}
          onClick={() => openStudioWorkspace("hosting")}
          aria-selected={visibleWorkspaceTab === "hosting"}
        >
          <Server size={15} />
          Cloud Hosting
        </button>
        </> : <span className="workspace-public-context"><LockKeyhole size={13} /> Product overview</span>}
        <div className="theme-switch" role="radiogroup" aria-label="Theme">
          {themeOptions.map((option) => {
            const ThemeIcon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                className={themeMode === option.id ? "active" : ""}
                onClick={() => setThemeMode(option.id)}
                role="radio"
                aria-checked={themeMode === option.id}
                aria-label={`${option.label} theme`}
                title={`${option.label} theme`}
              >
                <ThemeIcon size={15} />
              </button>
            );
          })}
        </div>
        {currentUser?.id && mcpWorkflowRunning ? <span className="workspace-running"><i />Gotham workflow running</span> : null}
        {currentUser?.id ? <SelfImprovementRunIndicator /> : null}
        {currentUser ? <div className="user-profile-control">
          <span className="verified-profile" title={currentUser.email || currentUser.id}>
            {currentUser.picture ? <img src={currentUser.picture} alt="" referrerPolicy="no-referrer" /> : <UserRound size={15} />}
            <div><b>{currentUser.name}</b><small>{currentUser.authProvider === "oidc" ? "Google profile" : "Development profile"}</small></div>
          </span>
          <button type="button" onClick={clearUser}>Sign out</button>
        </div> : <div className="user-profile-control auth-entry-control">
          <button
            type="button"
            className="google-login-button"
            onClick={startGoogleSignIn}
            disabled={!isGoogleSsoReady}
            title={isGoogleSsoReady ? "Continue with Google" : googleSignInMessage || "Google SSO is loading"}
          >
            <svg className="google-mark" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
            </svg>
            <span className="google-login-label">Continue with Google</span>
          </button>
          {googleSignInMessage ? <small className="google-signin-status" role="status">{googleSignInMessage}</small> : null}
        </div>}
      </nav>
      {visibleWorkspaceTab === "studio" ? (
        <StudioPage
          currentUser={currentUser}
          onOpenBuilder={() => openStudioWorkspace("builder")}
          onOpenPlutonix={() => openStudioWorkspace("agentic-system", { plutonixTab: "analysis" })}
          onOpenAgents={() => openStudioWorkspace("agents")}
          onOpenHosting={() => openStudioWorkspace("hosting")}
          onOpenProductDocument={() => openStudioWorkspace("agentic-system", { plutonixTab: "product-document" })}
          developmentAuthEnabled={DEVELOPMENT_AUTH_ENABLED}
          onUseDevelopmentProfile={useLocalProfile}
        />
      ) : visibleWorkspaceTab === "gotham-studio" ? (
        <GothamStudio
          project={selectedProject}
          workflowMode={gothamWorkflowMode}
          initialJobId={studioSelectedJobId}
          initialTab={studioInitialTab}
          onBack={() => openStudioWorkspace("builder")}
          onAskGotham={askGothamFromStudio}
          onOpenFunctionality={openStudioFunctionality}
        />
      ) : visibleWorkspaceTab === "builder" ? (
      <main
        className={`app-shell ${selectedProject || isSystemTarget ? (showExpandedFlow ? "flow-expanded" : "flow-collapsed") : "no-flow"}`}
        style={{ "--gotham-chat-width": `${Math.round(gothamChatWidth)}px` }}
      >
      <section className="preview-panel">
        <header className="preview-toolbar">
          <div className="preview-toolbar-stage preview-toolbar-primary">
            <div className="preview-title">
              {browserPreview ? <MonitorSmartphone size={20} /> : apiContractPreview ? <Server size={20} /> : <ArtifactKindIcon kind={selectedArtifact?.kind} size={20} />}
              <div>
                <h2>{browserPreview ? "Playground" : apiContractPreview ? "API contract Playground" : `${artifactKindLabel(selectedArtifact?.kind)} preview`}</h2>
                <p>{isSystemTarget ? "Platform self-improvement target" : apiContractPreview ? activeIntelProfile?.displayName || "API service" : selectedArtifact?.path || selectedPreviewUrl || "No project selected"}</p>
              </div>
            </div>
	            <select
	              className="project-select"
	              value={selectedProjectId}
              onChange={(event) => selectProject(event.target.value)}
              disabled={isSelectingProject}
            >
              <option value="">Select project</option>
              <option value={SYSTEM_TARGET_VALUE}>PlutoniX System</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} : {project.port}
	                </option>
	              ))}
	            </select>
		          </div>
          <div className="preview-toolbar-stage toolbar-actions">
            <div className="playground-notification-center">
              <button
                type="button"
                className={`icon-button notification-button ${notificationsOpen ? "active" : ""}`}
                onClick={() => setNotificationsOpen((open) => !open)}
                title={`Project notifications: ${playgroundNotifications.length} in the last 24 hours`}
                aria-label={`Open notifications for ${selectedProject?.name || "PlutoniX"}`}
                aria-expanded={notificationsOpen}
              >
                <Bell size={17} />
                {notificationAttentionCount ? <span className="notification-badge">{notificationAttentionCount > 9 ? "9+" : notificationAttentionCount}</span> : null}
              </button>
              {notificationsOpen ? (
                <section className="playground-notification-popover" aria-label="Project notifications">
                  <header>
                    <div>
                      <strong>{selectedProject?.name || "PlutoniX"}</strong>
                      <small>Last 24 hours</small>
                    </div>
                    <button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><X size={14} /></button>
                  </header>
                  <ol>
                    {playgroundNotifications.length ? playgroundNotifications.map((event) => (
                      <li key={`notification-${event.id || `${event.type}-${event.createdAt}`}`} className={/failed|error|upgrade-required|fallback-failed/i.test(event.type || "") ? "attention" : ""}>
                        <span>{gothamText(event.message)}</span>
                        <small>{formatIstTime(event.createdAt)}</small>
                      </li>
                    )) : <li className="empty-state">No notifications for this project in the last 24 hours.</li>}
                  </ol>
                </section>
              ) : null}
            </div>
            {browserPreview ? (
              <>
                <div className="device-toggle" aria-label="Preview device size">
                  {devicePresets.map((device) => {
                    const DeviceIcon = device.icon;
                    return (
                      <button
                        key={device.id}
                        className={`device-button ${previewDeviceId === device.id ? "active" : ""}`}
                        onClick={() => setPreviewDeviceId(device.id)}
                        title={`${device.label} ${device.width}x${device.height}`}
                        aria-label={`${device.label} preview`}
                      >
                        <DeviceIcon size={16} />
                      </button>
                    );
                  })}
                </div>
                <button
                  className={`icon-button ${isPickingReference ? "active" : ""}`}
                  onClick={() => sendReferenceMode(!isPickingReference)}
                  disabled={!selectedProject}
                  title="Select a playground reference"
                >
                  <MousePointer2 size={18} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => selectProject(selectedProjectId)}
                  disabled={!selectedProject || isSelectingProject || isRebuildingProject || projectInstanceBusy}
                  title="Restart if needed and reload preview"
                >
                  <RefreshCcw size={18} />
                </button>
                <button
                  className="text-button instance-start"
                  onClick={() => controlProjectInstance("start")}
                  disabled={!selectedProject || isSelectingProject || isRebuildingProject || projectInstanceBusy || !selectedRuntimeStopped}
                  title="Start selected project instance"
                  aria-label="Start selected project instance"
                >
                  {projectInstanceAction === "start" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                  <span>Start</span>
                </button>
                <button
                  className="text-button instance-stop"
                  onClick={() => controlProjectInstance("stop")}
                  disabled={!selectedProject || isSelectingProject || isRebuildingProject || projectInstanceBusy || selectedRuntimeStopped}
                  title="Stop selected project instance"
                  aria-label="Stop selected project instance"
                >
                  {projectInstanceAction === "stop" ? <Loader2 className="spin" size={16} /> : <Pause size={16} />}
                  <span>Stop</span>
                </button>
                <button
                  className="icon-button rebuild-button"
                  onClick={rebuildSelectedProject}
                  disabled={!selectedProject || selectedProject.isDefault || isSelectingProject || isRebuildingProject || projectInstanceBusy}
                  title="Rebuild selected project runtime"
                  aria-label="Rebuild selected project runtime"
                >
                  {isRebuildingProject ? <Loader2 className="spin" size={18} /> : <Hammer size={18} />}
                </button>
                {selectedBackendInterface ? (
                  <a
                    className="text-button backend-interface-button"
                    href={selectedBackendInterface.url}
                    target="_blank"
                    rel="noreferrer"
                    title={
                      selectedBackendInterface.docsUrl
                        ? "Open backend Swagger interface"
                        : selectedBackendInterface.openApiUrl
                          ? "Open backend OpenAPI interface"
                          : "Open backend API interface"
                    }
                    aria-label="Open backend interface"
                  >
                    <Server size={16} />
                    <span>Backend</span>
                  </a>
                ) : null}
              </>
            ) : (
              <button
                className="icon-button"
                onClick={() => loadProjectArtifacts(selectedProjectId)}
                disabled={!selectedProject || artifactsLoading}
                title="Refresh artifacts"
              >
                {artifactsLoading ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
              </button>
            )}
            {selectedProject && (browserPreview ? selectedPreviewUrl : selectedArtifactUrl) ? (
              <a className="icon-button" href={browserPreview ? selectedPreviewUrl : selectedArtifactUrl} target="_blank" rel="noreferrer" title="Open preview">
                <ExternalLink size={18} />
              </a>
            ) : (
              <button className="icon-button" disabled title="Open preview">
                <ExternalLink size={18} />
              </button>
            )}
          </div>
        </header>

        <div className="preview-stage">
          <div
            className={`preview-frame-wrap ${browserPreview ? previewDeviceId : "artifact-mode"} ${workflowRunning ? "running-preview-border" : ""}`}
            style={{
              "--preview-width": `${previewDevice.width}px`,
              "--preview-height": `${previewDevice.height}px`
            }}
          >
            {isSystemTarget ? (
              <div className="empty-playground system-playground">
                <ShieldCheck size={28} />
                <span>PlutoniX System selected. Gotham will create a proposal before platform changes.</span>
              </div>
            ) : selectedProject && apiContractPreview ? (
              <div className="empty-playground api-contract-playground">
                <Server size={28} />
                <strong>{activeIntelProfile?.displayName || "API service"}</strong>
                <span>This profile uses an API or code contract preview, not a web iframe.</span>
                {selectedBackendInterface ? (
                  <a className="text-button backend-interface-button" href={selectedBackendInterface.url} target="_blank" rel="noreferrer">
                    <Server size={16} /><span>Open API interface</span>
                  </a>
                ) : <small>Backend interface details will appear when the generated service exposes an OpenAPI or Swagger endpoint.</small>}
              </div>
            ) : selectedProject && !browserPreview ? (
              artifactsLoading ? (
                <div className="empty-playground">
                  <Loader2 className="spin" size={28} />
                  <span>Loading generated artifacts...</span>
                </div>
              ) : selectedArtifact ? (
                <div className="artifact-workspace">
                  <aside className="artifact-library" aria-label="Generated artifacts">
                    <header>
                      <span>Generated output</span>
                      <strong>{projectArtifacts.length} artifact{projectArtifacts.length === 1 ? "" : "s"}</strong>
                    </header>
                    <div>
                      {projectArtifacts.map((artifact) => (
                        <button
                          type="button"
                          className={artifact.path === selectedArtifact.path ? "active" : ""}
                          key={artifact.path}
                          onClick={() => setSelectedArtifactPath(artifact.path)}
                          title={artifact.path}
                        >
                          <span><ArtifactKindIcon kind={artifact.kind} size={17} /></span>
                          <span>
                            <strong>{artifact.name}</strong>
                            <small>{artifactKindLabel(artifact.kind)} · {formatArtifactSize(artifact.size)}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </aside>
                  <div className={`artifact-preview kind-${selectedArtifact.kind}`}>
                    <ArtifactCanvas
                      key={selectedArtifact.path}
                      artifact={selectedArtifact}
                      preview={artifactPreviewData}
                      artifactUrl={selectedArtifactUrl}
                      loading={artifactPreviewLoading}
                      error={artifactPreviewError}
                    />
                    <div className="artifact-preview-bar">
                      <span>
                        <strong>{selectedArtifact.name}</strong>
                        <small>{artifactKindLabel(selectedArtifact.kind)} · {formatArtifactSize(selectedArtifact.size)}</small>
                      </span>
                      <a href={selectedArtifactUrl} target="_blank" rel="noreferrer" title="Download artifact">
                        <Download size={17} />
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-playground">
                  <FileText size={28} />
                  <span>No generated artifact is available yet.</span>
                </div>
              )
            ) : selectedProject && selectedRuntimeStopped ? (
              <div className="empty-playground stopped-playground">
                <Pause size={28} />
                <span>{selectedProject.name} instance is stopped. Click Start to load its playground.</span>
              </div>
            ) : selectedProject ? (
              <>
                <iframe
                  ref={previewFrameRef}
                  key={previewKey}
                  title="Generated webpage preview"
                  src={selectedPreviewUrl}
                  onLoad={() => {
                    if (isPickingReference) sendReferenceMode(true);
                  }}
                />
                {isPickingReference ? (
                  <span className="reference-status picking">Click a UI element in the playground</span>
                ) : selectedReferences.length ? (
                  <span className="reference-status">
                    Selected UI: {selectedReferences.length} element{selectedReferences.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </>
            ) : (
              <div className="empty-playground">
                <MonitorSmartphone size={28} />
                <span>Select a project to load its playground.</span>
              </div>
            )}
          </div>
        </div>

        <ProjectTechStackGraph
          snapshots={visibleTechStackSnapshots}
          selectedIndex={techStackIndex}
          onSelectIndex={setTechStackIndex}
          hasProject={Boolean(selectedProject) || isSystemTarget}
        />

        <footer className="build-footer">
          <div>
            <CheckCircle2 size={18} />
            <span>Shared generated-site volume with Vite hot reload</span>
          </div>
          <div>
            <Code2 size={18} />
            <span>{lastBuild?.files?.length ? `${lastBuild.files.length} files updated` : "Ready to generate"}</span>
          </div>
          <div>
            <Play size={18} />
            <span>{isSystemTarget ? "System target" : selectedProject ? (selectedProject.isDefault ? "Containerized preview" : `Port ${selectedProject.port}`) : "No port selected"}</span>
          </div>
        </footer>
      </section>

      {selectedProject || isSystemTarget ? (
        <ProjectFlowPanel
          key={selectedProjectId}
          projectId={selectedProjectId}
          flowPath={selectedProjectFlowPath}
          decisionHistory={projectInstructions}
          expanded={showExpandedFlow}
          running={isGenerating}
          onToggle={() => setFlowExpanded((value) => !value)}
          onHumanChoice={chooseHumanFlowPath}
          onOpenStudioResource={openStudioResource}
        />
      ) : null}

      <aside className="control-panel">
        <button
          type="button"
          className="gotham-panel-resize-handle"
          onPointerDown={startGothamPanelResize}
          onPointerMove={resizeGothamPanel}
          onPointerUp={stopGothamPanelResize}
          onPointerCancel={stopGothamPanelResize}
          aria-label="Resize Gotham chat panel"
          title="Drag left or right to resize Gotham chat"
        >
          <GripVertical size={15} />
        </button>
		        <section
		          className={`composer chat-card ${mcpWorkflowRunning ? "mcp-running-border" : ""}`}
		          aria-busy={workflowRunning || mcpWorkflowRunning || isUploadingMedia || isStagingProjectMedia || Boolean(isRemovingMediaId)}
		        >
		          <div className="section-heading gotham-panel-header">
		            <BrainCircuit size={19} />
		            <div className="gotham-chat-title">
		              <h2>Gotham Builder chat</h2>
	              <small>{isSystemTarget ? "System workshop" : selectedProject ? selectedProject.name : "New app workshop"}</small>
	            </div>
	            <label className="mcp-execution-switch" title="Use the local MCP server as the alternative Gotham execution path">
	              <input
	                type="checkbox"
                checked={useGothamMcp}
                onChange={(event) => setUseGothamMcp(event.target.checked)}
                disabled={isGenerating || isCreatingProject}
              />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
		              </span>
			              <span className="switch-label">{useGothamMcp ? "MCP on" : "MCP off"}</span>
			            </label>
			            <button
			              type="button"
			              className={`gotham-intel-toggle ${gothamIntelEnabled && !isSystemTarget ? "active" : ""}`}
			              onClick={() => setGothamIntelEnabled((enabled) => !enabled)}
			              aria-pressed={gothamIntelEnabled && !isSystemTarget}
			              disabled={isSystemTarget}
			              title={
			                isSystemTarget
			                  ? "Intel expands selected application functionality, not the PlutoniX system target."
			                  : "Use profile-driven specialists, backend proposal scoring, one writer, validation, and independent verification for this selected project."
			              }
			            >
			              <Network size={14} />
			              <span>Intel</span>
			              <small>{gothamIntelEnabled && !isSystemTarget ? `profiles · score ≥ ${gothamIntelConfig.minExpansionScore}` : isSystemTarget ? "project only" : "off"}</small>
			            </button>
			            <button
			              type="button"
			              className="gotham-studio-toggle"
			              onClick={() => openStudioWorkspace("gotham-studio")}
			              disabled={!selectedProject || isSystemTarget}
			              aria-label="Open Gotham Studio ML execution workspace"
			              aria-pressed={visibleWorkspaceTab === "gotham-studio"}
			              title={selectedProject ? "Open the project-scoped AI/ML execution control plane" : "Select a project before opening Gotham Studio"}
			            >
			              <FlaskConical size={14} />
			              <span>Studio</span>
			              <small>ML control</small>
			            </button>
			          </div>
		          <section className="instruction-workshop" aria-label="Instruction workshop">
			            <section id="activity-log" className="activity-card workshop-activity-log">
			              <div className="section-heading">
			                <Activity size={18} />
			                <h2>Activity log</h2>
			              </div>
			              <div className="activity-filters" role="tablist" aria-label="Activity log filters">
			                {activityFilters.map((filter) => (
			                  <button
			                    key={filter.id}
			                    type="button"
			                    className={activityFilter === filter.id ? "active" : ""}
			                    onClick={() => setActivityFilter(filter.id)}
			                    role="tab"
			                    aria-selected={activityFilter === filter.id}
			                  >
			                    {filter.label}
			                  </button>
			                ))}
			              </div>
			              {activityTarget ? (
			                <div className="activity-target-filter" role="status">
			                  <span>Agent focus</span>
			                  <strong>{activityTarget}</strong>
			                  <button type="button" onClick={clearActivityFocus} aria-label={`Clear activity filter for ${activityTarget}`}>
			                    <X size={13} />
			                  </button>
			                </div>
			              ) : null}
			              <ol>
			                {activityEvents.length ? (
			                  activityEvents.map((event) => <EventRow key={`activity-${event.id || event.createdAt}`} event={event} sessionStartedAt={sessionStartedAt} selectedProject={selectedProject} onOpenStudio={openStudioJob} />)
			                ) : (
			                  <li className="empty-state">
			                    {activityTarget ? `No activity events matched ${activityTarget}.` : "Activity events will appear here."}
			                  </li>
			                )}
			              </ol>
			            </section>
            <p className="orchestrator-note">
	              {activePalette || activeAppIcon
	                ? `Task Type: ${taskType}. Gotham: ${gothamWorkflowModes.find((mode) => mode.id === gothamWorkflowMode)?.label || "Execution"}.${gothamIntelEnabled && !isSystemTarget ? ` Intel: profile-driven scoring.` : ""}${activePalette ? ` Palette: ${activePalette.name}.` : ""}${activeAppIcon ? ` Icon: ${activeAppIcon.name}.` : ""} Path: ${useGothamMcp ? "local MCP" : "direct"}.`
                : `Task Type: ${taskType}. Gotham: ${gothamWorkflowModes.find((mode) => mode.id === gothamWorkflowMode)?.label || "Execution"}.${gothamIntelEnabled && !isSystemTarget ? ` Intel: profile-driven scoring.` : ""} Path: ${useGothamMcp ? "local MCP" : "direct"}.`}
            </p>
	            <GothamAccountUsagePanel
	              data={gothamAccountUsage}
	              loading={gothamAccountUsageLoading}
	              error={gothamAccountUsageError}
	              expanded={gothamAccountUsageOpen}
	              onExpandedChange={setGothamAccountUsageOpen}
	              onRefresh={() => loadGothamAccountUsage({ refresh: true })}
	            />
	            <div className="chat-input-shell">
	              <div className="instruction-textarea-wrap">
	                <div
	                  ref={instructionEditorRef}
	                  className="instruction-editor"
	                  contentEditable={!isGenerating}
	                  suppressContentEditableWarning
	                  role="textbox"
	                  aria-multiline="true"
	                  onKeyDown={handleInstructionKeyDown}
	                  onInput={handleInstructionEditorInput}
	                  onFocus={rememberInstructionCaret}
	                  onKeyUp={rememberInstructionCaret}
	                  onMouseUp={rememberInstructionCaret}
	                  onPointerOver={(event) => handleInlineReferenceHover(event, true)}
	                  onPointerOut={(event) => handleInlineReferenceHover(event, false)}
	                  aria-invalid={instructionTooLong}
	                  aria-label="Gotham instruction"
	                  aria-describedby={instruction.length >= MAX_INSTRUCTION_CHARS * 0.8 ? "gotham-instruction-length" : undefined}
	                  data-placeholder="Describe the change, issue, or next capability for this project…"
	                />
	                {instruction.length >= MAX_INSTRUCTION_CHARS * 0.8 ? (
	                  <span id="gotham-instruction-length" className={`instruction-length ${instructionTooLong ? "over-limit" : "near-limit"}`} role={instructionTooLong ? "alert" : "status"}>
	                    {instruction.length.toLocaleString()} / {MAX_INSTRUCTION_CHARS.toLocaleString()}
	                  </span>
	                ) : null}
	                <div className="instruction-footer-controls" role="toolbar" aria-label="Instruction controls">
	                  <details
	                    ref={instructionProjectMenuRef}
	                    className="instruction-project-menu"
	                    onKeyDown={(event) => {
	                      if (event.key === "Escape") {
	                        event.currentTarget.removeAttribute("open");
	                        event.currentTarget.querySelector("summary")?.focus();
	                      }
	                    }}
	                  >
	                    <summary aria-label="Open project tools" title="Project tools">
	                      <Hammer size={14} />
	                    </summary>
	                    <div className="instruction-project-menu-panel">
	                      <header>
	                        <strong>Project tools</strong>
	                        <small>Identity, media, import, export, and project management</small>
	                      </header>
	                      <div className={`project-onboarding ${selectedProject && !selectedProject.isDefault ? "editing-project" : "creating-project"}`}>
	                        <input
	                          value={projectName}
	                          onChange={(event) => setProjectName(event.target.value)}
	                          placeholder="Project name"
	                          readOnly={Boolean(isSystemTarget || selectedProject?.isDefault)}
	                          disabled={isUpdatingProjectIdentity}
	                          title={isSystemTarget ? "System target" : selectedProject?.isDefault ? "Shared default preview" : selectedProject ? "Edit project name" : "New project name"}
	                        />
	                        <input
	                          value={workspaceName}
	                          onChange={(event) => setWorkspaceName(event.target.value)}
	                          placeholder="Workspace name"
	                          readOnly={Boolean(isSystemTarget || !selectedProject || selectedProject.isDefault)}
	                          disabled={isUpdatingProjectIdentity}
	                          title={selectedProject && !selectedProject.isDefault ? "Edit workspace folder name" : "Workspace name becomes editable after selecting a managed project"}
	                        />
	                        {selectedProject && !selectedProject.isDefault ? (
	                          <button className="new-project-action identity-save-action" onClick={updateSelectedProjectIdentity} disabled={!canUpdateProjectIdentity}>
	                            {isUpdatingProjectIdentity ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
	                            Save
	                          </button>
	                        ) : null}
	                        <button className="new-project-action" onClick={createNewProject} disabled={!canCreateProject}>
	                          {isCreatingProject ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
	                          New project
	                        </button>
	                      </div>
	                      <div className="project-tools">
	                        <label
	                          className={`tool-action ${isSystemTarget || selectedProject?.isDefault ? "disabled" : ""} ${!selectedProject && stagedProjectMedia.length ? "attention" : ""}`}
	                          title={selectedProject && !selectedProject.isDefault ? "Upload media for the selected project" : "Stage media references for a new project"}
	                        >
	                          {isUploadingMedia || isStagingProjectMedia ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
	                          Media
	                          <input
	                            type="file"
	                            multiple
	                            onChange={selectedProject && !selectedProject.isDefault ? uploadMedia : stageNewProjectMedia}
	                            disabled={isSystemTarget || selectedProject?.isDefault || isUploadingMedia || isStagingProjectMedia}
	                          />
	                        </label>
                        <label className="tool-action">
                          {isImportingProject ? <Loader2 className="spin" size={16} /> : <FolderUp size={16} />}
                          Project
                          <input type="file" accept=".zip" onChange={importProject} disabled={isImportingProject} />
                        </label>
                        <a className={`tool-action ${selectedProject ? "" : "disabled"}`} href={exportUrl}>
	                          <Download size={16} />
	                          Export
	                        </a>
	                        <button
	                          className={`tool-action danger ${!selectedProject || selectedProject.isDefault ? "disabled" : ""}`}
	                          onClick={deleteSelectedProject}
	                          disabled={!selectedProject || selectedProject.isDefault || isDeletingProject || isRebuildingProject}
	                          title="Delete selected project"
	                        >
	                          {isDeletingProject ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                          Delete
                        </button>
                      </div>
                    </div>
	                  </details>
	                <div className={`instruction-context-action ${isGenerating ? "running" : "idle"}`}>
	                  <button
	                    type="button"
	                    className={`suggested-next-jump ${isGenerating ? "hidden" : "visible"}`}
	                    onClick={() => document.getElementById("suggested-next-instruction")?.scrollIntoView({ behavior: "smooth", block: "start" })}
	                    disabled={isGenerating || !workflowNextSuggestion.instruction}
	                    aria-hidden={isGenerating}
	                    tabIndex={isGenerating ? -1 : 0}
	                    aria-label="View suggested next instruction"
	                    aria-controls={!isGenerating && workflowNextSuggestion.instruction ? "suggested-next-instruction" : undefined}
	                    title={workflowNextSuggestion.instruction ? "View suggested next instruction" : "A suggestion will appear after Gotham analyzes project functionality"}
	                  >
	                    <Sparkles size={14} />
	                  </button>
	                  <button
	                    type="button"
	                    className={`instruction-stop-action ${isGenerating ? "visible" : "hidden"}`}
	                    onClick={stopGothamExecution}
	                    disabled={!isGenerating || isStoppingGotham}
	                    aria-hidden={!isGenerating}
	                    tabIndex={isGenerating ? 0 : -1}
	                    aria-label="Stop Gotham job"
	                    title="Stop Gotham job"
	                  >
	                    {isStoppingGotham ? <Loader2 className="spin" size={14} /> : <Square size={12} fill="currentColor" />}
	                  </button>
	                </div>
	                <details
	                  ref={instructionSettingsMenuRef}
	                  className="instruction-settings-menu"
	                  onKeyDown={(event) => {
	                    if (event.key === "Escape") {
	                      event.currentTarget.removeAttribute("open");
	                      event.currentTarget.querySelector("summary")?.focus();
	                    }
	                  }}
	                >
	                  <summary aria-label="Open instruction settings" title="Instruction settings">
	                    <Settings2 size={14} />
	                  </summary>
	                  <div className="instruction-settings-panel">
	                    <header>
	                      <strong>Instruction settings</strong>
	                      <small>Brand appearance and application identity</small>
	                    </header>
	                    <button
	                      type="button"
	                      className="instruction-setting-item"
	                      onClick={(event) => {
	                        event.currentTarget.closest("details")?.removeAttribute("open");
	                        setShowPalettePicker(true);
	                      }}
	                    >
	                      <span className="instruction-setting-icon"><Palette size={15} /></span>
	                      <span className="instruction-setting-copy">
	                        <strong>Brand colors</strong>
	                        <small>{activePalette?.name || "Choose a visual palette"}</small>
	                      </span>
	                      <span className="instruction-brand-swatches" aria-hidden="true">
	                        {(activePalette?.colors || recommendedPalette?.colors || []).slice(0, 3).map((color) => (
	                          <i key={color} style={{ background: color }} />
	                        ))}
	                      </span>
	                    </button>
	                    <label
	                      className={`instruction-setting-item ${!selectedProject || selectedProject.isDefault || isUploadingMedia ? "disabled" : ""}`}
	                      tabIndex={!selectedProject || selectedProject.isDefault || isUploadingMedia ? -1 : 0}
	                      aria-disabled={!selectedProject || selectedProject.isDefault || isUploadingMedia}
	                      onKeyDown={(event) => {
	                        if ((event.key === "Enter" || event.key === " ") && selectedProject && !selectedProject.isDefault && !isUploadingMedia) {
	                          event.preventDefault();
	                          event.currentTarget.querySelector("input")?.click();
	                        }
	                      }}
	                    >
	                      <span className="instruction-setting-icon">
	                        {isUploadingMedia ? <Loader2 className="spin" size={15} /> : <Upload size={15} />}
	                      </span>
	                      <span className="instruction-setting-copy">
	                        <strong>App icon</strong>
	                        <small>{activeAppIcon?.name || "Upload PNG, JPG, WebP, SVG, or ICO"}</small>
	                      </span>
	                      <ChevronRight size={14} />
	                      <input
	                        type="file"
	                        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon"
	                        onChange={(event) => {
	                          instructionSettingsMenuRef.current?.removeAttribute("open");
	                          uploadAppIcon(event);
	                        }}
	                        disabled={!selectedProject || selectedProject.isDefault || isUploadingMedia}
	                      />
	                    </label>
	                  </div>
	                </details>
                <details
                  ref={taskModeMenuRef}
                  className="task-mode-menu"
	                  onKeyDown={(event) => {
	                    if (event.key === "Escape") {
	                      event.currentTarget.removeAttribute("open");
	                      event.currentTarget.querySelector("summary")?.focus();
	                    }
	                  }}
	                >
                  <summary className={`mode-${gothamWorkflowMode}`} aria-label="Choose task size and execution type">
	                    <Gauge size={14} />
	                    <ChevronDown size={12} />
	                  </summary>
	                  <div className="task-mode-menu-panel">
	                    <section aria-labelledby="task-size-menu-label">
	                      <header>
	                        <strong id="task-size-menu-label">Task size</strong>
	                        <small>Scope and reasoning depth</small>
	                      </header>
	                      <div role="radiogroup" aria-label="Task size">
	                        {taskTypeOptions.map((option) => (
	                          <button
	                            key={option.id}
	                            type="button"
	                            className={taskType === option.id ? "active" : ""}
	                            onClick={(event) => {
	                              setTaskType(option.id);
	                              event.currentTarget.closest("details")?.removeAttribute("open");
	                            }}
	                            role="radio"
	                            aria-checked={taskType === option.id}
	                          >
	                            <span>{option.label}</span>
	                            {taskType === option.id ? <CheckCircle2 size={14} /> : null}
	                          </button>
	                        ))}
	                      </div>
	                    </section>
	                    <section aria-labelledby="execution-type-menu-label">
	                      <header>
	                        <strong id="execution-type-menu-label">Execution type</strong>
	                      </header>
	                      <div role="radiogroup" aria-label="Execution type">
	                        {gothamWorkflowModes.map((mode) => {
	                          const ModeIcon = mode.icon;
	                          return (
	                            <button
	                              key={mode.id}
	                              type="button"
	                              className={gothamWorkflowMode === mode.id ? "active" : ""}
	                              onClick={(event) => {
	                                setGothamWorkflowMode(mode.id);
	                                event.currentTarget.closest("details")?.removeAttribute("open");
	                              }}
	                              role="radio"
	                              aria-checked={gothamWorkflowMode === mode.id}
	                              title={mode.detail}
	                            >
	                              <ModeIcon size={14} />
	                              <span>{mode.label}</span>
	                              {gothamWorkflowMode === mode.id ? <CheckCircle2 size={14} /> : null}
	                            </button>
	                          );
	                        })}
	                      </div>
	                    </section>
	                  </div>
	                </details>
	                </div>
	              </div>
	            </div>
	            {(requiredDataFields.length || activeMediaItems?.length) ? (
	              <div className="gotham-context-rail" aria-label="Gotham context">
	                {requiredDataFields.length ? (
	                  <button
	                    type="button"
	                    className={`required-data-action ${requiredDataMissingCount ? "attention" : "ready"}`}
	                    onClick={() => setShowRequiredDataModal(true)}
	                    title={requiredDataMessage || "Required data for the next Gotham iteration"}
	                  >
	                    <FileText size={15} />
	                    <span>{requiredDataMissingCount ? `${requiredDataMissingCount} data needed` : "Data ready"}</span>
	                  </button>
	                ) : null}
	                {activeMediaItems?.length ? (
	                  <div className={`media-strip ${!selectedProject ? "staged" : ""}`}>
	                    {activeMediaItems.slice(-4).map((item) => (
	                      <span key={item.id} className="media-chip" title={item.originalName || item.name}>
	                        {item.originalName || item.name}
	                        <button
	                          type="button"
	                          className="media-chip-remove"
	                          onClick={() => removeMedia(item)}
	                          disabled={isRemovingMediaId === item.id || isUploadingMedia || isStagingProjectMedia}
	                          aria-label={`Remove ${item.originalName || item.name}`}
	                          title="Remove attachment"
	                        >
	                          {isRemovingMediaId === item.id ? <Loader2 className="spin" size={10} /> : <X size={10} />}
	                        </button>
	                      </span>
	                    ))}
	                    {activeMediaItems.length > 4 ? (
	                      <span className="media-chip media-chip-more" aria-label={`${activeMediaItems.length - 4} additional attachments`}>
	                        +{activeMediaItems.length - 4} more
	                      </span>
	                    ) : null}
	                  </div>
	                ) : null}
	              </div>
	            ) : null}
          </section>
        </section>

			          {workflowNextSuggestion.instruction ? (
	            <section id="suggested-next-instruction" className={`workflow-next-instruction ${workflowNextSuggestion.status}`} aria-label="Suggested next instruction">
	              <header>
	                <span><Sparkles size={15} /></span>
	                <div>
	                  <strong>Suggested next instruction</strong>
	                  <small>{workflowNextSuggestion.summary}</small>
	                </div>
	              </header>
	              <div className="workflow-next-nodes" aria-label="Analyzed functionality nodes">
	                {workflowNextSuggestion.nodes.slice(0, 3).map((node) => <span key={node}>{node}</span>)}
	                {workflowNextSuggestion.nodes.length > 3 ? (
	                  <span className="workflow-next-more">+{workflowNextSuggestion.nodes.length - 3} more</span>
	                ) : null}
	              </div>
	              <p className="workflow-next-preview">{workflowNextSuggestion.instruction}</p>
	              <div className="workflow-next-actions">
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => setInstruction(workflowNextSuggestion.instruction)}
                  disabled={workflowRunning}
                >
                  <Sparkles size={14} />
                  Use suggestion
                </button>
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => setInstruction((current) => [current.trim(), workflowNextSuggestion.instruction].filter(Boolean).join("\n\n"))}
                  disabled={workflowRunning}
                >
                  <Plus size={14} />
	                  Append
                </button>
	              </div>
		            </section>
		          ) : null}
        <details className="system-card runtime-collapse">
          <summary>
            <span>
              <Server size={15} />
              Runtime status
            </span>
            <b>{selectedProject ? (generatedStatus === "ready" ? "Live" : "Building") : "Idle"}</b>
          </summary>
          <div className="status-grid compact">
            {metrics.map((metric) => (
              <div className="metric" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                {metric.detail ? <small>{metric.detail}</small> : null}
              </div>
            ))}
          </div>
          <div className="runtime-row">
            <span>Backend API</span>
            <StatusPill status={backendStatus} />
          </div>
          <div className="runtime-row">
            <span>Gotham MCP</span>
            <StatusPill status={mcpStatus} />
          </div>
          <div className="runtime-row">
            <span>Generated site</span>
            <StatusPill status={generatedStatus} />
          </div>
        </details>

        <ProjectInstructionTimeline
          instructions={projectInstructions}
          error={instructionsError}
          runningInstruction={runningInstruction}
          now={instructionTimerNow}
        />
      </aside>
      {showRequiredDataModal ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowRequiredDataModal(false)}>
          <section className="palette-modal required-data-modal" role="dialog" aria-modal="true" aria-label="Required data" onMouseDown={(event) => event.stopPropagation()}>
	            <header className="palette-modal-header">
	              <div>
	                <h2>Required data</h2>
	                <p>{requiredDataMessage || "Gotham needs source inputs before it can build truthful UI behavior and data flows."}</p>
	              </div>
	              <button className="icon-button" onClick={() => setShowRequiredDataModal(false)} title="Close required data">
	                <X size={16} />
	              </button>
	            </header>
	            <div className="required-data-summary">
	              <p>
	                Gotham is asking for the smallest factual source needed to wire the requested experience. Each item below shows the UI surfaces and backend/data elements it affects.
	              </p>
	              {requiredDataContext?.requestedArtifacts?.length ? (
	                <span>{requiredDataContext.requestedArtifacts.join(" / ")}</span>
	              ) : null}
	            </div>
	            <div className="required-data-fields">
	              {requiredDataFields.map((field) => {
	                const accept = requiredDataFileAccept(field);
	                const uploadDisabled = Boolean(requiredDataUploadingFieldId) || isSystemTarget || selectedProject?.isDefault;
	                const uiElements = Array.isArray(field.uiElements) && field.uiElements.length
	                  ? field.uiElements.join(" · ")
	                  : Array.isArray(field.usedFor) && field.usedFor.length
	                    ? field.usedFor.join(" · ")
	                    : "Visible screens, components, forms, lists, states, and copy that rely on this source.";
	                const backendElements = Array.isArray(field.backendElements) && field.backendElements.length
	                  ? field.backendElements.join(" · ")
	                  : /integration|backend|api|database|source_data/i.test(`${field.id} ${field.inputKind || ""} ${field.label || ""}`)
	                    ? "API/client contract, backend adapter, database or integration configuration, credentials hooks, and loading/error states."
	                    : "Data model, local/client state, validation, metadata, and explicit fallback states.";
	                return (
	                  <div key={field.id} className="required-data-field" title={field.purpose || field.reason || field.label}>
                    <span className="required-data-field-header">
                      <span className="required-data-field-label">
                        {field.label}
                        {field.required ? <small>Required</small> : null}
                      </span>
                      {accept ? (
                        <label
                          className={`required-data-upload-action ${uploadDisabled ? "disabled" : ""}`}
                          title={uploadDisabled ? "Media upload needs a managed project or a new project draft" : "Upload source file"}
                        >
                          {requiredDataUploadingFieldId === field.id ? <Loader2 className="spin" size={13} /> : <Upload size={13} />}
                          Upload
                          <input
                            type="file"
                            multiple
                            accept={accept}
                            onChange={(event) => uploadRequiredDataMedia(event, field)}
                            disabled={uploadDisabled}
                          />
                        </label>
                      ) : null}
                    </span>
	                    <div className="required-data-purpose">
	                      <p><b>Why Gotham needs it</b><span>{field.purpose || field.reason || "Required to complete the requested output with supplied facts."}</span></p>
	                      <p><b>UI elements</b><span>{uiElements}</span></p>
	                      <p><b>Backend/data</b><span>{backendElements}</span></p>
	                      <p><b>Used for</b><span>{Array.isArray(field.usedFor) && field.usedFor.length ? field.usedFor.join(" · ") : "The requested output and its data states"}</span></p>
	                      <p><b>Provide</b><span>{field.expectedInput || field.placeholder || "The smallest factual source that satisfies this field."}</span></p>
	                    </div>
                    {field.type === "textarea" ? (
                      <textarea
                        value={requiredDataValues[field.id] || ""}
                        placeholder={field.placeholder || ""}
                        onChange={(event) => setRequiredDataValues((current) => ({ ...current, [field.id]: event.target.value }))}
                      />
                    ) : (
                      <input
                        type={field.type === "url" ? "url" : "text"}
                        value={requiredDataValues[field.id] || ""}
                        placeholder={field.placeholder || ""}
                        onChange={(event) => setRequiredDataValues((current) => ({ ...current, [field.id]: event.target.value }))}
                      />
                    )}
                  </div>
                );
              })}
	            </div>
	            <footer className="palette-footer required-data-footer">
	              <button className="ghost-action" onClick={() => setShowRequiredDataModal(false)}>Close</button>
	              <button className="ghost-action research-action" onClick={allowGothamResearchForRequiredData} disabled={Boolean(requiredDataUploadingFieldId)}>
	                Let Gotham research/fallback
	              </button>
	              <button className="primary-action" onClick={() => setShowRequiredDataModal(false)} disabled={requiredDataMissingCount > 0 || Boolean(requiredDataUploadingFieldId)}>
	                Use next run
	              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {showPalettePicker ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowPalettePicker(false)}>
          <section className="palette-modal" role="dialog" aria-modal="true" aria-label="Branding colour palettes" onMouseDown={(event) => event.stopPropagation()}>
            <header className="palette-modal-header">
              <div>
                <h2>Branding colours</h2>
                <p>Captured during project creation. For existing projects, choose a palette here to change it for the next instruction.</p>
              </div>
              <button className="icon-button" onClick={() => setShowPalettePicker(false)} title="Close palette picker">
                <X size={16} />
              </button>
            </header>
            <div className="palette-list">
              {colorPalettes.map((palette) => (
                <button
                  key={palette.name}
                  className={`palette-option ${activePalette?.name === palette.name ? "active" : ""}`}
                  onClick={() => setBrandingPalette({ ...palette, reason: "Selected manually from Color Hunt." })}
                  title={`Color Hunt palette: ${palette.url}`}
                >
                  <span>{palette.name}{!selectedProject && !brandingPalette && recommendedPalette.name === palette.name ? <small>Recommended</small> : null}</span>
                  <span className="swatch-row">
                    {palette.colors.map((color) => (
                      <i key={color} style={{ background: color }} title={color} />
                    ))}
                  </span>
                </button>
              ))}
            </div>
            <div className="custom-palette">
              <strong>Custom palette</strong>
              <div className="custom-colors">
                {customPalette.map((color, index) => (
                  <label key={index}>
                    <input
                      type="color"
                      value={color}
                      onChange={(event) => {
                        const next = [...customPalette];
                        next[index] = event.target.value;
                        setCustomPalette(next);
                        setBrandingPalette({ name: "Custom", colors: next });
                      }}
                    />
                    <span>{color}</span>
                  </label>
                ))}
              </div>
            </div>
            <footer className="palette-footer">
              <span>{`${palettePickerPreview.name}: ${palettePickerPreview.colors.join(" ")} · ${palettePickerPreview.reason || "Selected manually."}`}</span>
              <button
                className="ghost-action"
                onClick={() => {
                  if (!selectedProject || projectCreationPalette) {
                    setBrandingPalette(null);
                    return;
                  }
                  setBrandingPalette({ ...recommendedPalette, reason: "Selected manually from recommendation." });
                }}
              >
                {selectedProject ? (projectCreationPalette ? "Use creation palette" : "Select recommendation") : "Use recommendation"}
              </button>
              <button className="primary-action" onClick={() => setShowPalettePicker(false)}>Done</button>
            </footer>
          </section>
        </div>
      ) : null}
      </main>
      ) : visibleWorkspaceTab === "agentic-system" ? (
	        <main className={`agentic-workspace-tab ${activeAgenticSystemTab === "control-plane" || activeAgenticSystemTab === "governed-promotion" ? "control-plane-view" : activeAgenticSystemTab === "market-vision" ? "market-vision-view" : activeAgenticSystemTab === "product-document" ? "product-document-view" : "analysis-view"}`}>
	          <header className="plutonix-page-header" aria-label="PlutoniX project navigation and analysis controls">
          <nav className="agentic-system-subtabs" aria-label="PlutoniX views">
            <button
              type="button"
              className={activeAgenticSystemTab === "graph" ? "active" : ""}
              onClick={() => setActiveAgenticSystemTab("graph")}
              aria-pressed={activeAgenticSystemTab === "graph"}
            >
              <BrainCircuit size={15} />
              Analysis
            </button>
            <button
              type="button"
              className={activeAgenticSystemTab === "control-plane" ? "active" : ""}
              onClick={() => setActiveAgenticSystemTab("control-plane")}
              aria-pressed={activeAgenticSystemTab === "control-plane"}
            >
              <ShieldCheck size={15} />
              Control Plane
            </button>
	            <button
	              type="button"
	              className={activeAgenticSystemTab === "governed-promotion" ? "active" : ""}
	              onClick={() => setActiveAgenticSystemTab("governed-promotion")}
	              aria-pressed={activeAgenticSystemTab === "governed-promotion"}
	            >
	              <ShieldCheck size={15} />
	              Governed Promotion
	            </button>
	            <button
	              type="button"
	              className={activeAgenticSystemTab === "market-vision" ? "active" : ""}
              onClick={() => setActiveAgenticSystemTab("market-vision")}
              aria-pressed={activeAgenticSystemTab === "market-vision"}
            >
	              <FileText size={15} />
	              Market Readiness R&D
	            </button>
	            <button
	              type="button"
	              className={activeAgenticSystemTab === "product-document" ? "active" : ""}
	              onClick={() => setActiveAgenticSystemTab("product-document")}
	              aria-pressed={activeAgenticSystemTab === "product-document"}
	            >
	              <FileText size={15} />
	              Product Document
	            </button>
	          </nav>
	          </header>
	          {activeAgenticSystemTab === "control-plane" ? (
	            <SelfImprovementPanel />
	          ) : activeAgenticSystemTab === "governed-promotion" ? (
	            <GovernedPromotionPanel />
	          ) : activeAgenticSystemTab === "market-vision" ? (
	            <MarketVisionPanel />
	          ) : activeAgenticSystemTab === "product-document" ? (
	            <ProductDocumentPanel />
	          ) : (
            <PlutonixAnalysisWorkspace
              projects={projects.filter((project) => !project.isDefault)}
              selectedProject={selectedProject && !selectedProject.isDefault ? selectedProject : null}
              architectureAnalysisReport={architectureBranchReport}
              architectureAnalysisError={architectureBranchError}
              onSelectProject={(project) => {
                if (!project?.id) return;
                setArchitectureBranchReport(null);
                setArchitectureBranchError("");
                setSelectedProjectId(project.id);
                setProjectFlowPath(null);
                setProjectResult(null);
              }}
              onAnalyzeArchitecture={analyzeArchitectureBranches}
              analyzingArchitecture={isAnalyzingArchitecture}
              onProjectUpdated={(project, options = {}) => {
                if (!project?.id) return;
                setProjects((current) => current.map((item) => item.id === project.id ? { ...item, ...project } : item));
                if (options.select !== false) setSelectedProjectId(project.id);
              }}
            />
          )}
        </main>
      ) : visibleWorkspaceTab === "hosting" ? (
        <CloudHostingPage />
      ) : visibleWorkspaceTab === "agents" ? (
        <AgentsWorkspace initialAgentId={deepLink.agent} initialAgent={deepLink.agentContext} />
      ) : (
        <main className="app-shell" />
      )}
    </div>
  );
}
