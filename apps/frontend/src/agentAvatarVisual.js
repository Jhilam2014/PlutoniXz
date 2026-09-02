const KNOWN_AGENT_VISUALS = Object.freeze({
  "plutomix-fullstack-agent": { color: "#334155", accent: "#38bdf8", label: "Fullstack", initials: "PX" },
  "plutomix-independent-reviewer": { color: "#581c87", accent: "#e879f9", label: "Reviewer", initials: "PR" },
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
});

const GENERATED_AGENT_PALETTES = Object.freeze([
  ["#1d4ed8", "#67e8f9"], ["#7c3aed", "#f0abfc"], ["#0f766e", "#5eead4"],
  ["#b45309", "#fde047"], ["#be123c", "#fda4af"], ["#0369a1", "#7dd3fc"],
  ["#4d7c0f", "#bef264"], ["#9f1239", "#f9a8d4"], ["#4338ca", "#a5b4fc"]
]);

function initialsFor(value) {
  const words = String(value || "Agent").replace(/agent$/i, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
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

function displayAgentId(value = "Agent") {
  return String(value || "Agent").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function agentVisualFromId(agentId, fallback = {}) {
  const id = String(agentId || "").trim();
  const base = KNOWN_AGENT_VISUALS[id] || {};
  const hash = stableAgentHash(id || fallback.name || fallback.agentName);
  const generatedPalette = GENERATED_AGENT_PALETTES[hash % GENERATED_AGENT_PALETTES.length];
  const color = base.color || fallback.profile?.color || fallback.color || generatedPalette[0];
  return {
    id: id || "gotham-builder",
    name: fallback.name || base.name || fallback.agentName || displayAgentId(id || "Gotham Builder"),
    label: base.label || fallback.profile?.label || fallback.role || fallback.domain || "Agent",
    initials: base.initials || fallback.initials || initialsFor(fallback.name || id),
    color,
    accent: base.accent || fallback.accent || fallback.profile?.accent || generatedPalette[1],
    role: fallback.role || base.label || fallback.domain || "",
    objective: fallback.objective || fallback.instructionSummary || "",
    capabilities: fallback.capabilities || [],
    variant: hash % 6
  };
}

export function agentVisualFromRecord(agent = {}) {
  return agentVisualFromId(agent.id || agent.agentId, {
    name: agent.name,
    role: agent.role,
    domain: agent.domain,
    profile: agent.profile,
    objective: agent.objective,
    instructionSummary: agent.instructionSummary,
    capabilities: agent.capabilities
  });
}

export function agentIconKind(avatar = {}) {
  const value = `${avatar.id || ""} ${avatar.name || ""} ${avatar.label || ""} ${avatar.role || ""} ${avatar.objective || ""} ${(avatar.capabilities || []).join(" ")}`.toLowerCase();
  if (value.includes("human") || value === "user") return "human";
  if (value.includes("qagent")) return "qagent";
  if (/review|audit|validation|verifier|quality/.test(value)) return "reviewer";
  if (/security|auth|permission|compliance|privacy/.test(value)) return "security";
  if (/test|testing|qa|coverage/.test(value)) return "testing";
  if (/memory|vector|knowledge|graph/.test(value)) return "memory";
  if (/api|backend|service|integration|webhook/.test(value)) return "api";
  if (/voice|audio|speech/.test(value)) return "voice";
  if (/map|geo|location|route/.test(value)) return "geo";
  if (value.includes("orchestrator") || value.includes("plutomix") || value.includes("fullstack")) return "orchestrator";
  if (value.includes("ui") || value.includes("composition") || value.includes("frontend")) return "ui";
  if (/content|copy|media|ocr|document/.test(value)) return "content";
  if (value.includes("data") || value.includes("database")) return "data";
  if (value.includes("runtime") || value.includes("packaging") || value.includes("docker") || value.includes("execution")) return "runtime";
  if (value.includes("commerce") || value.includes("catalog")) return "commerce";
  if (value.includes("analytics") || value.includes("signal") || value.includes("score")) return "analytics";
  return "agent";
}

const GLYPHS = Object.freeze({
  reviewer: '<path d="M20 19h19l7 7-15 20-15-20 4-7Z"/><path d="M24 31l5 5 11-13"/><circle cx="44" cy="19" r="4"/>',
  security: '<path d="M32 16l14 6v10c0 9-6 15-14 18-8-3-14-9-14-18V22l14-6Z"/><path d="M26 32l4 4 9-10"/>',
  testing: '<path d="M25 17h14M28 17v9L19 43c-2 4 1 7 5 7h16c4 0 7-3 5-7L36 26v-9"/><path d="M23 39h18M27 34l3 3 7-7"/>',
  memory: '<path d="M24 19c-7 1-10 8-6 13-4 6 0 13 7 13 3 5 11 4 12-2 7 1 11-7 7-12 3-7-4-14-11-11-2-3-7-3-9-1Z"/><path d="M25 27h14M25 34h14M28 41h8"/>',
  api: '<path d="M22 22h20v20H22z"/><path d="M16 27h6M16 37h6M42 27h6M42 37h6M27 16v6M37 16v6M27 42v6M37 42v6"/><path d="M27 34l4-4 6 6"/>',
  content: '<path d="M20 18h17l7 7v22H20V18Z"/><path d="M37 18v8h7M25 31h14M25 37h14M25 43h9"/>',
  voice: '<rect x="27" y="16" width="10" height="24" rx="5"/><path d="M21 32c0 7 4 12 11 12s11-5 11-12M32 44v6M25 50h14"/>',
  geo: '<path d="M32 49s13-12 13-22a13 13 0 1 0-26 0c0 10 13 22 13 22Z"/><circle cx="32" cy="27" r="5"/>',
  ui: '<rect x="19" y="21" width="26" height="22" rx="4"/><path d="M24 28h8M25 36l-5-4 5-4M39 28l5 4-5 4M31 38l4-12"/>',
  data: '<ellipse cx="32" cy="21" rx="12" ry="5"/><path d="M20 21v18c0 3 5 5 12 5s12-2 12-5V21M20 30c0 3 5 5 12 5s12-2 12-5"/><path d="M43 40l4 4M47 44h4M47 44v4"/>',
  runtime: '<path d="M22 23h20l4 8-14 12-14-12 4-8Z"/><path d="M22 23l10 8 10-8M32 31v12"/><circle cx="22" cy="44" r="3"/><circle cx="42" cy="44" r="3"/><path d="M25 44h14"/>',
  human: '<circle cx="32" cy="24" r="7"/><path d="M19 45c3-8 8-12 13-12s10 4 13 12"/><path d="M20 24h-4M48 24h-4M18 34l-3 3M46 34l3 3"/>',
  qagent: '<circle cx="30" cy="30" r="12"/><path d="M38 38l7 7M25 29l4 4 9-10"/><path d="M18 18l4 4M42 18l-4 4"/>',
  commerce: '<path d="M20 26h25l-3 16H23l-3-16Z"/><path d="M25 26c1-6 4-9 8-9s7 3 8 9"/><circle cx="27" cy="46" r="2"/><circle cx="39" cy="46" r="2"/>',
  analytics: '<path d="M19 44h27M23 44V34M32 44V26M41 44V30"/><path d="M21 30l9-7 7 5 8-10"/><circle cx="30" cy="23" r="2"/><circle cx="37" cy="28" r="2"/><circle cx="45" cy="18" r="2"/>',
  orchestrator: '<path d="M32 18l10 6v11l-10 6-10-6V24l10-6Z"/><path d="M32 18v8M22 24l10 8 10-8M32 32v9"/><path d="M22 35l-7 6M42 35l7 6M22 24l-7-5M42 24l7-5"/><circle cx="15" cy="19" r="3"/><circle cx="49" cy="19" r="3"/><circle cx="15" cy="41" r="3"/><circle cx="49" cy="41" r="3"/><circle cx="32" cy="32" r="3.5"/>',
  agent: '<path d="M22 24l10-6 10 6v12l-10 6-10-6V24Z"/><path d="M22 24l10 6 10-6M32 30v12"/><circle cx="22" cy="44" r="3"/><circle cx="42" cy="44" r="3"/><circle cx="32" cy="48" r="3"/><path d="M24 43l6-4M40 43l-6-4M32 45v-4"/>'
});

export function agentGlyphMarkup(kind = "agent") {
  return GLYPHS[kind] || GLYPHS.agent;
}

function escapeXml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}

export function agentAvatarSvgMarkup(visual = {}) {
  const avatar = agentVisualFromId(visual.id || "project-execution-agent", visual);
  const kind = agentIconKind(avatar);
  const dash = kind === "qagent" ? "1 5" : kind === "orchestrator" ? "7 4" : kind === "reviewer" ? "3 2" : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <defs><radialGradient id="core" cx="50%" cy="48%" r="58%"><stop stop-color="${avatar.accent}" stop-opacity=".42"/><stop offset=".55" stop-color="${avatar.color}" stop-opacity=".3"/><stop offset="1" stop-color="#050b18"/></radialGradient><linearGradient id="ring" x1="12" x2="52" y1="8" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="${avatar.accent}"/><stop offset="1" stop-color="${avatar.color}"/></linearGradient></defs>
    <rect x="3.5" y="3.5" width="57" height="57" rx="18" fill="#06101f" stroke="${avatar.accent}" stroke-opacity=".45" stroke-width="1.5"/>
    <circle cx="32" cy="32" r="24" fill="url(#core)"/><circle cx="32" cy="32" r="25" fill="none" stroke="${avatar.accent}" stroke-width="${kind === "qagent" ? 3.4 : kind === "orchestrator" ? 3.2 : 2.5}" stroke-dasharray="${dash}"/>
    <circle cx="32" cy="32" r="18" fill="none" stroke="${avatar.accent}" stroke-opacity=".62" stroke-dasharray="2 5"/><path d="M16 32h9M39 32h9M32 16v9M32 39v9" fill="none" stroke="${avatar.accent}" stroke-opacity=".8" stroke-width="1.5"/>
    <g fill="${avatar.accent}">${[[16,32],[48,32],[32,16],[32,48]].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="2.1"/>`).join("")}</g><circle cx="32" cy="32" r="16" fill="#020617" fill-opacity=".42" stroke="url(#ring)" stroke-width="${kind === "qagent" ? 3 : 1.7}"/>
    <g fill="none" stroke="${avatar.accent}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${agentGlyphMarkup(kind)}</g>
    <text x="49" y="53" text-anchor="middle" fill="#fff" stroke="#06101f" stroke-width="2.5" paint-order="stroke fill" font-family="system-ui,sans-serif" font-size="8" font-weight="900">${escapeXml(String(avatar.initials || "AG").slice(0, 2))}</text>
  </svg>`;
}

export function agentAvatarDataUrl(visual = {}) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(agentAvatarSvgMarkup(visual))}`;
}
