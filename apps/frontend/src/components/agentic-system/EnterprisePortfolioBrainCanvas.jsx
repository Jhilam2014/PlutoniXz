import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as d3 from "d3";
import {
  buildPortfolioIntelligenceMap,
  portfolioAppVisualState,
  portfolioIntelligenceCanvasDimensions,
  resolvePortfolioAppIconUrl,
  seedPortfolioIntelligenceLayout
} from "./enterprisePortfolioBrainModel.js";
import "./enterprisePortfolioBrainCanvas.css";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function dateLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function readable(value) {
  return String(value || "").replaceAll("_", " ").replaceAll("-", " ");
}

function labelLines(value, maximum = 15, maximumLines = 2) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return ["Unnamed"];
  const lines = [];
  let current = "";
  for (const rawWord of words) {
    const word = rawWord.length > maximum ? `${rawWord.slice(0, Math.max(1, maximum - 1))}…` : rawWord;
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maximum) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  if (lines.length <= maximumLines) return lines;
  return [...lines.slice(0, maximumLines - 1), `${lines[maximumLines - 1].slice(0, Math.max(1, maximum - 1))}…`];
}

function LabelText({ className, lines, x = 0, y = 0, lineHeight = 12, textAnchor = "start" }) {
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  return (
    <text className={className} textAnchor={textAnchor} x={x} y={startY}>
      {lines.map((line, index) => <tspan key={`${line}:${index}`} x={x} dy={index ? lineHeight : 0}>{line}</tspan>)}
    </text>
  );
}

const APP_ICON_TONES = ["#3b82f6", "#8b5cf6", "#0f9f84", "#d97706", "#db2777", "#0891b2", "#7c3aed", "#4f8f43"];

function iconUrlFor(node = {}) {
  return node.appIcon?.resolvedUrl || resolvePortfolioAppIconUrl(node.application || node);
}

function applicationIdentity(node = {}) {
  const application = node.application || node || {};
  const name = String(application.name || node.label || application.id || "Application").replace(/\s+/g, " ").trim();
  const words = name.split(" ").filter(Boolean);
  const initials = words.length > 1
    ? `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase()
    : String(words[0] || "A").slice(0, 2).toUpperCase();
  const seed = String(application.id || node.id || name);
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = ((hash * 31) + seed.charCodeAt(index)) >>> 0;
  return { initials: initials || "A", tone: APP_ICON_TONES[hash % APP_ICON_TONES.length] };
}

function ApplicationIcon({ node, failedIconUrls, onIconError }) {
  const iconUrl = iconUrlFor(node);
  if (iconUrl && !failedIconUrls.has(iconUrl)) {
    return <image
      className="portfolio-brain-application-image"
      href={iconUrl}
      x="-29"
      y="-29"
      width="58"
      height="58"
      preserveAspectRatio="xMidYMid meet"
      clipPath="url(#portfolio-brain-app-icon-clip)"
      onError={() => onIconError(iconUrl)}
      aria-hidden="true"
    />;
  }
  const identity = applicationIdentity(node);
  return <g className="portfolio-brain-application-monogram" style={{ "--portfolio-brain-app-icon-tone": identity.tone }} aria-hidden="true">
    <rect x="-29" y="-29" width="58" height="58" rx="13" />
    <text textAnchor="middle" y="5">{identity.initials}</text>
  </g>;
}

function PortfolioPreviewAppIcon({ node, failedIconUrls, onIconError }) {
  const iconUrl = iconUrlFor(node);
  const identity = applicationIdentity(node);
  return <span className={`portfolio-brain-preview-app-icon ${node.isPrivate ? "is-unassigned" : ""}`} style={{ "--portfolio-brain-app-icon-tone": identity.tone }}>
    {iconUrl && !failedIconUrls.has(iconUrl)
      ? <img src={iconUrl} alt="" onError={() => onIconError(iconUrl)} />
      : <span aria-hidden="true">{identity.initials}</span>}
  </span>;
}

function linkTone(link = {}) {
  if (link.kind === "causal-dependency") return "causal";
  if (link.kind === "authorized-information-sharing") return "sharing";
  return "scope";
}

/**
 * Use the model's single deterministic layout seed in production. Every
 * enterprise group receives a deterministic perimeter sector, which keeps
 * dense portfolios readable without a force layout inventing relationships.
 */
function layoutPortfolioBrain(model = {}) {
  const { width, height } = portfolioIntelligenceCanvasDimensions(model);
  const positioned = seedPortfolioIntelligenceLayout(model, width, height).map((node) => ({
    ...node,
    radius: node.kind === "enterprise-brain" ? 66 : node.kind === "enterprise-scope" ? 50 : 46
  }));
  const root = positioned.find((node) => node.kind === "enterprise-brain") || null;
  return {
    width,
    height,
    center: root ? { x: root.x, y: root.y } : { x: width / 2, y: height / 2 },
    nodes: positioned,
    nodeById: new Map(positioned.map((node) => [node.id, node]))
  };
}

function linkPath(link, layout, index) {
  const source = layout.nodeById.get(link.source);
  const target = layout.nodeById.get(link.target);
  if (!source || !target) return "";
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const unit = { x: deltaX / distance, y: deltaY / distance };
  const from = { x: source.x + unit.x * source.radius, y: source.y + unit.y * source.radius };
  const to = { x: target.x - unit.x * target.radius, y: target.y - unit.y * target.radius };
  const normal = { x: -unit.y, y: unit.x };
  const bend = link.kind === "enterprise-scope" ? 0 : link.kind === "application-scope" ? 16 : 28 + (index % 3) * 11;
  const direction = index % 2 ? -1 : 1;
  return `M${from.x},${from.y} Q${(from.x + to.x) / 2 + normal.x * bend * direction},${(from.y + to.y) / 2 + normal.y * bend * direction} ${to.x},${to.y}`;
}

function nodeKeyDown(event, callback) {
  if (!event || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  callback();
}

function selectedDetail({ selectedNode, selectedLink, model, layout, portfolioSummary }) {
  if (selectedLink) {
    const source = layout.nodeById.get(selectedLink.source);
    const target = layout.nodeById.get(selectedLink.target);
    const relationKind = selectedLink.kind === "causal-dependency" ? "Causal dependency" : "Authorized information sharing";
    return {
      eyebrow: relationKind,
      title: `${source?.label || selectedLink.source} → ${target?.label || selectedLink.target}`,
      summary: selectedLink.description || selectedLink.label || "Explicit portfolio relationship.",
      fields: [
        { label: "Relationship", value: selectedLink.label || readable(selectedLink.type) || relationKind },
        { label: "Recorded at", value: dateLabel(selectedLink.recordedAt) },
        { label: "Evidence", value: selectedLink.kind === "causal-dependency" ? `${selectedLink.evidenceCount || 0} reference(s)` : "Not a causal assertion" },
        { label: "Agreement", value: selectedLink.kind === "authorized-information-sharing" ? `${selectedLink.agreementCount || 0} approved agreement(s)` : "Not applicable" }
      ],
      action: null,
      warning: selectedLink.kind === "authorized-information-sharing" ? "Authorized sharing is agreement-gated and is not a runtime dependency." : "This connector represents only explicit causal evidence from the portfolio record."
    };
  }
  if (!selectedNode) {
    return {
      eyebrow: "Portfolio intelligence canvas",
      title: "Enterprise and application decision boundaries",
      summary: "Select the Enterprise Brain, an enterprise scope, an App BrainX, or a cross-application relationship to inspect the record behind it.",
      fields: [],
      action: null,
      warning: "Scope links never authorize cross-application information sharing."
    };
  }
  if (selectedNode.kind === "enterprise-brain") {
    return {
      eyebrow: "Enterprise governance",
      title: selectedNode.label,
      summary: selectedNode.summary || selectedNode.detail || "Enterprise knowledge is governed through explicit publication and sharing controls.",
      fields: [
        { label: "Publication", value: selectedNode.recorded ? "Governed publication record available" : "No governed publication record" },
        { label: "Enterprise scopes", value: String(model.summary?.enterpriseScopeCount || 0) },
        { label: "App BrainX nodes", value: String(model.summary?.applicationCount || 0) },
        { label: "Sharing policy", value: readable(portfolioSummary?.agreementStatus || "not reported") }
      ],
      action: null,
      warning: "This is a governance boundary, not a runtime execution record or a grant to read application-private decisions."
    };
  }
  if (selectedNode.kind === "enterprise-scope") {
    const members = asArray(model.links).filter((link) => link.kind === "application-scope" && link.source === selectedNode.id);
    return {
      eyebrow: "Enterprise scope",
      title: selectedNode.label,
      summary: selectedNode.summary || "Applications are grouped only by their explicit enterprise assignment.",
      fields: [
        { label: "Enterprise ID", value: selectedNode.enterprise?.id || "Not recorded" },
        { label: "App BrainX members", value: String(members.length) },
        { label: "Scope", value: "Governance only" }
      ],
      action: null,
      warning: "Membership alone does not create a dependency or authorize information sharing."
    };
  }
  const application = selectedNode.application || {};
  return {
    eyebrow: selectedNode.isPrivate ? "Private application BrainX" : "Application BrainX",
    title: selectedNode.label,
    summary: selectedNode.summary || application.summary || "Application-specific evidence and decisions remain scoped to this application.",
    fields: [
      { label: "BrainX scope", value: readable(selectedNode.brainX?.scope || application.brainX?.scope || "application private") },
      { label: "Publication", value: selectedNode.brainRecorded ? "Application publication record available" : "No application publication record" },
      { label: "Decision posture", value: Number.isFinite(Number(selectedNode.attentionCount)) ? `${selectedNode.attentionCount} recorded review need(s)` : "Not reported" },
      { label: "Observed topology", value: `${selectedNode.counts?.features ?? "—"} features · ${selectedNode.counts?.apis ?? "—"} APIs · ${selectedNode.counts?.dataStores ?? "—"} data stores` },
      { label: "Origin", value: selectedNode.provenance?.source || selectedNode.provenance?.origin || "Not recorded" }
    ],
    action: application.project || selectedNode.project || null,
    warning: selectedNode.isPrivate ? "This application has no explicit enterprise assignment; it remains separate from enterprise scope links." : "Open the application decision view to inspect its actual source and ledger decision records."
  };
}

export default function EnterprisePortfolioBrainCanvas({ applications = [], relations = [], hierarchy = {}, portfolioSummary = {}, onOpenApplication }) {
  const svgRef = useRef(null);
  const layerRef = useRef(null);
  const zoomRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef("");
  const previewButtonRef = useRef(null);
  const collapseButtonRef = useRef(null);
  const wasExpandedRef = useRef(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selected, setSelected] = useState({ kind: "", id: "" });
  const [nodeOffsets, setNodeOffsets] = useState({});
  const [draggingNodeId, setDraggingNodeId] = useState("");
  const [failedIconUrls, setFailedIconUrls] = useState(() => new Set());
  const model = useMemo(
    () => buildPortfolioIntelligenceMap({ applications, relations, hierarchy, portfolioSummary }),
    [applications, hierarchy, portfolioSummary, relations]
  );
  const previewApplications = useMemo(
    () => asArray(model.nodes).filter((node) => node.kind === "application-brain").slice(0, 8),
    [model.nodes]
  );
  const layout = useMemo(() => layoutPortfolioBrain(model), [model]);
  const effectiveLayout = useMemo(() => {
    const nodes = layout.nodes.map((node) => {
      const offset = nodeOffsets[node.id] || {};
      return { ...node, x: node.x + (Number(offset.x) || 0), y: node.y + (Number(offset.y) || 0) };
    });
    return { ...layout, nodes, nodeById: new Map(nodes.map((node) => [node.id, node])) };
  }, [layout, nodeOffsets]);
  const selectedNode = selected.kind === "node" ? effectiveLayout.nodeById.get(selected.id) || null : null;
  const selectedLink = selected.kind === "link" ? asArray(model.links).find((link) => link.id === selected.id) || null : null;
  const detail = selectedDetail({ selectedNode, selectedLink, model, layout: effectiveLayout, portfolioSummary });
  const relatedNodeIds = useMemo(() => {
    if (!selectedNode && !selectedLink) return new Set();
    if (selectedLink) return new Set([selectedLink.source, selectedLink.target]);
    const ids = new Set([selectedNode.id]);
    for (const link of asArray(model.links)) {
      if (link.source === selectedNode.id || link.target === selectedNode.id) {
        ids.add(link.source);
        ids.add(link.target);
      }
    }
    return ids;
  }, [model.links, selectedLink, selectedNode]);

  useEffect(() => {
    if (selected.kind === "node" && !effectiveLayout.nodeById.has(selected.id)) setSelected({ kind: "", id: "" });
    if (selected.kind === "link" && !asArray(model.links).some((link) => link.id === selected.id)) setSelected({ kind: "", id: "" });
  }, [effectiveLayout, model.links, selected]);

  useEffect(() => {
    const validIds = new Set(layout.nodes.map((node) => node.id));
    setNodeOffsets((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => validIds.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [layout]);

  useEffect(() => {
    if (!isExpanded) {
      if (wasExpandedRef.current) previewButtonRef.current?.focus();
      wasExpandedRef.current = false;
      return undefined;
    }
    wasExpandedRef.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => collapseButtonRef.current?.focus());
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        dragRef.current = null;
        setDraggingNodeId("");
        setIsExpanded(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [isExpanded]);

  useEffect(() => {
    const svgElement = svgRef.current;
    const layer = layerRef.current;
    // The compact portfolio card deliberately does not mount D3 listeners.
    // Expand only on intent so the default portfolio view remains lightweight.
    if (!isExpanded || !svgElement || !layer) return undefined;
    const svg = d3.select(svgElement);
    const root = d3.select(layer);
    const zoom = d3.zoom()
      .scaleExtent([0.48, 2.4])
      .filter((event) => event.type === "wheel" || !event.target?.closest?.("[data-portfolio-brain-interactive]"))
      .on("zoom", (event) => root.attr("transform", event.transform));
    zoomRef.current = zoom;
    svg.call(zoom).call(zoom.transform, d3.zoomIdentity);
    return () => {
      svg.on(".zoom", null);
      if (zoomRef.current === zoom) zoomRef.current = null;
    };
  }, [isExpanded, layout.height, layout.width]);

  const resetView = () => {
    if (svgRef.current && zoomRef.current) d3.select(svgRef.current).call(zoomRef.current.transform, d3.zoomIdentity);
  };
  const resetCanvas = () => {
    dragRef.current = null;
    setDraggingNodeId("");
    setNodeOffsets({});
    resetView();
  };
  const expandCanvas = () => setIsExpanded(true);
  const collapseCanvas = () => {
    dragRef.current = null;
    setDraggingNodeId("");
    setIsExpanded(false);
  };
  const trapPopupFocus = (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")]
      .filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const pointerPosition = (event) => {
    const svg = svgRef.current;
    const layer = layerRef.current;
    const matrix = layer?.getScreenCTM?.();
    if (!svg?.createSVGPoint || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  };
  const nodePadding = (node) => {
    if (node.kind === "enterprise-brain") return { x: 124, y: 128 };
    if (node.kind === "enterprise-scope") return { x: 108, y: 52 };
    return { x: 50, y: 66 };
  };
  const startNodeDrag = (event, node) => {
    if (event.button !== 0) return;
    const point = pointerPosition(event);
    if (!point) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      nodeId: node.id,
      pointerId: event.pointerId,
      origin: { x: node.x, y: node.y },
      start: point,
      moved: false
    };
    setDraggingNodeId(node.id);
  };
  const moveNodeDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointerPosition(event);
    const baseNode = layout.nodeById.get(drag.nodeId);
    if (!point || !baseNode) return;
    event.preventDefault();
    const deltaX = point.x - drag.start.x;
    const deltaY = point.y - drag.start.y;
    if (Math.hypot(deltaX, deltaY) > 3) drag.moved = true;
    const padding = nodePadding(baseNode);
    const nextX = Math.max(padding.x, Math.min(layout.width - padding.x, drag.origin.x + deltaX));
    const nextY = Math.max(padding.y, Math.min(layout.height - padding.y, drag.origin.y + deltaY));
    setNodeOffsets((current) => ({ ...current, [drag.nodeId]: { x: nextX - baseNode.x, y: nextY - baseNode.y } }));
  };
  const stopNodeDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || (event?.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
    if (drag.moved) {
      suppressClickRef.current = drag.nodeId;
      window.setTimeout(() => {
        if (suppressClickRef.current === drag.nodeId) suppressClickRef.current = "";
      }, 0);
    }
    dragRef.current = null;
    setDraggingNodeId("");
  };
  const selectNode = (node) => {
    if (suppressClickRef.current === node.id) {
      suppressClickRef.current = "";
      return;
    }
    setSelected({ kind: "node", id: node.id });
  };
  const markIconFailed = (url) => setFailedIconUrls((current) => current.has(url) ? current : new Set([...current, url]));
  const nodeMuted = (node) => Boolean((selectedNode || selectedLink) && !relatedNodeIds.has(node.id));
  const linkMuted = (link) => {
    if (!selectedNode && !selectedLink) return false;
    if (selectedLink) return selectedLink.id !== link.id;
    return link.source !== selectedNode.id && link.target !== selectedNode.id;
  };

  return <>
    <section className="portfolio-brain-canvas is-preview" aria-labelledby="portfolio-brain-canvas-heading">
      <header className="portfolio-brain-canvas-header">
        <div>
          <span>Portfolio intelligence canvas</span>
          <h3 id="portfolio-brain-canvas-heading">Enterprise Brain → application BrainX</h3>
          <p>A compact portfolio snapshot. Open the popup canvas to explore application boundaries and only the relationships that are explicitly recorded.</p>
        </div>
        <div className="portfolio-brain-canvas-summary" aria-label="Portfolio canvas summary">
          <span><b>{model.summary?.enterpriseScopeCount || 0}</b> enterprise scopes</span>
          <span><b>{model.summary?.applicationCount || 0}</b> App BrainX</span>
          <span><b>{model.summary?.causalDependencyCount || 0}</b> causal links</span>
          <span><b>{model.summary?.authorizedInformationSharingCount || 0}</b> approved sharing</span>
        </div>
      </header>
      <button
        ref={previewButtonRef}
        type="button"
        className="portfolio-brain-canvas-preview"
        onClick={expandCanvas}
        aria-controls="portfolio-brain-interactive-canvas"
        aria-expanded={isExpanded}
        aria-haspopup="dialog"
        aria-label={`Open the portfolio intelligence popup with ${model.summary?.applicationCount || 0} application nodes`}
      >
        <span className="portfolio-brain-preview-art" aria-hidden="true">
          <span className="portfolio-brain-preview-root">BrainX</span>
          <span className="portfolio-brain-preview-connector" />
          <span className="portfolio-brain-preview-app-grid">
            {previewApplications.map((node) => <span className={`portfolio-brain-preview-app is-${portfolioAppVisualState(node)}`} key={node.id}>
              <PortfolioPreviewAppIcon node={node} failedIconUrls={failedIconUrls} onIconError={markIconFailed} />
            </span>)}
            {!previewApplications.length ? <span className="portfolio-brain-preview-empty-node">No applications recorded</span> : null}
          </span>
        </span>
        <span className="portfolio-brain-preview-copy">
          <strong>Open interactive portfolio map</strong>
          <small>View exact application icons on enterprise-centered perimeters, scope links, and recorded relationships.</small>
        </span>
        <span className="portfolio-brain-preview-action" aria-hidden="true">Open popup →</span>
      </button>
    </section>
    {isExpanded && typeof document !== "undefined" ? createPortal(
      <div className="portfolio-brain-detail-backdrop" onMouseDown={collapseCanvas} role="presentation">
        <section
          className="portfolio-brain-detail-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="portfolio-brain-detail-heading"
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={trapPopupFocus}
        >
          <header className="portfolio-brain-detail-header">
            <div>
              <span>Portfolio intelligence canvas · detail</span>
              <h3 id="portfolio-brain-detail-heading">Enterprise Brain → application BrainX</h3>
              <p>Applications follow enterprise-centered perimeters. The farther outer perimeter contains unassigned applications, identified by a top-right corner mark.</p>
            </div>
            <div className="portfolio-brain-detail-actions">
              <button type="button" onClick={resetView}>Reset zoom</button>
              <button type="button" onClick={resetCanvas}>Reset layout</button>
              <button ref={collapseButtonRef} type="button" onClick={collapseCanvas} aria-controls="portfolio-brain-interactive-canvas" aria-expanded="true">Close</button>
            </div>
          </header>
          <div className="portfolio-brain-detail-body">
      <div id="portfolio-brain-interactive-canvas" className="portfolio-brain-canvas-viewport" role="region" aria-label="Interactive portfolio intelligence canvas">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ "--portfolio-brain-map-width": `${layout.width}px`, "--portfolio-brain-map-height": `${layout.height}px` }}
          preserveAspectRatio="xMidYMid meet"
          aria-label="PlutoniX Enterprise Brain and application BrainX portfolio intelligence canvas"
          onPointerMove={moveNodeDrag}
          onPointerUp={stopNodeDrag}
          onPointerCancel={stopNodeDrag}
        >
          <defs>
            <filter id="portfolio-brain-glow" x="-90%" y="-90%" width="280%" height="280%">
              <feGaussianBlur stdDeviation="9" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id="portfolio-brain-core-fill" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0b2447" />
              <stop offset="55%" stopColor="#19376d" />
              <stop offset="100%" stopColor="#753fd9" />
            </linearGradient>
            <marker id="portfolio-brain-causal-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
            <marker id="portfolio-brain-sharing-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
            <clipPath id="portfolio-brain-app-icon-clip"><rect x="-29" y="-29" width="58" height="58" rx="13" /></clipPath>
          </defs>
          <g ref={layerRef} className="portfolio-brain-canvas-layer">
            <ellipse className="portfolio-brain-canvas-aura" cx={layout.center.x} cy={layout.center.y} rx="164" ry="132" />
            <g className="portfolio-brain-links">
              {asArray(model.links).map((link, index) => (
                <path
                  key={link.id}
                  data-portfolio-brain-interactive={link.kind === "causal-dependency" || link.kind === "authorized-information-sharing" ? "true" : undefined}
                  className={`portfolio-brain-link is-${linkTone(link)} ${selectedLink?.id === link.id ? "is-selected" : ""} ${linkMuted(link) ? "is-muted" : ""}`.trim()}
                  d={linkPath(link, effectiveLayout, index)}
                  markerEnd={link.kind === "causal-dependency" ? "url(#portfolio-brain-causal-arrow)" : link.kind === "authorized-information-sharing" ? "url(#portfolio-brain-sharing-arrow)" : undefined}
                  onClick={() => (link.kind === "causal-dependency" || link.kind === "authorized-information-sharing") && setSelected({ kind: "link", id: link.id })}
                  onKeyDown={(event) => nodeKeyDown(event, () => setSelected({ kind: "link", id: link.id }))}
                  tabIndex={link.kind === "causal-dependency" || link.kind === "authorized-information-sharing" ? 0 : undefined}
                  role={link.kind === "causal-dependency" || link.kind === "authorized-information-sharing" ? "button" : undefined}
                  aria-label={link.kind === "causal-dependency" || link.kind === "authorized-information-sharing" ? `${readable(link.kind)}: ${link.label || link.type || link.id}` : undefined}
                />
              ))}
            </g>
            {effectiveLayout.nodes.filter((node) => node.kind === "enterprise-brain").map((node) => (
              <g
                key={node.id}
                data-portfolio-brain-interactive="true"
                className={`portfolio-brain-main ${selectedNode?.id === node.id ? "is-selected" : ""} ${nodeMuted(node) ? "is-muted" : ""} ${draggingNodeId === node.id ? "is-dragging" : ""}`.trim()}
                transform={`translate(${node.x},${node.y})`}
                onPointerDown={(event) => startNodeDrag(event, node)}
                onClick={() => selectNode(node)}
                onKeyDown={(event) => nodeKeyDown(event, () => selectNode(node))}
                tabIndex="0"
                role="button"
                aria-label={`${node.label}, enterprise governance. Drag to reposition.`}
              >
                <title>{node.label}</title>
                <circle className="portfolio-brain-orbit outer" r="114" />
                <circle className="portfolio-brain-orbit inner" r="92" />
                <circle className="portfolio-brain-main-glow" r="70" filter="url(#portfolio-brain-glow)" />
                <circle className="portfolio-brain-main-core" r="66" fill="url(#portfolio-brain-core-fill)" />
                <path className="portfolio-brain-main-mark" d="M-19,3 L-7,3 L-2,-17 L7,21 L13,3 L23,3" />
                <LabelText className="portfolio-brain-main-label" lines={labelLines(node.label, 23)} textAnchor="middle" y="96" lineHeight={13} />
                <text className="portfolio-brain-main-detail" textAnchor="middle" y="124">Enterprise governance boundary</text>
              </g>
            ))}
            {effectiveLayout.nodes.filter((node) => node.kind === "enterprise-scope").map((node) => (
              <g
                key={node.id}
                data-portfolio-brain-interactive="true"
                className={`portfolio-brain-enterprise-node ${selectedNode?.id === node.id ? "is-selected" : ""} ${nodeMuted(node) ? "is-muted" : ""} ${draggingNodeId === node.id ? "is-dragging" : ""}`.trim()}
                transform={`translate(${node.x},${node.y})`}
                onPointerDown={(event) => startNodeDrag(event, node)}
                onClick={() => selectNode(node)}
                onKeyDown={(event) => nodeKeyDown(event, () => selectNode(node))}
                tabIndex="0"
                role="button"
                aria-label={`${node.label}, enterprise scope. Drag to reposition.`}
              >
                <title>{node.label}</title>
                <rect x="-102" y="-37" width="204" height="74" rx="14" />
                <circle cx="-74" cy="0" r="12" />
                <path className="portfolio-brain-enterprise-glyph" d="M-80,4 L-74,-8 L-68,4 L-74,9 Z" />
                <LabelText className="portfolio-brain-enterprise-label" lines={labelLines(node.label, 17)} x={-52} y={-4} lineHeight={11} />
                <text className="portfolio-brain-enterprise-detail" x="-52" y="21">Explicit enterprise scope</text>
              </g>
            ))}
            {effectiveLayout.nodes.filter((node) => node.kind === "application-brain").map((node) => (
              <g
                key={node.id}
                data-portfolio-brain-interactive="true"
                className={`portfolio-brain-application-node is-${portfolioAppVisualState(node)} ${selectedNode?.id === node.id ? "is-selected" : ""} ${nodeMuted(node) ? "is-muted" : ""} ${draggingNodeId === node.id ? "is-dragging" : ""}`.trim()}
                transform={`translate(${node.x},${node.y})`}
                onPointerDown={(event) => startNodeDrag(event, node)}
                onClick={() => selectNode(node)}
                onKeyDown={(event) => nodeKeyDown(event, () => selectNode(node))}
                onDoubleClick={() => onOpenApplication?.(node.application?.project || node.project)}
                tabIndex="0"
                role="button"
                aria-label={`${node.application?.name || node.label}, ${node.isPrivate ? "private application BrainX" : "application BrainX"}. Drag to reposition.`}
              >
                <title>{node.application?.name || node.label}</title>
                <circle className="portfolio-brain-application-aura" r="48" />
                <rect className="portfolio-brain-application-core" x="-34" y="-34" width="68" height="68" rx="18" />
                <ApplicationIcon node={node} failedIconUrls={failedIconUrls} onIconError={markIconFailed} />
                {node.isPrivate ? <g className="portfolio-brain-unassigned-corner" aria-hidden="true">
                  <path d="M18,-39 H40 V-17 Z" />
                  <path className="portfolio-brain-unassigned-corner-mark" d="M28,-32 L34,-26 M34,-32 L28,-26" />
                </g> : null}
                {Number(node.attentionCount) > 0 ? <><circle className="portfolio-brain-application-attention-badge" cx="-31" cy="-31" r="11" /><text className="portfolio-brain-application-attention" textAnchor="middle" x="-31" y="-27">{node.attentionCount}</text></> : null}
                <LabelText className="portfolio-brain-application-label" lines={labelLines(node.application?.name || node.label, 13)} textAnchor="middle" y="53" lineHeight={11} />
              </g>
            ))}
          </g>
        </svg>
        <small>Drag a node to reposition it · drag the background to pan · scroll to zoom · select a node or relationship for evidence and scope details</small>
      </div>
      <aside className="portfolio-brain-insight" aria-live="polite">
        <header><span>{detail.eyebrow}</span><strong>{detail.title}</strong></header>
        <p>{detail.summary}</p>
        {detail.fields.length ? <dl>{detail.fields.map((field) => <div key={`${field.label}:${field.value}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl> : null}
        {detail.warning ? <small>{detail.warning}</small> : null}
        {detail.action ? <button type="button" onClick={() => onOpenApplication?.(detail.action)}>Open application decisions</button> : null}
      </aside>
          </div>
      <footer className="portfolio-brain-legend">
        <span className="scope" /> Governance scope only
        <span className="causal" /> Explicit causal dependency
        <span className="sharing" /> Authorized information sharing
        <i className="review" /> Recorded review need
        <i className="recorded" /> Recorded publication
        <i className="scoped" /> Enterprise-scoped app
        <i className="private" /> Unassigned app · top-right corner mark
      </footer>
        </section>
      </div>,
      document.body
    ) : null}
  </>;
}
