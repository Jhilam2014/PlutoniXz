import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as d3 from "d3";
import { authFetch } from "../../authClient.js";
import { agentAvatarDataUrl, agentVisualFromId, agentVisualFromRecord } from "../../agentAvatarVisual.js";
import {
  buildApplicationDecisionMap,
  buildApplicationDeliveryTimeline,
  buildDeliveryChronologyLinks,
  buildDeliveryGraphView,
  decisionOptionPresentation
} from "./applicationDecisionMapModel.js";
import { resolvePortfolioAppIconUrl } from "./enterprisePortfolioBrainModel.js";
import "./applicationDecisionMappingCanvas.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";
const COLORS = {
  decision: "#4f46e5",
  recorded: "#0f766e",
  unsequenced: "#64748b",
  agent: "#4f46e5",
  assignment: "#4f46e5",
  service: "#d97706",
  deferred: "#d97706",
  rejected: "#dc2626",
  anticipated: "#4f46e5",
  anticipated_rejected: "#9f1239",
  functionalityDependency: "#64748b",
  ink: "#11233e",
  muted: "#62748b",
  paper: "#ffffff"
};
const EMPTY_INSTRUCTION_TIMELINE = Object.freeze([]);
const WORLD_MIN_WIDTH = 1180;
const WORLD_MIN_HEIGHT = 680;
const CLUSTER_GAP = 72;
const CLUSTER_PADDING = 34;
const EVENT_WIDTH = 220;
const EVENT_HEIGHT = 78;
const FUNCTIONALITY_WIDTH = 220;
const FUNCTIONALITY_HEIGHT = 72;
const FUNCTIONALITY_CELL_WIDTH = 278;
const OPTION_SIZE = 62;
const OPTION_GAP = 12;
const AGENT_SIZE = 84;
const SERVICE_WIDTH = 238;
const SERVICE_HEIGHT = 52;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function truncate(value, max = 28) {
  const label = String(value || "");
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function roundedRect(context, x, y, width, height, radius = 12) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function eventColor(timeline = {}) {
  if (timeline.mode === "recorded_build" || timeline.mode === "recorded_scope") return COLORS.recorded;
  if (timeline.historicalClaim) return COLORS.unsequenced;
  return COLORS.decision;
}

function buildEventColor(event = {}) {
  return event.mode === "unsequenced" ? COLORS.unsequenced : COLORS.recorded;
}

function eventTimeLabel(timeline = {}) {
  if (timeline.occurredAt) {
    const value = new Date(timeline.occurredAt);
    if (!Number.isNaN(value.getTime())) return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value);
  }
  if (timeline.sourceOrder !== null && timeline.sourceOrder !== undefined) return `Source plan · step ${timeline.sourceOrder}`;
  return "No sequence evidence";
}

function optionPresentation(option = {}) {
  return option.presentation || decisionOptionPresentation(option);
}

function optionColor(option = {}) {
  return COLORS[optionPresentation(option).tone] || COLORS.decision;
}

function agentColor(agent = {}) {
  return agent?.status === "blocked" || agent?.status === "failed" ? "#dc2626" : COLORS.agent;
}

function agentRelationshipLabel(agent = {}) {
  return agent.associationBasis === "analysis_assignment" ? "Analysis assignment" : "Recorded implementation link";
}

function deliveryAgentVisual(agent = {}, globalAgentRecords = []) {
  const candidateIds = new Set([
    agent.agentId,
    agent.sourceAgentId,
    agent.id,
    String(agent.id || "").replace(/^agent:/, "")
  ].map((value) => String(value || "").trim()).filter(Boolean));
  const memoryRecord = globalAgentRecords.find((record) => [record.id, record.agentId]
    .map((value) => String(value || "").trim())
    .some((value) => candidateIds.has(value)));
  if (memoryRecord) return agentVisualFromRecord(memoryRecord);
  const agentId = agent.agentId || agent.sourceAgentId || String(agent.id || "").replace(/^agent:/, "") || "project-execution-agent";
  return agentVisualFromId(agentId, {
    name: agent.label || agent.name,
    role: agent.agentType || agent.role,
    domain: agent.agentCategory || agent.category,
    objective: agent.responsibility || agent.description,
    capabilities: agent.capabilities
  });
}

function eventOrder(left = {}, right = {}) {
  const leftIndex = Number.isFinite(left.buildIndex) ? left.buildIndex : Number.MAX_SAFE_INTEGER;
  const rightIndex = Number.isFinite(right.buildIndex) ? right.buildIndex : Number.MAX_SAFE_INTEGER;
  return leftIndex - rightIndex || String(left.occurredAt || "").localeCompare(String(right.occurredAt || "")) || String(left.buildId || left.id).localeCompare(String(right.buildId || right.id));
}

function addUniqueLink(links, link) {
  if (!links.some((candidate) => candidate.id === link.id)) links.push(link);
}

/**
 * The model stays source/provenance focused; this projection gives its explicit
 * events and relationships stable graph positions. No link here is inferred
 * from text labels; source-plan chronology is rendered only as a direct,
 * ordered segue between functionality nodes.
 */
function buildDeliveryGraphLayout({ map = {}, deliveryTimeline = {} } = {}) {
  const rows = asArray(deliveryTimeline.rows);
  const events = [...asArray(deliveryTimeline.eventNodes)].sort(eventOrder);
  const groupsById = new Map(events.map((event) => [event.id, { id: event.id, event, rows: [], historicalClaim: true }]));
  const groups = events.map((event) => groupsById.get(event.id));
  const plannedGroup = { id: `delivery-anticipated-zone:${map.projectId || "current"}`, event: null, rows: [], historicalClaim: false };

  for (const row of rows) {
    const group = groupsById.get(row.timeline?.buildEventId) || plannedGroup;
    group.rows.push(row);
  }
  if (plannedGroup.rows.length) groups.push(plannedGroup);

  const nodeById = new Map();
  const functionalityById = new Map();
  const optionById = new Map();
  // Each completed build owns an organic cluster. Anticipated functionalities
  // share layout territory without gaining a synthetic plan node. Chronology
  // determines cluster order, not a permanent semantic column for every node
  // kind. Functions and outcomes sit around their build
  // event; agents/services start near the functionality they explicitly link to
  // and are then allowed to settle with the D3 simulation.
  const groupPlans = groups.map((group) => {
    const rowPlans = group.rows.map((row) => {
      const optionCount = asArray(row.options).length;
      const optionRows = Math.max(1, Math.ceil(optionCount / 3));
      return {
        row,
        optionCount,
        optionRows,
        height: Math.max(156, FUNCTIONALITY_HEIGHT + 24 + optionRows * (OPTION_SIZE + OPTION_GAP) + 12)
      };
    });
    const functionalityColumns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(Math.max(1, rowPlans.length)))));
    const columnHeights = Array.from({ length: functionalityColumns }, () => 0);
    for (const rowPlan of rowPlans) {
      const columnIndex = columnHeights.indexOf(Math.min(...columnHeights));
      rowPlan.columnIndex = columnIndex;
      rowPlan.localY = columnHeights[columnIndex];
      columnHeights[columnIndex] += rowPlan.height + 16;
    }
    const rowsHeight = Math.max(0, ...columnHeights) - (rowPlans.length ? 16 : 0);
    const contentTop = group.historicalClaim ? EVENT_HEIGHT + 72 : 34;
    return {
      group,
      rowPlans,
      functionalityColumns,
      contentTop,
      width: Math.max(258, functionalityColumns * FUNCTIONALITY_CELL_WIDTH + CLUSTER_PADDING * 2),
      height: Math.max(group.historicalClaim ? 144 : 112, contentTop + rowsHeight + CLUSTER_PADDING)
    };
  });
  const maxGroupWidth = Math.max(258, ...groupPlans.map((plan) => plan.width));
  const clusterColumns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(Math.max(1, groupPlans.length)))));
  const clusterSlotWidth = Math.max(440, maxGroupWidth + 54);
  const clusterRows = [];
  groupPlans.forEach((plan, index) => {
    const rowIndex = Math.floor(index / clusterColumns);
    if (!clusterRows[rowIndex]) clusterRows[rowIndex] = [];
    clusterRows[rowIndex].push(plan);
  });
  const worldWidth = Math.max(WORLD_MIN_WIDTH, clusterColumns * clusterSlotWidth + Math.max(0, clusterColumns - 1) * CLUSTER_GAP + 80);
  const clusterRowHeights = clusterRows.map((plansInRow) => Math.max(...plansInRow.map((plan) => plan.height)));
  const clusterGridHeight = clusterRowHeights.reduce((total, height) => total + height, 0)
    + Math.max(0, clusterRowHeights.length - 1) * CLUSTER_GAP;

  let cursorY = Math.max(42, (WORLD_MIN_HEIGHT - clusterGridHeight) / 2);
  for (const [rowIndex, plansInRow] of clusterRows.entries()) {
    const rowHeight = clusterRowHeights[rowIndex];
    const rowWidth = plansInRow.length * clusterSlotWidth + Math.max(0, plansInRow.length - 1) * CLUSTER_GAP;
    const rowStartX = Math.max(40, (worldWidth - rowWidth) / 2);
    for (const [columnIndex, plan] of plansInRow.entries()) {
      const slotX = rowStartX + columnIndex * (clusterSlotWidth + CLUSTER_GAP);
      plan.x = slotX + (clusterSlotWidth - plan.width) / 2;
      plan.y = cursorY;
    }
    cursorY += rowHeight + CLUSTER_GAP;
  }

  const positionedGroups = [];
  for (const [groupIndex, plan] of groupPlans.entries()) {
    const { group } = plan;
    const positionedEvent = group.event ? {
      ...group.event,
      x: plan.x + (plan.width - EVENT_WIDTH) / 2,
      y: plan.y + 18,
      width: EVENT_WIDTH,
      height: EVENT_HEIGHT,
      shape: "rounded-rect",
      timelineRank: groupIndex + 1,
      functionalityNodeIds: []
    } : null;
    if (positionedEvent) nodeById.set(positionedEvent.id, positionedEvent);
    const positionedGroup = {
      ...group,
      event: positionedEvent,
      x: plan.x,
      y: plan.y,
      width: plan.width,
      height: plan.height,
      rowIds: []
    };
    for (const rowPlan of plan.rowPlans) {
      const { row, columnIndex, localY, optionRows } = rowPlan;
      const functionality = {
        ...row.functionality,
        x: plan.x + CLUSTER_PADDING + columnIndex * FUNCTIONALITY_CELL_WIDTH + (FUNCTIONALITY_CELL_WIDTH - FUNCTIONALITY_WIDTH) / 2,
        y: plan.y + plan.contentTop + localY,
        width: FUNCTIONALITY_WIDTH,
        height: FUNCTIONALITY_HEIGHT,
        shape: "rounded-rect",
        timeline: row.timeline,
        timelineRank: row.timeline?.order || groupIndex + 1,
        timelineLabel: eventTimeLabel(row.timeline),
        groupId: group.id
      };
      nodeById.set(functionality.id, functionality);
      functionalityById.set(functionality.id, functionality);
      positionedEvent?.functionalityNodeIds.push(functionality.id);
      positionedGroup.rowIds.push(functionality.id);
      const options = asArray(row.options);
      for (const [optionIndex, option] of options.entries()) {
        const optionColumn = optionIndex % 3;
        const optionRow = Math.floor(optionIndex / 3);
        const optionsInThisRow = Math.min(3, options.length - optionRow * 3);
        const rowWidth = optionsInThisRow * OPTION_SIZE + Math.max(0, optionsInThisRow - 1) * OPTION_GAP;
        const positionedOption = {
          ...option,
          x: functionality.x + (functionality.width - rowWidth) / 2 + optionColumn * (OPTION_SIZE + OPTION_GAP),
          y: functionality.y + FUNCTIONALITY_HEIGHT + 24 + optionRow * (OPTION_SIZE + OPTION_GAP),
          width: OPTION_SIZE,
          height: OPTION_SIZE,
          shape: "circle",
          timelineRank: functionality.timelineRank,
          groupId: group.id,
          optionRows
        };
        nodeById.set(positionedOption.id, positionedOption);
        optionById.set(positionedOption.id, positionedOption);
      }
    }
    positionedGroups.push(positionedGroup);
  }

  const agents = asArray(map.nodes)
    .filter((node) => node.kind === "agent")
    .sort((left, right) => String(left.label || left.id).localeCompare(String(right.label || right.id)) || String(left.id).localeCompare(String(right.id)));
  const services = asArray(map.nodes)
    .filter((node) => node.kind === "service")
    .sort((left, right) => String(left.label || left.id).localeCompare(String(right.label || right.id)) || String(left.id).localeCompare(String(right.id)));
  const clusterBottom = Math.max(320, ...positionedGroups.map((group) => group.y + group.height));
  const linkedFunctionalityCenter = (entityId) => {
    const centers = asArray(map.links)
      .filter((link) => link.source === entityId || link.target === entityId)
      .map((link) => functionalityById.get(link.source === entityId ? link.target : link.source))
      .filter(Boolean)
      .map((node) => staticNodeCenter(node));
    return centers.length ? { x: d3.mean(centers, (center) => center.x), y: d3.mean(centers, (center) => center.y) } : null;
  };
  const orbitOffsets = [[-136, -92], [136, -80], [-148, 94], [148, 98], [0, 142], [0, -142], [-210, 20], [210, 22]];
  const placeRelatedEntity = (entity, index, { width, height, kind }) => {
    const center = linkedFunctionalityCenter(entity.id) || {
      x: worldWidth / 2 + ((index % 3) - 1) * 150,
      y: clusterBottom + 90 + Math.floor(index / 3) * 92
    };
    const [offsetX, offsetY] = orbitOffsets[index % orbitOffsets.length];
    const band = Math.floor(index / orbitOffsets.length);
    const x = Math.max(18, Math.min(worldWidth - width - 18, center.x + offsetX + band * 18 - width / 2));
    const y = Math.max(120, center.y + offsetY + band * 22 - height / 2);
    return { ...entity, x, y, width, height, kind, shape: kind === "agent" ? "circle" : "rounded-rect" };
  };
  agents.forEach((agent, index) => nodeById.set(agent.id, placeRelatedEntity(agent, index, { width: AGENT_SIZE, height: AGENT_SIZE, kind: "agent" })));
  services.forEach((service, index) => nodeById.set(service.id, placeRelatedEntity(service, index + agents.length, { width: SERVICE_WIDTH, height: SERVICE_HEIGHT, kind: "service" })));

  const links = [];
  const eventDecisionOptionIds = new Set();
  const anticipatedOptionIds = new Set();
  for (const link of asArray(deliveryTimeline.eventLinks)) {
    if (!nodeById.has(link.source) || !nodeById.has(link.target)) continue;
    addUniqueLink(links, link);
    if (link.kind === "build-decision-option") eventDecisionOptionIds.add(link.target);
  }
  for (const link of asArray(deliveryTimeline.anticipatedOptionLinks)) {
    if (!nodeById.has(link.source) || !nodeById.has(link.target)) continue;
    addUniqueLink(links, link);
    anticipatedOptionIds.add(link.target);
  }
  for (const link of buildDeliveryChronologyLinks(rows)) {
    if (nodeById.has(link.source) && nodeById.has(link.target)) addUniqueLink(links, link);
  }
  for (const link of asArray(map.links)) {
    if (!nodeById.has(link.source) || !nodeById.has(link.target)) continue;
    if (["ownership", "analysis-assignment", "dependency", "functionality-dependency"].includes(link.kind)) addUniqueLink(links, link);
    if (link.kind === "decision-option" && eventDecisionOptionIds.has(link.target)) {
      // Keep the functionality-to-option relationship as an explicit graph
      // edge even when a build link also exists. The renderer can then show
      // the real branch trunk and the insight panel can list both facts.
      addUniqueLink(links, {
        ...link,
        id: `${link.id}:functionality-branch`,
        kind: "functionality-decision-option",
        historicalClaim: nodeById.get(link.target)?.historicalClaim === true,
        chronologyClaim: false
      });
    }
    if (link.kind === "decision-option" && !eventDecisionOptionIds.has(link.target) && !anticipatedOptionIds.has(link.target)) {
      addUniqueLink(links, {
        ...link,
        id: `${link.id}:recorded-without-build`,
        kind: "recorded-decision-option",
        historicalClaim: nodeById.get(link.target)?.historicalClaim === true,
        chronologyClaim: false
      });
    }
  }

  const entityBottom = Math.max(
    clusterBottom,
    ...agents.map((agent) => (nodeById.get(agent.id)?.y || 0) + AGENT_SIZE),
    ...services.map((service) => (nodeById.get(service.id)?.y || 0) + SERVICE_HEIGHT)
  );
  const graphHeight = Math.max(entityBottom + 92, WORLD_MIN_HEIGHT);
  return {
    width: worldWidth,
    height: graphHeight,
    groups: positionedGroups,
    rows,
    links,
    nodeById,
    functionalityById,
    optionById
  };
}

function drawCurvedLink(context, { from, to, color, dash = [], width = 0.5, alpha = 0.62, arrow = true, arrowSize = 3.5 }) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const normalX = -deltaY / distance;
  const normalY = deltaX / distance;
  const bend = Math.min(86, Math.max(18, distance * 0.16));
  const controlOne = { x: from.x + deltaX * 0.33 + normalX * bend, y: from.y + deltaY * 0.33 + normalY * bend };
  const controlTwo = { x: from.x + deltaX * 0.7 + normalX * bend, y: from.y + deltaY * 0.7 + normalY * bend };
  context.save();
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.bezierCurveTo(controlOne.x, controlOne.y, controlTwo.x, controlTwo.y, to.x, to.y);
  context.strokeStyle = color;
  context.globalAlpha = alpha;
  context.lineWidth = width;
  context.setLineDash(dash);
  context.stroke();
  context.setLineDash([]);
  if (arrow) {
    const angle = Math.atan2(to.y - controlTwo.y, to.x - controlTwo.x);
    const head = arrowSize;
    context.beginPath();
    context.moveTo(to.x, to.y);
    context.lineTo(to.x - Math.cos(angle - Math.PI / 6) * head, to.y - Math.sin(angle - Math.PI / 6) * head);
    context.lineTo(to.x - Math.cos(angle + Math.PI / 6) * head, to.y - Math.sin(angle + Math.PI / 6) * head);
    context.closePath();
    context.fillStyle = color;
    context.fill();
  }
  context.restore();
}

function nodeEndpoint(node = {}, toward = {}) {
  const center = staticNodeCenter(node);
  const deltaX = (toward.x ?? center.x) - center.x;
  const deltaY = (toward.y ?? center.y) - center.y;
  const magnitude = Math.max(1, Math.hypot(deltaX, deltaY));
  if (node.shape === "circle") {
    const radius = Math.max(1, node.width / 2);
    return { x: center.x + deltaX / magnitude * radius, y: center.y + deltaY / magnitude * radius };
  }
  const halfWidth = Math.max(1, node.width / 2);
  const halfHeight = Math.max(1, node.height / 2);
  const scale = 1 / Math.max(Math.abs(deltaX) / halfWidth || 0, Math.abs(deltaY) / halfHeight || 0, 1);
  return { x: center.x + deltaX * scale, y: center.y + deltaY * scale };
}

function linkEndpoints(source = {}, target = {}) {
  const sourceCenter = staticNodeCenter(source);
  const targetCenter = staticNodeCenter(target);
  return {
    from: nodeEndpoint(source, targetCenter),
    to: nodeEndpoint(target, sourceCenter)
  };
}

/**
 * Xcode storyboards represent a segue as a directional arrow between scenes.
 * Use the same restrained visual grammar for delivery chronology: a small
 * source port, a clean curved line, and an open destination chevron. Dashed
 * connectors remain explicitly anticipated rather than recorded history.
 */
function drawChronologySegue(context, source, target, { anticipated = false, width = 0.8, alpha = 0.82, arrowSize = 6, color = "" } = {}) {
  const { from, to } = linkEndpoints(source, target);
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const normalX = -deltaY / distance;
  const normalY = deltaX / distance;
  const bend = Math.min(54, Math.max(12, distance * 0.1));
  const controlOne = { x: from.x + deltaX * 0.34 + normalX * bend, y: from.y + deltaY * 0.34 + normalY * bend };
  const controlTwo = { x: from.x + deltaX * 0.72 + normalX * bend, y: from.y + deltaY * 0.72 + normalY * bend };
  const strokeColor = color || (anticipated ? COLORS.anticipated : COLORS.recorded);
  const angle = Math.atan2(to.y - controlTwo.y, to.x - controlTwo.x);

  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = strokeColor;
  context.fillStyle = COLORS.paper;
  context.lineWidth = width;
  context.setLineDash(anticipated ? [7, 5] : []);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.bezierCurveTo(controlOne.x, controlOne.y, controlTwo.x, controlTwo.y, to.x, to.y);
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.arc(from.x, from.y, Math.max(2.5, arrowSize * 0.42), 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.lineWidth = Math.max(1.3, width * 1.2);
  context.beginPath();
  context.moveTo(to.x - Math.cos(angle - Math.PI / 5) * arrowSize, to.y - Math.sin(angle - Math.PI / 5) * arrowSize);
  context.lineTo(to.x, to.y);
  context.lineTo(to.x - Math.cos(angle + Math.PI / 5) * arrowSize, to.y - Math.sin(angle + Math.PI / 5) * arrowSize);
  context.stroke();
  context.restore();
}

/** Service relationships use the same scene-to-scene grammar as a Swift
 * storyboard segue: a restrained line, a relationship badge, and an open
 * destination chevron. */
function drawServiceSegue(context, source, target, { width = 0.7, alpha = 0.72, arrowSize = 7, color = COLORS.service } = {}) {
  const { from, to } = linkEndpoints(source, target);
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const badge = { x: from.x + deltaX * 0.52, y: from.y + deltaY * 0.52 };
  const angle = Math.atan2(deltaY, deltaX);
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.fillStyle = COLORS.paper;
  context.lineWidth = width;
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x - unitX * 2, to.y - unitY * 2);
  context.stroke();
  context.beginPath();
  context.arc(badge.x, badge.y, 9, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = Math.max(1, width);
  context.stroke();
  context.fillStyle = color;
  [[-3.5, -3.5], [0.5, -3.5], [-3.5, 0.5], [0.5, 0.5]].forEach(([dx, dy]) => context.fillRect(badge.x + dx, badge.y + dy, 3, 3));
  context.lineWidth = Math.max(1.25, width * 1.35);
  context.beginPath();
  context.moveTo(to.x - Math.cos(angle - Math.PI / 4) * arrowSize, to.y - Math.sin(angle - Math.PI / 4) * arrowSize);
  context.lineTo(to.x, to.y);
  context.lineTo(to.x - Math.cos(angle + Math.PI / 4) * arrowSize, to.y - Math.sin(angle + Math.PI / 4) * arrowSize);
  context.stroke();
  context.restore();
}

function drawFunctionalityDependency(context, source, target, { width = 0.5, alpha = 0.62, arrowSize = 3.5, highlighted = false } = {}) {
  const { from, to } = linkEndpoints(source, target);
  drawCurvedLink(context, {
    from,
    to,
    color: highlighted ? COLORS.functionalityDependency : "#94a3b8",
    dash: [3, 4],
    width,
    alpha,
    arrowSize,
    arrow: highlighted
  });
}

function selectionStroke(context, selected, color) {
  context.strokeStyle = selected ? color : `${color}6d`;
  context.lineWidth = selected ? 2.5 : 1;
}

function acronym(value, maxLetters = 4) {
  const words = String(value || "").match(/[A-Za-z0-9]+/g) || [];
  if (words.length > 1) return words.slice(0, maxLetters).map((word) => word[0]).join("").toUpperCase();
  const source = words[0] || "NODE";
  const camel = source.match(/[A-Z0-9]+(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|\d+/g) || [source];
  if (camel.length > 1) return camel.slice(0, maxLetters).map((word) => word[0]).join("").toUpperCase();
  return source.slice(0, maxLetters).toUpperCase() || "NODE";
}

function projectApplicationIcon(project = {}) {
  const mediaIcon = asArray(project.media).find((item) => String(item?.purpose || "").toLowerCase() === "app-icon");
  return project.appIcon || project.applicationIcon || mediaIcon || null;
}

function applicationLogoUrl(project = {}) {
  return resolvePortfolioAppIconUrl({ project, appIcon: projectApplicationIcon(project) });
}

function drawApplicationLogo(context, image, x, y, size, fallbackLabel, color = COLORS.recorded) {
  context.save();
  roundedRect(context, x, y, size, size, Math.max(7, size * 0.24));
  context.clip();
  context.fillStyle = "#ffffff";
  context.fillRect(x, y, size, size);
  if (image) {
    context.drawImage(image, x, y, size, size);
  } else {
    context.fillStyle = `${color}18`;
    context.fillRect(x, y, size, size);
    context.fillStyle = color;
    context.font = `900 ${Math.max(10, Math.round(size * 0.34))}px ui-sans-serif, system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(acronym(fallbackLabel, 3), x + size / 2, y + size / 2 + 1);
  }
  context.restore();
  context.save();
  roundedRect(context, x, y, size, size, Math.max(7, size * 0.24));
  context.strokeStyle = `${color}5c`;
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

function nodeRadius(node = {}) {
  // `forceCollide` only understands circles. For cards use their short side so
  // it prevents true vertical crowding without treating a wide functionality
  // card as a 216px-diameter bubble and displacing its chronological lane.
  return node.shape === "circle" ? Math.max(18, node.width / 2) : Math.max(18, Math.min(node.width, node.height) / 2);
}

/** Rectangle-aware collision is required because most graph nodes are cards,
 * not circles. The force separates predicted bounds and respects user-pinned
 * nodes, so a wide functionality card can never settle on another node. */
function forceRectCollide(padding = 18, iterations = 4) {
  let nodes = [];
  const force = (alpha = 1) => {
    for (let pass = 0; pass < iterations; pass += 1) {
      for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        const left = nodes[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
          const right = nodes[rightIndex];
          const leftX = left.x + (left.vx || 0);
          const leftY = left.y + (left.vy || 0);
          const rightX = right.x + (right.vx || 0);
          const rightY = right.y + (right.vy || 0);
          const deltaX = rightX - leftX;
          const deltaY = rightY - leftY;
          const overlapX = (left.width + right.width) / 2 + padding - Math.abs(deltaX);
          const overlapY = (left.height + right.height) / 2 + padding - Math.abs(deltaY);
          if (overlapX <= 0 || overlapY <= 0) continue;
          const leftFixed = left.fx !== null && left.fx !== undefined;
          const rightFixed = right.fx !== null && right.fx !== undefined;
          if (leftFixed && rightFixed) continue;
          const strength = Math.max(0.25, alpha);
          const applySeparation = (axis, distance, direction) => {
            const movement = distance * strength;
            if (leftFixed) right[axis] = (right[axis] || 0) + direction * movement;
            else if (rightFixed) left[axis] = (left[axis] || 0) - direction * movement;
            else {
              left[axis] = (left[axis] || 0) - direction * movement / 2;
              right[axis] = (right[axis] || 0) + direction * movement / 2;
            }
          };
          if (overlapX < overlapY) {
            const direction = deltaX === 0 ? (String(left.id) < String(right.id) ? 1 : -1) : Math.sign(deltaX);
            applySeparation("vx", overlapX, direction);
          } else {
            const direction = deltaY === 0 ? (String(left.id) < String(right.id) ? 1 : -1) : Math.sign(deltaY);
            applySeparation("vy", overlapY, direction);
          }
        }
      }
    }
  };
  force.initialize = (nextNodes = []) => { nodes = nextNodes; };
  return force;
}

function displayNode(node = {}) {
  if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return node;
  return {
    ...node,
    x: node.x - node.width / 2,
    y: node.y - node.height / 2,
    cx: node.x,
    cy: node.y
  };
}

function staticNodeCenter(node = {}) {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function buildPhysicsNodes(graph, pinnedPositions = new Map()) {
  const staticNodes = [...graph.nodeById.values()];
  const anchorById = new Map(staticNodes.map((node) => [node.id, staticNodeCenter(node)]));
  return staticNodes.map((node) => {
    const anchor = anchorById.get(node.id) || { x: 0, y: 0 };
    const pin = pinnedPositions.get(node.id);
    const anchorX = pin?.x ?? anchor.x;
    const anchorY = pin?.y ?? anchor.y;
    return {
      ...node,
      anchorX,
      anchorY,
      x: anchorX,
      y: pin?.y ?? anchorY,
      fx: pin?.x ?? null,
      fy: pin?.y ?? null,
      collisionRadius: nodeRadius(node)
    };
  });
}

function physicsLinkStrength(link = {}) {
  if (link.kind === "build-event-functionality") return 0.09;
  if (link.kind === "build-decision-option") return 0.075;
  if (["ownership", "analysis-assignment", "dependency"].includes(link.kind)) return 0.04;
  return 0.025;
}

function physicsLinkDistance(link = {}) {
  if (link.kind === "build-event-functionality") return 148;
  if (link.kind === "build-decision-option") return 160;
  if (["ownership", "analysis-assignment"].includes(link.kind)) return 220;
  return 148;
}

function hitAreaContains(area, x, y) {
  if (area.shape === "circle") return Math.hypot(x - area.cx, y - area.cy) <= area.radius;
  return x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
}

function relatedSelectionIds(selectedId, graph, tracePath = false) {
  if (!selectedId) return new Set();
  const ids = new Set([selectedId]);
  const selected = graph.nodeById.get(selectedId);
  if (selected?.parentFunctionalityId) ids.add(selected.parentFunctionalityId);
  let frontier = new Set(ids);
  do {
    const next = new Set();
    for (const link of graph.links) {
      if (!frontier.has(link.source) && !frontier.has(link.target)) continue;
      for (const id of [link.source, link.target]) if (!ids.has(id)) {
        ids.add(id);
        next.add(id);
      }
    }
    frontier = next;
  } while (tracePath && frontier.size);
  return ids;
}

function connectorStyle(link, selectedId, graph, zoomScale = 1, selectedRelations = null) {
  const related = selectedRelations || relatedSelectionIds(selectedId, graph);
  const connected = !selectedId || related.has(link.source) && related.has(link.target);
  const highlighted = Boolean(selectedId) && (link.source === selectedId || link.target === selectedId || related.has(link.source) && related.has(link.target));
  const unit = Math.max(0.2, zoomScale);
  return {
    width: (highlighted ? 1.5 : connected ? 0.5 : 0.22) / unit,
    alpha: highlighted ? 0.9 : connected ? 0.2 : 0.08,
    arrowSize: (highlighted ? 5.5 : 3.5) / unit,
    highlighted
  };
}

function drawAgentIcon(context, iconKey, x, y, color, inverse = false) {
  const ink = inverse ? "#ffffff" : color;
  context.save();
  context.strokeStyle = ink;
  context.fillStyle = ink;
  context.lineWidth = 1.8;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (["code", "runtime", "package"].includes(iconKey)) {
    context.font = "800 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "center";
    context.fillText(iconKey === "package" ? "□" : "{}", x, y + 5);
  } else if (["database", "data"].includes(iconKey)) {
    context.beginPath(); context.ellipse(x, y - 5, 8, 3.4, 0, 0, Math.PI * 2); context.stroke();
    context.beginPath(); context.moveTo(x - 8, y - 5); context.lineTo(x - 8, y + 6); context.quadraticCurveTo(x, y + 11, x + 8, y + 6); context.lineTo(x + 8, y - 5); context.stroke();
    context.beginPath(); context.ellipse(x, y + 6, 8, 3.4, 0, 0, Math.PI); context.stroke();
  } else if (["check", "review"].includes(iconKey)) {
    context.beginPath(); context.moveTo(x - 8, y); context.lineTo(x - 2, y + 6); context.lineTo(x + 9, y - 7); context.stroke();
  } else if (["shield", "security"].includes(iconKey)) {
    context.beginPath(); context.moveTo(x, y - 10); context.lineTo(x + 8, y - 6); context.lineTo(x + 6, y + 5); context.quadraticCurveTo(x, y + 11, x - 6, y + 5); context.lineTo(x - 8, y - 6); context.closePath(); context.stroke();
  } else if (["design", "layout", "architecture"].includes(iconKey)) {
    context.beginPath(); context.moveTo(x, y - 10); context.lineTo(x + 4, y - 4); context.lineTo(x + 10, y); context.lineTo(x + 4, y + 4); context.lineTo(x, y + 10); context.lineTo(x - 4, y + 4); context.lineTo(x - 10, y); context.lineTo(x - 4, y - 4); context.closePath(); context.stroke();
  } else if (["chart", "analytics"].includes(iconKey)) {
    [0, 1, 2].forEach((bar) => context.fillRect(x - 9 + bar * 7, y + 8 - [8, 14, 20][bar], 4, [8, 14, 20][bar]));
  } else if (iconKey === "orchestrator") {
    [[0, -8], [-8, 7], [8, 7]].forEach(([dx, dy]) => { context.beginPath(); context.arc(x + dx, y + dy, 3, 0, Math.PI * 2); context.fill(); });
    context.beginPath(); context.moveTo(x, y - 5); context.lineTo(x - 6, y + 4); context.moveTo(x, y - 5); context.lineTo(x + 6, y + 4); context.stroke();
  } else if (iconKey === "controller") {
    // QAgent/controller: a distinct hexagonal Q mark, not the orchestrator's
    // hub-and-spoke glyph.
    context.beginPath();
    for (let point = 0; point < 6; point += 1) {
      const angle = -Math.PI / 2 + point * Math.PI / 3;
      const px = x + Math.cos(angle) * 10;
      const py = y + Math.sin(angle) * 10;
      if (point === 0) context.moveTo(px, py); else context.lineTo(px, py);
    }
    context.closePath();
    context.stroke();
    context.font = "900 10px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("Q", x, y + 4);
    context.beginPath(); context.moveTo(x + 4, y + 4); context.lineTo(x + 9, y + 9); context.stroke();
  } else if (["catalog", "pricing", "document", "media"].includes(iconKey)) {
    context.strokeRect(x - 7, y - 9, 14, 18); context.beginPath(); context.moveTo(x - 4, y - 3); context.lineTo(x + 4, y - 3); context.moveTo(x - 4, y + 3); context.lineTo(x + 4, y + 3); context.stroke();
  } else {
    context.beginPath(); context.arc(x, y - 4, 5, 0, Math.PI * 2); context.stroke(); context.beginPath(); context.arc(x, y + 10, 8, Math.PI, 0); context.stroke();
  }
  context.restore();
}

function functionalityIconKey(functionality = {}) {
  const category = String(functionality.category || functionality.functionalityType || "").trim().toLowerCase();
  if (/ui|ux|front|page|view|experience|interface/.test(category)) return "layout";
  if (/api|service|backend|integration|gateway|connection/.test(category)) return "api";
  if (/data|database|storage|persist|repository/.test(category)) return "database";
  if (/security|privacy|compliance|identity|auth|governance/.test(category)) return "shield";
  if (/analytic|report|metric|insight|dashboard/.test(category)) return "chart";
  if (/payment|commerce|billing|pricing|order/.test(category)) return "commerce";
  if (/workflow|process|orchestrat|automation/.test(category)) return "flow";
  return "functionality";
}

function drawFunctionalityIcon(context, iconKey, x, y, color = "#ffffff") {
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 1.7;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (iconKey === "layout") {
    context.strokeRect(x - 10, y - 8, 20, 16);
    context.beginPath(); context.moveTo(x - 10, y - 3); context.lineTo(x + 10, y - 3); context.moveTo(x - 3, y - 3); context.lineTo(x - 3, y + 8); context.stroke();
  } else if (iconKey === "api") {
    context.beginPath(); context.moveTo(x - 4, y - 8); context.lineTo(x - 10, y); context.lineTo(x - 4, y + 8); context.moveTo(x + 4, y - 8); context.lineTo(x + 10, y); context.lineTo(x + 4, y + 8); context.stroke();
  } else if (iconKey === "database") {
    context.beginPath(); context.ellipse(x, y - 6, 9, 3.5, 0, 0, Math.PI * 2); context.stroke();
    context.beginPath(); context.moveTo(x - 9, y - 6); context.lineTo(x - 9, y + 6); context.quadraticCurveTo(x, y + 11, x + 9, y + 6); context.lineTo(x + 9, y - 6); context.stroke();
    context.beginPath(); context.ellipse(x, y + 1, 9, 3.5, 0, 0, Math.PI); context.stroke();
  } else if (iconKey === "shield") {
    context.beginPath(); context.moveTo(x, y - 10); context.lineTo(x + 8, y - 6); context.lineTo(x + 6, y + 5); context.quadraticCurveTo(x, y + 11, x - 6, y + 5); context.lineTo(x - 8, y - 6); context.closePath(); context.stroke();
    context.beginPath(); context.moveTo(x - 4, y); context.lineTo(x - 1, y + 4); context.lineTo(x + 5, y - 4); context.stroke();
  } else if (iconKey === "chart") {
    [0, 1, 2].forEach((bar) => context.fillRect(x - 9 + bar * 7, y + 8 - [8, 14, 20][bar], 4, [8, 14, 20][bar]));
  } else if (iconKey === "commerce") {
    context.beginPath(); context.moveTo(x - 9, y - 3); context.lineTo(x - 2, y - 10); context.lineTo(x + 9, y + 1); context.lineTo(x + 2, y + 8); context.closePath(); context.stroke();
    context.beginPath(); context.arc(x - 2, y - 4, 1.5, 0, Math.PI * 2); context.fill();
  } else if (iconKey === "flow") {
    [[-8, -7], [8, 0], [-8, 7]].forEach(([dx, dy]) => { context.beginPath(); context.arc(x + dx, y + dy, 2.7, 0, Math.PI * 2); context.fill(); });
    context.beginPath(); context.moveTo(x - 5, y - 7); context.lineTo(x + 5, y - 1); context.moveTo(x - 5, y + 7); context.lineTo(x + 5, y + 1); context.stroke();
  } else {
    [[-6, -6], [3, -6], [-6, 3], [3, 3]].forEach(([dx, dy]) => context.strokeRect(x + dx, y + dy, 6, 6));
  }
  context.restore();
}

function decisionGlyph(option = {}) {
  if (option.state === "selected") return "✓";
  if (option.state === "deferred") return "↗";
  if (option.state === "rejected" || option.state === "anticipated_rejected") return "×";
  return "?";
}

function evidenceText(item) {
  if (typeof item === "string") return item;
  return item?.reference || item?.value || item?.id || item?.target || "Recorded reference";
}

function relationshipLabel(link = {}) {
  const labels = {
    "build-event-functionality": "Build establishes functionality",
    "build-decision-option": link.chronologyClaim ? "Exact build/workflow decision branch" : "Build-context decision branch",
    "functionality-decision-option": "Functionality decision branch",
    "chronology-segue": link.chronologyMode === "recorded" ? "Recorded delivery chronology" : "Anticipated delivery chronology",
    "anticipated-decision-option": "Anticipated decision option",
    "recorded-decision-option": "Recorded decision without linked build",
    ownership: "Recorded implementation owner",
    "analysis-assignment": "Analysis assignment",
    dependency: "Supporting dependency",
    "functionality-dependency": "Exact functionality dependency"
  };
  return labels[link.kind] || link.kind || "Relationship";
}

function resolveDeliveryNodeInsight({ selected = null, graph, deliveryTimeline, rowByFunctionalityId }) {
  if (!selected) return null;
  const nodeById = graph.nodeById;
  const incidentLinks = graph.links.filter((link) => link.source === selected.id || link.target === selected.id);
  const relationships = incidentLinks.map((link) => {
    const peerId = link.source === selected.id ? link.target : link.source;
    const peer = nodeById.get(peerId);
    return {
      id: link.id,
      label: relationshipLabel(link),
      targetId: peerId,
      targetLabel: peer?.label || peerId,
      provenance: link.associationBasis || (link.historicalClaim === false ? "anticipated source plan" : "recorded relationship")
    };
  });
  const evidence = asArray(selected.evidence).map((item) => ({ kind: item?.kind || "evidence", reference: evidenceText(item) }));
  const fields = [];
  const chronology = [];
  const warnings = [];
  const anticipatedChronologyOnly = deliveryTimeline.rows.length > 0
    && deliveryTimeline.rows.every((row) => row.timeline?.historicalClaim === false);
  if (selected.kind === "aggregate") {
    fields.push({ label: "Category", value: selected.aggregateKind?.replaceAll("-", " ") || "Grouped nodes" });
    fields.push({ label: "Collapsed nodes", value: String(selected.childIds?.length || 0) });
    fields.push({ label: "View behavior", value: "Click or use Expand group to reveal children" });
    evidence.push(...asArray(selected.childLabels).map((label) => ({ kind: "group member", reference: label })));
  }
  if (selected.kind === "build-event") {
    fields.push({ label: "Build ID", value: selected.buildId || "Recorded build ID unavailable" });
    fields.push({ label: "Status", value: selected.status || "succeeded" });
    fields.push({ label: "Parent workflow", value: selected.parentWorkflowId || "Not recorded" });
    fields.push({ label: "Established functionality nodes", value: String(selected.functionalityNodeIds?.length || 0) });
    chronology.push({ label: "Build time", value: eventTimeLabel(selected) });
    for (const action of asArray(selected.buildDetails?.actions)) fields.push({ label: `Action · ${action.type}`, value: action.target || action.status || "Recorded action" });
    for (const path of asArray(selected.buildDetails?.changedFiles)) evidence.push({ kind: "changed file", reference: path });
  }
  if (selected.kind === "functionality") {
    const row = rowByFunctionalityId.get(selected.id);
    fields.push({ label: "Category", value: selected.category || "Capability" });
    fields.push({ label: "Source functionality ID", value: selected.sourceFunctionalityId || "Unavailable" });
    fields.push({ label: "Source entities", value: selected.sourceEntityIds?.join(", ") || "Unavailable" });
    fields.push({ label: "Features", value: String(selected.features?.length || 0) });
    chronology.push({ label: "Delivery position", value: row ? `#${row.timeline.order} · ${row.timeline.label}` : "Unavailable" });
    chronology.push({ label: "Time or plan", value: row ? eventTimeLabel(row.timeline) : "Unavailable" });
    chronology.push({ label: "Basis", value: row?.timeline?.basis?.replaceAll("_", " ") || "Unavailable" });
    for (const item of asArray(selected.evidence)) evidence.push({ kind: item?.kind || "source evidence", reference: evidenceText(item) });
    if (row?.timeline?.historicalClaim === false) warnings.push("This functionality placement is anticipated source order; it does not claim a build timestamp.");
  }
  if (selected.kind === "decision-option") {
    fields.push({ label: "Outcome", value: optionPresentation(selected).label });
    fields.push({ label: "Branch ID", value: selected.branchId || "Unavailable" });
    fields.push({ label: "Record classification", value: selected.recordClassification || "Unavailable" });
    fields.push({ label: "Record basis", value: selected.recordBasis || "Unavailable" });
    fields.push({ label: "Constraints", value: selected.constraints?.join(", ") || "No constraints recorded" });
    chronology.push({ label: "Decision time", value: selected.temporal?.createdAt ? eventTimeLabel({ occurredAt: selected.temporal.createdAt }) : "No decision time recorded" });
    if (selected.historicalClaim === false) warnings.push("This is an anticipated source-derived option, not a recorded decision.");
    for (const item of asArray(selected.evidence)) evidence.push({ kind: item?.kind || "decision evidence", reference: evidenceText(item) });
  }
  if (selected.kind === "agent") {
    fields.push({ label: "Agent ID", value: selected.agentId || selected.id });
    fields.push({ label: "Agent type", value: selected.agentType || "general" });
    fields.push({ label: "Category", value: selected.agentCategory || selected.category || "general" });
    fields.push({ label: "Role", value: selected.role || "Not recorded" });
    fields.push({ label: "Responsibility", value: selected.responsibility || "Not recorded" });
    fields.push({ label: "Association", value: agentRelationshipLabel(selected) });
    if (selected.clusterId) fields.push({ label: "Cluster", value: selected.clusterId });
    if (selected.group) fields.push({ label: "Group", value: selected.group });
  }
  if (selected.kind === "service") {
    fields.push({ label: "Source entity ID", value: selected.sourceEntityId || selected.id });
    fields.push({ label: "Service type", value: selected.serviceType || "Service" });
    fields.push({ label: "Status", value: selected.status || "Observed" });
    for (const item of asArray(selected.evidence)) evidence.push({ kind: item?.kind || "service evidence", reference: evidenceText(item) });
  }
  return {
    kind: selected.kind,
    title: selected.label,
    summary: selected.description || selected.detail || "No additional detail is recorded.",
    anticipatedChronologyOnly,
    fields,
    chronology,
    evidence: evidence.filter((item, index, rows) => item.reference && rows.findIndex((candidate) => `${candidate.kind}:${candidate.reference}` === `${item.kind}:${item.reference}`) === index),
    relationships,
    warnings
  };
}

export default function ApplicationDecisionMappingCanvas({ project, architectureAnalysisReport, decisionBranches = [], onDecisionMap }) {
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const transformRef = useRef(d3.zoomIdentity);
  const panRef = useRef(null);
  const simulationRef = useRef(null);
  const physicsNodesRef = useRef(new Map());
  const pinnedPositionsRef = useRef(new Map());
  const selectedIdRef = useRef("");
  const hoveredIdRef = useRef("");
  const tracePathRef = useRef(false);
  const draggingRef = useRef(false);
  const suppressCanvasClickRef = useRef(false);
  const pendingSearchFocusRef = useRef("");
  const drawFrameRef = useRef(0);
  const drawRef = useRef(() => {});
  const fitRef = useRef(() => d3.zoomIdentity);
  const positionedRef = useRef([]);
  const fitRequestedRef = useRef(true);
  const expandTriggerRef = useRef(null);
  const detailCloseRef = useRef(null);
  const applicationLogoRef = useRef(null);
  const agentAvatarImagesRef = useRef(new Map());
  const [topology, setTopology] = useState(null);
  const [topologyState, setTopologyState] = useState("loading");
  const [instructionTimeline, setInstructionTimeline] = useState([]);
  const [timelineState, setTimelineState] = useState("loading");
  const [timelineProjectId, setTimelineProjectId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [showDetail, setShowDetail] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [relationshipFilter, setRelationshipFilter] = useState("primary");
  const [groupBy, setGroupBy] = useState("type");
  const [depth, setDepth] = useState("all");
  const [showInactive, setShowInactive] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [tracePath, setTracePath] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [applicationLogoState, setApplicationLogoState] = useState("idle");
  const [globalAgentRecords, setGlobalAgentRecords] = useState([]);

  const resolvedApplicationLogoUrl = useMemo(() => applicationLogoUrl(project), [project]);

  useEffect(() => {
    applicationLogoRef.current = null;
    if (!resolvedApplicationLogoUrl || typeof Image !== "function") {
      setApplicationLogoState(resolvedApplicationLogoUrl ? "error" : "empty");
      drawRef.current();
      return undefined;
    }
    let active = true;
    const image = new Image();
    setApplicationLogoState("loading");
    image.onload = () => {
      if (!active) return;
      applicationLogoRef.current = image;
      setApplicationLogoState("ready");
      drawRef.current();
    };
    image.onerror = () => {
      if (!active) return;
      applicationLogoRef.current = null;
      setApplicationLogoState("error");
      drawRef.current();
    };
    image.src = resolvedApplicationLogoUrl;
    return () => { active = false; };
  }, [resolvedApplicationLogoUrl]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${BACKEND_URL}/api/agents/global`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Global agent memory is unavailable.");
        if (!controller.signal.aborted) setGlobalAgentRecords(asArray(data.agents));
      })
      .catch((error) => {
        if (error.name !== "AbortError") setGlobalAgentRecords([]);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!project?.id) return undefined;
    const controller = new AbortController();
    setTopologyState("loading");
    setTopology(null);
    authFetch(`${BACKEND_URL}/api/agentic-system/graph`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Topology is unavailable.");
        if (controller.signal.aborted) return;
        setTopology(data);
        setTopologyState("ready");
      })
      .catch((error) => {
        if (error.name !== "AbortError") setTopologyState("error");
      });
    return () => controller.abort();
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) return undefined;
    const controller = new AbortController();
    setTimelineState("loading");
    setInstructionTimeline([]);
    setTimelineProjectId("");
    authFetch(`${BACKEND_URL}/api/project-instructions?projectId=${encodeURIComponent(project.id)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Project build history is unavailable.");
        if (controller.signal.aborted) return;
        setInstructionTimeline((Array.isArray(data.instructions) ? data.instructions : []).filter((instruction) => instruction?.projectId === project.id));
        setTimelineProjectId(project.id);
        setTimelineState("ready");
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== "AbortError") {
          setInstructionTimeline([]);
          setTimelineProjectId(project.id);
          setTimelineState("error");
        }
      });
    return () => controller.abort();
  }, [project?.id]);

  const map = useMemo(
    () => buildApplicationDecisionMap({ project, architectureAnalysisReport, topology, decisionBranches }),
    [architectureAnalysisReport, decisionBranches, project, topology]
  );
  const currentTimelineState = timelineProjectId === project?.id ? timelineState : "loading";
  const currentInstructionTimeline = timelineProjectId === project?.id ? instructionTimeline : EMPTY_INSTRUCTION_TIMELINE;
  const deliveryTimeline = useMemo(
    () => buildApplicationDeliveryTimeline({ map, instructionTimeline: currentInstructionTimeline, projectId: project?.id }),
    [currentInstructionTimeline, map, project?.id]
  );
  const fullGraph = useMemo(
    () => buildDeliveryGraphLayout({ map, deliveryTimeline }),
    [deliveryTimeline, map]
  );
  const depthSelectionId = depth === "all" ? "" : selectedId;
  const graph = useMemo(
    () => buildDeliveryGraphView(fullGraph, {
      expandedGroups,
      relationshipFilter,
      groupBy,
      depth,
      showInactive,
      selectedId: depthSelectionId
    }),
    [depth, depthSelectionId, expandedGroups, fullGraph, groupBy, relationshipFilter, showInactive]
  );
  const agentAvatarByNodeId = useMemo(() => new Map(
    [...graph.nodeById.values()]
      .filter((node) => node.kind === "agent")
      .map((agent) => {
        const visual = deliveryAgentVisual(agent, globalAgentRecords);
        return [agent.id, { visual, dataUrl: agentAvatarDataUrl(visual) }];
      })
  ), [globalAgentRecords, graph]);

  useEffect(() => {
    if (typeof Image !== "function") return undefined;
    for (const { dataUrl } of agentAvatarByNodeId.values()) {
      if (agentAvatarImagesRef.current.has(dataUrl)) continue;
      const image = new Image();
      agentAvatarImagesRef.current.set(dataUrl, { image, status: "loading" });
      image.onload = () => {
        agentAvatarImagesRef.current.set(dataUrl, { image, status: "ready" });
        drawRef.current();
      };
      image.onerror = () => {
        agentAvatarImagesRef.current.set(dataUrl, { image: null, status: "error" });
        drawRef.current();
      };
      image.src = dataUrl;
    }
    return undefined;
  }, [agentAvatarByNodeId]);
  const rowByFunctionalityId = useMemo(
    () => new Map(deliveryTimeline.rows.map((row) => [row.functionality.id, row])),
    [deliveryTimeline.rows]
  );
  const keyboardNodeIds = useMemo(() => {
    const kindOrder = { "build-event": 0, functionality: 1, "decision-option": 2, agent: 3, service: 4 };
    return [...graph.nodeById.values()]
      .sort((left, right) => (left.timelineRank || 0) - (right.timelineRank || 0)
        || (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9)
        || left.y - right.y
        || left.x - right.x
        || String(left.label || left.id).localeCompare(String(right.label || right.id)))
      .map((node) => node.id);
  }, [graph]);
  const selected = graph.nodeById.get(selectedId) || null;
  const selectedBuildOptionLink = selected?.kind === "decision-option"
    ? deliveryTimeline.eventLinks.find((link) => link.kind === "build-decision-option" && link.target === selected.id) || null
    : null;
  const appChronologyAnticipatedOnly = deliveryTimeline.rows.length > 0
    && deliveryTimeline.rows.every((row) => row.timeline?.historicalClaim === false);

  const selectedInsight = useMemo(
    () => resolveDeliveryNodeInsight({ selected, graph, deliveryTimeline, rowByFunctionalityId }),
    [deliveryTimeline, graph, rowByFunctionalityId, selected]
  );

  useEffect(() => {
    onDecisionMap?.(map);
  }, [map, onDecisionMap]);

  useEffect(() => {
    if (!selectedId || graph.nodeById.has(selectedId)) return;
    const hiddenGroup = graph.hiddenNodeGroups?.get(selectedId);
    const aggregate = hiddenGroup ? graph.aggregateByGroup?.get(hiddenGroup) : null;
    setSelectedId(aggregate?.id || "");
  }, [graph, selectedId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    drawRef.current();
  }, [selectedId]);

  useEffect(() => {
    tracePathRef.current = tracePath;
    drawRef.current();
  }, [tracePath]);

  // D3 retains the fixed-scale pan transform on the canvas element as well as
  // in our ref. New applications begin fitted, so one graph cannot hide the
  // next application's nodes.
  useEffect(() => {
    transformRef.current = d3.zoomIdentity;
    fitRequestedRef.current = true;
    pinnedPositionsRef.current = new Map();
    setSelectedId("");
    setExpandedGroups(new Set());
    setRelationshipFilter("primary");
    setGroupBy("type");
    setDepth("all");
    setShowInactive(true);
    setSearchTerm("");
    setTracePath(false);
    setLegendOpen(false);
    setShowDetail(false);
    if (canvasRef.current) d3.select(canvasRef.current).property("__zoom", d3.zoomIdentity);
  }, [project?.id]);

  useEffect(() => {
    if (!showDetail || !deliveryTimeline.rows.length) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setShowDetail(false);
    };
    transformRef.current = d3.zoomIdentity;
    fitRequestedRef.current = true;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    const frame = window.requestAnimationFrame(() => detailCloseRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      window.requestAnimationFrame(() => expandTriggerRef.current?.focus());
    };
  }, [deliveryTimeline.rows.length, showDetail]);

  useEffect(() => {
    if (showDetail && !deliveryTimeline.rows.length) setShowDetail(false);
  }, [deliveryTimeline.rows.length, showDetail]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!showDetail || !canvas || !viewport || !deliveryTimeline.rows.length) return undefined;
    const hitAreas = [];
    const physicsNodes = buildPhysicsNodes(graph, pinnedPositionsRef.current);
    const physicsNodesById = new Map(physicsNodes.map((node) => [node.id, node]));
    const physicsLinks = graph.links
      .filter((link) => physicsNodesById.has(link.source) && physicsNodesById.has(link.target))
      // Chronology segues describe order and must not pull the scene nodes
      // together like a structural dependency.
      .filter((link) => link.kind !== "chronology-segue")
      // A contextual decision/build association is a useful inspector fact,
      // but it is not a structural edge that should tug a decision bubble
      // away from the functionality it branches from.
      .filter((link) => link.kind !== "build-decision-option" || link.chronologyClaim)
      .map((link) => ({ ...link }));
    physicsNodesRef.current = physicsNodesById;
    const renderedNode = (id) => {
      const physics = physicsNodesById.get(id);
      return physics ? displayNode(physics) : graph.nodeById.get(id) || null;
    };
    const dimensions = () => {
      const width = Math.max(1, Math.floor(viewport.clientWidth || 360));
      const height = Math.max(420, Math.floor(viewport.clientHeight || 500));
      // Fit once, then allow explicit controls to adjust scale. Wheel and
      // double-click zoom remain disabled so background drag stays predictable.
      const fitScale = Math.min(1, Math.max(
        0.01,
        Math.min(Math.max(1, width - 48) / graph.width, Math.max(1, height - 48) / graph.height)
      ));
      return {
        width,
        height,
        fitTransform: d3.zoomIdentity
          .translate(Math.max(24, (width - graph.width * fitScale) / 2), Math.max(24, (height - graph.height * fitScale) / 2))
          .scale(fitScale)
      };
    };

    const pushHitArea = (node) => hitAreas.push({
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      cx: node.cx ?? node.x + node.width / 2,
      cy: node.cy ?? node.y + node.height / 2,
      radius: nodeRadius(node),
      shape: node.shape || "rounded-rect",
      kind: node.kind
    });
    const draw = () => {
      const measurement = dimensions();
      if (fitRequestedRef.current) {
        transformRef.current = measurement.fitTransform;
        d3.select(canvas).property("__zoom", measurement.fitTransform);
        fitRequestedRef.current = false;
      }
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(measurement.width * pixelRatio);
      canvas.height = Math.round(measurement.height * pixelRatio);
      canvas.style.width = `${measurement.width}px`;
      canvas.style.height = `${measurement.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, measurement.width, measurement.height);
      context.save();
      context.translate(transformRef.current.x, transformRef.current.y);
      context.scale(transformRef.current.k, transformRef.current.k);
      hitAreas.length = 0;
      const activeSelectedId = selectedIdRef.current;
      const focusedId = activeSelectedId || hoveredIdRef.current;
      const selectionRelations = relatedSelectionIds(focusedId, graph, Boolean(activeSelectedId && tracePathRef.current));
      const styleFor = (link) => connectorStyle(link, focusedId, graph, transformRef.current.k, selectionRelations);
      const nodeAlpha = (id) => !focusedId || selectionRelations.has(id) ? 1 : 0.11;
      const edgeColor = (semanticColor, connector) => connector.highlighted ? semanticColor : "#94a3b8";

      for (const group of graph.groups) {
        if (!group.historicalClaim) continue;
        roundedRect(context, group.x, group.y, group.width, group.height, 16);
        context.fillStyle = "#f7fbfa";
        context.fill();
        context.strokeStyle = "#d6ece7";
        context.lineWidth = 1;
        context.setLineDash([]);
        context.stroke();
        context.setLineDash([]);
      }

      graph.links.filter((link) => link.kind === "chronology-segue").forEach((link) => {
        const source = renderedNode(link.source);
        const target = renderedNode(link.target);
        if (!source || !target) return;
        const connector = styleFor(link);
        drawChronologySegue(context, source, target, {
          anticipated: link.chronologyMode !== "recorded",
          width: Math.max(0.65, connector.width),
          alpha: connector.alpha,
          arrowSize: Math.max(5, connector.arrowSize + 1.5),
          color: edgeColor(link.chronologyMode !== "recorded" ? COLORS.anticipated : COLORS.recorded, connector)
        });
      });

      graph.links.filter((link) => link.kind === "functionality-dependency").forEach((link, index) => {
        const source = renderedNode(link.source);
        const target = renderedNode(link.target);
        if (source && target) drawFunctionalityDependency(context, source, target, styleFor(link));
      });

      for (const link of graph.links) {
        if (["functionality-dependency", "chronology-segue"].includes(link.kind)) continue;
        const source = renderedNode(link.source);
        const target = renderedNode(link.target);
        if (!source || !target) continue;
        const connector = styleFor(link);
        const { from, to } = linkEndpoints(source, target);
        if (link.kind === "build-event-functionality") {
          drawCurvedLink(context, {
            from,
            to,
            color: edgeColor(COLORS.recorded, connector),
            width: connector.width,
            alpha: connector.alpha,
            arrow: connector.highlighted,
            arrowSize: connector.arrowSize
          });
          continue;
        }
        if (link.kind === "build-decision-option") {
          const color = optionColor(target);
          if (link.chronologyClaim) {
            drawCurvedLink(context, {
              from,
              to,
              color: edgeColor(color, connector),
              dash: [],
              width: connector.width * 0.74,
              alpha: connector.alpha * 0.34,
              arrow: false,
              arrowSize: connector.arrowSize
            });
          }
          continue;
        }
        if (["anticipated-decision-option", "recorded-decision-option", "functionality-decision-option"].includes(link.kind)) {
          drawCurvedLink(context, {
            from,
            to,
            color: edgeColor(optionColor(target), connector),
            dash: link.kind === "anticipated-decision-option" ? [5, 4] : link.kind === "recorded-decision-option" ? [2, 4] : [],
            width: connector.width,
            alpha: connector.alpha,
            arrow: connector.highlighted,
            arrowSize: connector.arrowSize
          });
          continue;
        }
        if (["ownership", "analysis-assignment"].includes(link.kind)) {
          const color = agentColor(source);
          drawCurvedLink(context, {
            from,
            to,
            color: edgeColor(color, connector),
            dash: link.kind === "analysis-assignment" ? [4, 4] : [],
            width: connector.width,
            alpha: connector.alpha,
            arrow: connector.highlighted,
            arrowSize: connector.arrowSize
          });
          continue;
        }
        if (link.kind === "dependency") {
          drawServiceSegue(context, source, target, {
            color: edgeColor(COLORS.service, connector),
            width: connector.width,
            alpha: connector.alpha,
            arrowSize: Math.max(7, connector.arrowSize + 2)
          });
        }
      }

      const buildEventNodes = [...graph.nodeById.values()].filter((node) => node.kind === "build-event");
      for (const sourceEvent of buildEventNodes) {
        const event = renderedNode(sourceEvent.id);
        if (!event) continue;
        const selectedEvent = activeSelectedId === event.id;
        const color = buildEventColor(event);
        context.save();
        context.globalAlpha = nodeAlpha(event.id);
        roundedRect(context, event.x, event.y, event.width, event.height, 13);
        context.fillStyle = selectedEvent ? color : `${color}12`;
        context.fill();
        selectionStroke(context, selectedEvent, color);
        context.setLineDash(event.historicalClaim ? [] : [4, 3]);
        context.stroke();
        context.setLineDash([]);
        drawApplicationLogo(context, applicationLogoRef.current, event.x + 14, event.y + 27, 36, map.projectName, color);
        context.fillStyle = color;
        context.font = "850 9px ui-sans-serif, system-ui, sans-serif";
        const eventTitle = event.mode === "unsequenced" ? "BLD · UNSQ" : `BLD ${String(event.buildIndex || "").padStart(2, "0")}`;
        context.fillText(eventTitle, event.x + 14, event.y + 18);
        context.fillStyle = COLORS.ink;
        context.font = "900 20px ui-sans-serif, system-ui, sans-serif";
        context.textAlign = "left";
        context.fillText(acronym(event.label, 5), event.x + 62, event.y + 53);
        context.textAlign = "left";
        pushHitArea(event);
        context.restore();
      }

      for (const row of graph.rows) {
        const functionality = renderedNode(row.functionality.id);
        if (!functionality) continue;
        const selectedFunctionality = activeSelectedId === functionality.id;
        const color = eventColor(row.timeline);
        context.save();
        context.globalAlpha = nodeAlpha(functionality.id);
        roundedRect(context, functionality.x, functionality.y, functionality.width, functionality.height, 15);
        context.fillStyle = selectedFunctionality ? `${color}15` : COLORS.paper;
        context.fill();
        selectionStroke(context, selectedFunctionality, color);
        context.stroke();
        context.beginPath();
        context.arc(functionality.x + 27, functionality.y + functionality.height / 2, 19, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        drawFunctionalityIcon(context, functionalityIconKey(functionality), functionality.x + 27, functionality.y + functionality.height / 2, "#ffffff");
        context.textAlign = "left";
        context.fillStyle = color;
        context.font = "850 8px ui-sans-serif, system-ui, sans-serif";
        context.fillText(`T${String(row.timeline.order || functionality.timelineRank || "").padStart(2, "0")} · ${acronym(functionality.category || "capability", 4)}`, functionality.x + 55, functionality.y + 23);
        context.fillStyle = COLORS.ink;
        context.font = "900 20px ui-sans-serif, system-ui, sans-serif";
        context.fillText(acronym(functionality.label, 5), functionality.x + 55, functionality.y + 51);
        pushHitArea(functionality);
        context.restore();
      }

      for (const option of graph.optionById.values()) {
        const positionedOption = renderedNode(option.id);
        if (!positionedOption) continue;
        const selectedOption = activeSelectedId === positionedOption.id;
        const presentation = optionPresentation(positionedOption);
        const color = optionColor(positionedOption);
        const radius = positionedOption.width / 2;
        const cx = positionedOption.x + radius;
        const cy = positionedOption.y + radius;
        context.save();
        context.globalAlpha = nodeAlpha(positionedOption.id);
        context.beginPath();
        context.arc(cx, cy, radius, 0, Math.PI * 2);
        context.fillStyle = selectedOption ? color : `${color}18`;
        context.fill();
        selectionStroke(context, selectedOption, color);
        context.setLineDash(positionedOption.historicalClaim ? [] : [4, 3]);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = selectedOption ? "#ffffff" : color;
        context.font = "800 17px ui-sans-serif, system-ui, sans-serif";
        context.textAlign = "center";
        context.fillText(decisionGlyph(positionedOption), cx, cy + 6);
        context.font = "850 8px ui-sans-serif, system-ui, sans-serif";
        context.fillText(acronym(positionedOption.label || presentation.label, 4), cx, positionedOption.y + positionedOption.height + 13);
        context.textAlign = "left";
        pushHitArea(positionedOption);
        context.restore();
      }

      const agentNodes = [...graph.nodeById.values()].filter((node) => node.kind === "agent");
      for (const sourceAgent of agentNodes) {
        const agent = renderedNode(sourceAgent.id);
        if (!agent) continue;
        const selectedAgent = activeSelectedId === agent.id;
        const color = agentColor(agent);
        const radius = agent.width / 2;
        const cx = agent.x + radius;
        const cy = agent.y + radius;
        context.save();
        context.globalAlpha = nodeAlpha(agent.id);
        context.beginPath();
        context.arc(cx, cy, radius, 0, Math.PI * 2);
        context.fillStyle = selectedAgent ? color : `${color}18`;
        context.fill();
        selectionStroke(context, selectedAgent, color);
        context.setLineDash(agent.associationBasis === "analysis_assignment" ? [4, 3] : []);
        context.stroke();
        context.setLineDash([]);
        const avatar = agentAvatarByNodeId.get(agent.id);
        const avatarImage = avatar ? agentAvatarImagesRef.current.get(avatar.dataUrl) : null;
        if (avatarImage?.status === "ready" && avatarImage.image) {
          const avatarSize = agent.width - 12;
          context.drawImage(avatarImage.image, cx - avatarSize / 2, cy - avatarSize / 2, avatarSize, avatarSize);
        } else {
          drawAgentIcon(context, agent.iconKey, cx, cy, color, selectedAgent);
        }
        context.fillStyle = selectedAgent ? "#ffffff" : color;
        context.font = "850 8px ui-sans-serif, system-ui, sans-serif";
        context.textAlign = "center";
        context.fillText(acronym(agent.label || agent.agentType || "agent", 4), cx, agent.y + agent.height + 13);
        context.textAlign = "left";
        pushHitArea(agent);
        context.restore();
      }

      const serviceNodes = [...graph.nodeById.values()].filter((node) => node.kind === "service");
      for (const sourceService of serviceNodes) {
        const service = renderedNode(sourceService.id);
        if (!service) continue;
        const selectedService = activeSelectedId === service.id;
        context.save();
        context.globalAlpha = nodeAlpha(service.id);
        roundedRect(context, service.x, service.y, service.width, service.height, 9);
        context.fillStyle = selectedService ? COLORS.service : `${COLORS.service}10`;
        context.fill();
        selectionStroke(context, selectedService, COLORS.service);
        context.setLineDash([5, 3]);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = selectedService ? "#ffffff" : COLORS.service;
        context.font = "850 8px ui-sans-serif, system-ui, sans-serif";
        context.fillText(acronym(service.serviceType || "service", 4), service.x + 12, service.y + 17);
        context.fillStyle = selectedService ? "#ffffff" : COLORS.ink;
        context.font = "900 17px ui-sans-serif, system-ui, sans-serif";
        context.textAlign = "center";
        context.fillText(acronym(service.label, 5), service.x + service.width / 2, service.y + 37);
        context.textAlign = "left";
        pushHitArea(service);
        context.restore();
      }

      const aggregateNodes = [...graph.nodeById.values()].filter((node) => node.kind === "aggregate");
      for (const sourceAggregate of aggregateNodes) {
        const aggregate = renderedNode(sourceAggregate.id);
        if (!aggregate) continue;
        const selectedAggregate = activeSelectedId === aggregate.id;
        const color = aggregate.aggregateKind === "agent"
          ? "#4f46e5"
          : aggregate.aggregateKind === "service" ? "#d97706" : "#64748b";
        context.save();
        context.globalAlpha = nodeAlpha(aggregate.id);
        roundedRect(context, aggregate.x, aggregate.y, aggregate.width, aggregate.height, 14);
        context.fillStyle = selectedAggregate ? color : `${color}12`;
        context.fill();
        selectionStroke(context, selectedAggregate, color);
        context.setLineDash([4, 3]);
        context.stroke();
        context.setLineDash([]);
        context.beginPath();
        context.arc(aggregate.x + 27, aggregate.y + aggregate.height / 2, 16, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        context.fillStyle = "#ffffff";
        context.font = "900 17px ui-sans-serif, system-ui, sans-serif";
        context.textAlign = "center";
        context.fillText(aggregate.expanded ? "−" : "+", aggregate.x + 27, aggregate.y + aggregate.height / 2 + 6);
        context.textAlign = "left";
        context.fillStyle = selectedAggregate ? "#ffffff" : COLORS.ink;
        context.font = "850 11px ui-sans-serif, system-ui, sans-serif";
        context.fillText(truncate(aggregate.label, 20), aggregate.x + 52, aggregate.y + 34);
        pushHitArea(aggregate);
        context.restore();
      }

      const hoveredNode = hoveredIdRef.current && hoveredIdRef.current !== activeSelectedId ? renderedNode(hoveredIdRef.current) : null;
      if (hoveredNode) {
        const fullLabel = String(hoveredNode.label || hoveredNode.id);
        const center = staticNodeCenter(hoveredNode);
        context.save();
        context.font = "750 10px ui-sans-serif, system-ui, sans-serif";
        const tooltipWidth = Math.min(260, Math.max(82, context.measureText(fullLabel).width + 18));
        const tooltipX = Math.max(10, Math.min(graph.width - tooltipWidth - 10, center.x - tooltipWidth / 2));
        const tooltipY = Math.max(10, hoveredNode.y - 35);
        roundedRect(context, tooltipX, tooltipY, tooltipWidth, 26, 7);
        context.fillStyle = "rgba(15, 23, 42, 0.94)";
        context.fill();
        context.fillStyle = "#ffffff";
        context.textAlign = "center";
        context.fillText(truncate(fullLabel, 38), tooltipX + tooltipWidth / 2, tooltipY + 17);
        context.restore();
      }

      context.restore();
      positionedRef.current = [...hitAreas];
    };

    fitRef.current = () => dimensions().fitTransform;
    drawRef.current = draw;
    draw();
    const scheduleDraw = () => {
      if (drawFrameRef.current) return;
      drawFrameRef.current = window.requestAnimationFrame(() => {
        drawFrameRef.current = 0;
        draw();
      });
    };
    const keepNodesInWorld = () => {
      for (const node of physicsNodes) {
        const halfWidth = Math.max(12, node.width / 2);
        const halfHeight = Math.max(12, node.height / 2);
        node.x = Math.max(halfWidth + 18, Math.min(graph.width - halfWidth - 18, node.x));
        node.y = Math.max(halfHeight + 18, Math.min(graph.height - halfHeight - 18, node.y));
      }
      scheduleDraw();
    };
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    const simulation = d3.forceSimulation(physicsNodes)
      .force("link", d3.forceLink(physicsLinks)
        .id((node) => node.id)
        .distance(physicsLinkDistance)
        .strength(physicsLinkStrength))
      .force("anchorX", d3.forceX((node) => node.anchorX).strength(0.16))
      .force("anchorY", d3.forceY((node) => node.anchorY).strength(0.13))
      .force("charge", d3.forceManyBody().strength(-132))
      .force("rectCollide", forceRectCollide(20, 5))
      .velocityDecay(0.44)
      .alpha(0.72)
      .on("tick", keepNodesInWorld);
    simulationRef.current = simulation;
    if (reducedMotion) {
      simulation.tick(120);
      simulation.stop();
      keepNodesInWorld();
    }
    const initialDimensions = dimensions();
    const zoomExtent = (measurement) => [Math.max(0.04, measurement.fitTransform.k * 0.5), 2.8];
    const worldPoint = (event) => {
      if (!event) return { x: 0, y: 0 };
      const [screenX, screenY] = d3.pointer(event, canvas);
      const transform = transformRef.current;
      return { x: (screenX - transform.x) / transform.k, y: (screenY - transform.y) / transform.k };
    };
    const forceNodeAt = (point) => [...physicsNodes].reverse().find((node) => {
      const rendered = displayNode(node);
      return hitAreaContains({
        ...rendered,
        cx: rendered.cx,
        cy: rendered.cy,
        radius: nodeRadius(rendered),
        shape: rendered.shape || "rounded-rect"
      }, point.x, point.y);
    }) || null;
    const clampToWorld = (node, point) => {
      const halfWidth = Math.max(12, node.width / 2);
      const halfHeight = Math.max(12, node.height / 2);
      return {
        x: Math.max(halfWidth + 16, Math.min(graph.width - halfWidth - 16, point.x)),
        y: Math.max(halfHeight + 16, Math.min(graph.height - halfHeight - 16, point.y))
      };
    };
    const clampDraggedPoint = (node, point) => {
      let candidate = clampToWorld(node, point);
      const others = physicsNodes.filter((other) => other.id !== node.id);
      for (let pass = 0; pass < Math.max(8, others.length * 4); pass += 1) {
        const overlap = others.find((other) => {
          const otherX = other.fx ?? other.x;
          const otherY = other.fy ?? other.y;
          return Math.abs(candidate.x - otherX) < (node.width + other.width) / 2 + 18
            && Math.abs(candidate.y - otherY) < (node.height + other.height) / 2 + 18;
        });
        if (!overlap) break;
        const otherX = overlap.fx ?? overlap.x;
        const otherY = overlap.fy ?? overlap.y;
        const deltaX = candidate.x - otherX;
        const deltaY = candidate.y - otherY;
        const overlapX = (node.width + overlap.width) / 2 + 18 - Math.abs(deltaX);
        const overlapY = (node.height + overlap.height) / 2 + 18 - Math.abs(deltaY);
        if (overlapX < overlapY) {
          const direction = deltaX === 0 ? (String(node.id) < String(overlap.id) ? -1 : 1) : Math.sign(deltaX);
          candidate = clampToWorld(node, { ...candidate, x: candidate.x + direction * (overlapX + 1) });
        } else {
          const direction = deltaY === 0 ? (String(node.id) < String(overlap.id) ? -1 : 1) : Math.sign(deltaY);
          candidate = clampToWorld(node, { ...candidate, y: candidate.y + direction * (overlapY + 1) });
        }
      }
      return candidate;
    };
    const pan = d3.zoom()
      .filter((event) => {
        if (["wheel", "dblclick"].includes(event.type)) return true;
        if (draggingRef.current) return false;
        return !forceNodeAt(worldPoint(event));
      })
      .scaleExtent(zoomExtent(initialDimensions))
      .extent([[0, 0], [initialDimensions.width, initialDimensions.height]])
      .translateExtent([[-180, -180], [graph.width + 180, graph.height + 180]])
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        draw();
      });
    panRef.current = pan;
    const drag = d3.drag()
      .container(canvas)
      .clickDistance(4)
      .filter((event) => event.button === 0 && Boolean(forceNodeAt(worldPoint(event))))
      .subject((event) => forceNodeAt(worldPoint(event.sourceEvent || event)))
      .on("start", (event) => {
        const node = event.subject;
        if (!node) return;
        draggingRef.current = true;
        suppressCanvasClickRef.current = false;
        setSelectedId(node.id);
        const point = clampDraggedPoint(node, worldPoint(event.sourceEvent || event));
        node.fx = point.x;
        node.fy = point.y;
        if (!event.active) simulation.alphaTarget(0.24).restart();
      })
      .on("drag", (event) => {
        const node = event.subject;
        if (!node) return;
        suppressCanvasClickRef.current = true;
        const point = clampDraggedPoint(node, worldPoint(event.sourceEvent || event));
        node.fx = point.x;
        node.fy = point.y;
        scheduleDraw();
      })
      .on("end", (event) => {
        const node = event.subject;
        if (!node) return;
        const point = clampDraggedPoint(node, { x: node.fx ?? node.x, y: node.fy ?? node.y });
        node.anchorX = point.x;
        node.anchorY = point.y;
        // Keep the node fixed exactly where the user left it. It is released
        // only by the explicit Reset layout action.
        node.fx = point.x;
        node.fy = point.y;
        pinnedPositionsRef.current.set(node.id, point);
        if (!event.active) simulation.alphaTarget(0);
        draggingRef.current = false;
        window.setTimeout(() => { suppressCanvasClickRef.current = false; }, 0);
        scheduleDraw();
      });
    d3.select(canvas).call(pan).property("__zoom", transformRef.current).call(drag);
    const handleResize = () => {
      fitRequestedRef.current = true;
      const measurement = dimensions();
      pan
        .scaleExtent(zoomExtent(measurement))
        .extent([[0, 0], [measurement.width, measurement.height]]);
      draw();
    };
    window.addEventListener("resize", handleResize);
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(handleResize) : null;
    resizeObserver?.observe(viewport);
    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      if (drawFrameRef.current) window.cancelAnimationFrame(drawFrameRef.current);
      d3.select(canvas).on(".zoom", null).on(".drag", null);
      simulation.stop();
      if (simulationRef.current === simulation) simulationRef.current = null;
      if (physicsNodesRef.current === physicsNodesById) physicsNodesRef.current = new Map();
      if (panRef.current === pan) panRef.current = null;
      if (drawRef.current === draw) drawRef.current = () => {};
    };
  }, [agentAvatarByNodeId, deliveryTimeline, graph, map.projectName, showDetail]);

  const canvasHit = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const [screenX, screenY] = d3.pointer(event, canvas);
    const transform = transformRef.current;
    const x = (screenX - transform.x) / transform.k;
    const y = (screenY - transform.y) / transform.k;
    return [...positionedRef.current].reverse().find((area) => hitAreaContains(area, x, y)) || null;
  };

  const selectCanvasItem = (event) => {
    if (suppressCanvasClickRef.current) return;
    const hit = canvasHit(event);
    const node = hit ? graph.nodeById.get(hit.id) : null;
    if (node?.kind === "aggregate") {
      setExpandedGroups((current) => {
        const next = new Set(current);
        if (next.has(node.aggregateGroupKey)) next.delete(node.aggregateGroupKey);
        else next.add(node.aggregateGroupKey);
        return next;
      });
    }
    setSelectedId(hit?.id || "");
  };

  const previewCanvasItem = (event) => {
    if (draggingRef.current) return;
    const nextId = canvasHit(event)?.id || "";
    if (hoveredIdRef.current === nextId) return;
    hoveredIdRef.current = nextId;
    if (canvasRef.current) canvasRef.current.style.cursor = nextId ? "pointer" : "grab";
    drawRef.current();
  };

  const clearCanvasPreview = () => {
    if (!hoveredIdRef.current) return;
    hoveredIdRef.current = "";
    drawRef.current();
  };

  const navigateCanvasItem = (event) => {
    if (!keyboardNodeIds.length) return;
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = keyboardNodeIds.indexOf(selectedId);
    if (event.key === "Home") {
      setSelectedId(keyboardNodeIds[0]);
      return;
    }
    if (event.key === "End") {
      setSelectedId(keyboardNodeIds[keyboardNodeIds.length - 1]);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      setSelectedId(currentIndex >= 0 ? keyboardNodeIds[currentIndex] : keyboardNodeIds[0]);
      return;
    }
    const nextIndex = currentIndex < 0
      ? forward ? 0 : keyboardNodeIds.length - 1
      : (currentIndex + (forward ? 1 : -1) + keyboardNodeIds.length) % keyboardNodeIds.length;
    setSelectedId(keyboardNodeIds[nextIndex]);
  };

  const fitGraph = () => {
    const transform = fitRef.current();
    transformRef.current = transform;
    setSelectedId("");
    if (canvasRef.current && panRef.current) d3.select(canvasRef.current).call(panRef.current.transform, transform);
    else drawRef.current();
  };

  const zoomGraph = (factor) => {
    if (!canvasRef.current || !panRef.current) return;
    d3.select(canvasRef.current)
      .transition()
      .duration(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? 0 : 140)
      .call(panRef.current.scaleBy, factor);
  };

  const resetLayout = () => {
    pinnedPositionsRef.current = new Map();
    const simulation = simulationRef.current;
    for (const node of physicsNodesRef.current.values()) {
      const staticNode = graph.nodeById.get(node.id);
      if (!staticNode) continue;
      const anchor = staticNodeCenter(staticNode);
      node.anchorX = anchor.x;
      node.anchorY = anchor.y;
      node.x = node.anchorX;
      node.y = node.anchorY;
      node.fx = null;
      node.fy = null;
      node.vx = 0;
      node.vy = 0;
    }
    simulation?.alpha(0.9).restart();
    fitGraph();
  };

  const resetView = () => {
    hoveredIdRef.current = "";
    setSelectedId("");
    setTracePath(false);
    fitGraph();
  };

  const expandSelectedNeighbours = () => {
    if (!selected) return;
    const keys = new Set();
    if (selected.kind === "aggregate" && selected.aggregateGroupKey) keys.add(selected.aggregateGroupKey);
    for (const link of fullGraph.links) {
      if (link.source !== selected.id && link.target !== selected.id) continue;
      const peerId = link.source === selected.id ? link.target : link.source;
      const key = graph.hiddenNodeGroups?.get(peerId);
      if (key) keys.add(key);
    }
    if (!keys.size) return;
    setExpandedGroups((current) => new Set([...current, ...keys]));
  };

  const collapseSelectedBranch = () => {
    if (!selected) return;
    const keys = new Set(selected.aggregateGroupKey ? [selected.aggregateGroupKey] : []);
    for (const link of fullGraph.links) {
      if (link.source !== selected.id && link.target !== selected.id) continue;
      const peerId = link.source === selected.id ? link.target : link.source;
      const key = graph.nodeById.get(peerId)?.aggregateGroupKey;
      if (key) keys.add(key);
    }
    if (!keys.size) return;
    setExpandedGroups((current) => {
      const next = new Set(current);
      for (const key of keys) next.delete(key);
      return next;
    });
  };

  const focusSelectedNode = () => {
    if (!selectedId || !canvasRef.current || !viewportRef.current || !panRef.current) return;
    const physicsNode = physicsNodesRef.current.get(selectedId);
    const staticNode = graph.nodeById.get(selectedId);
    const center = physicsNode
      ? { x: physicsNode.x, y: physicsNode.y }
      : staticNode ? staticNodeCenter(staticNode) : null;
    if (!center) return;
    const scale = Math.min(2.8, Math.max(1.25, transformRef.current.k));
    const transform = d3.zoomIdentity
      .translate(viewportRef.current.clientWidth / 2 - center.x * scale, viewportRef.current.clientHeight / 2 - center.y * scale)
      .scale(scale);
    d3.select(canvasRef.current).transition().duration(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? 0 : 180).call(panRef.current.transform, transform);
  };

  useEffect(() => {
    if (!showDetail || !selectedId || pendingSearchFocusRef.current !== selectedId || !graph.nodeById.has(selectedId)) return undefined;
    const frame = window.requestAnimationFrame(() => {
      focusSelectedNode();
      pendingSearchFocusRef.current = "";
    });
    return () => window.cancelAnimationFrame(frame);
  }, [graph, selectedId, showDetail]);

  const searchNodes = useMemo(
    () => [...fullGraph.nodeById.values()].sort((left, right) => String(left.label || left.id).localeCompare(String(right.label || right.id))),
    [fullGraph]
  );
  const applyNodeSearch = () => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return;
    const match = searchNodes.find((node) => String(node.label || "").toLowerCase() === query || String(node.id).toLowerCase() === query)
      || searchNodes.find((node) => String(node.label || node.id).toLowerCase().includes(query));
    if (!match) return;
    const groupKey = graph.hiddenNodeGroups?.get(match.id);
    if (groupKey) setExpandedGroups((current) => new Set([...current, groupKey]));
    setShowInactive(true);
    pendingSearchFocusRef.current = match.id;
    setSelectedId(match.id);
    fitRequestedRef.current = true;
  };

  const resetGraphFilters = () => {
    setExpandedGroups(new Set());
    setRelationshipFilter("primary");
    setGroupBy("type");
    setDepth("all");
    setShowInactive(true);
    setSearchTerm("");
    setTracePath(false);
    setSelectedId("");
    fitRequestedRef.current = true;
  };

  const selectedKind = selected?.kind === "build-event"
    ? "Recorded build event"
    : selected?.kind === "functionality"
      ? "Functionality"
      : selected?.kind === "decision-option"
        ? "Decision outcome"
        : selected?.kind === "aggregate"
          ? "Collapsed group"
        : selected?.kind || "";

  const briefEvents = [...asArray(deliveryTimeline.eventNodes)].sort(eventOrder).slice(0, 3);
  const additionalBriefEventCount = Math.max(0, deliveryTimeline.summary.buildEventNodeCount - briefEvents.length);
  const anticipatedFunctionalityCount = deliveryTimeline.rows.filter((row) => row.timeline?.historicalClaim === false).length;
  const renderApplicationLogo = (className = "") => (
    <span className={`application-decision-map-app-logo ${className}`.trim()} aria-hidden="true">
      {resolvedApplicationLogoUrl && applicationLogoState !== "error"
        ? <img src={resolvedApplicationLogoUrl} alt="" onError={() => setApplicationLogoState("error")} />
        : <b>{acronym(map.projectName, 3)}</b>}
    </span>
  );
  const openDetail = (event) => {
    if (event?.currentTarget) expandTriggerRef.current = event.currentTarget;
    setShowDetail(true);
  };
  const closeDetail = () => setShowDetail(false);
  const trapDetailFocus = (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")]
      .filter((element) => !element.hasAttribute("disabled"));
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
  const insightPanel = (
    <aside className="application-decision-map-inspector" aria-live="polite">
      {selectedInsight ? <>
        <header className="application-decision-map-insight-heading">
          <span className={`application-decision-map-kind is-${selectedInsight.kind}`}>{selectedKind}</span>
          <div>
            <small>Insight details</small>
            <strong>{selectedInsight.title}</strong>
          </div>
        </header>
        <div className="application-decision-map-inspector-actions" aria-label="Selected node actions">
          <button type="button" onClick={expandSelectedNeighbours}>Expand neighbours</button>
          <button type="button" onClick={collapseSelectedBranch}>Collapse branch</button>
          <button type="button" className={tracePath ? "is-active" : ""} aria-pressed={tracePath} onClick={() => setTracePath((current) => !current)}>Trace path</button>
          <button type="button" onClick={focusSelectedNode}>Focus node</button>
          <button type="button" onClick={() => setSelectedId("")}>Clear selection</button>
        </div>
        <p className="application-decision-map-insight-summary">{selectedInsight.summary}</p>
        {selectedInsight.anticipatedChronologyOnly ? <p className="application-decision-map-insight-notice is-anticipated"><strong>Anticipated chronology only.</strong> This application has no recorded functionality chronology. Where explicit, highlighted dashed segue arrows show source-derived order and do not claim delivery history.</p> : null}
        {selectedBuildOptionLink ? <p className="application-decision-map-insight-notice">{selectedBuildOptionLink.chronologyClaim ? "This outcome is directly branched from an exact recorded build/workflow reference." : "This outcome shares build context with the functionality; its own decision time is not claimed."}</p> : null}
        {selectedInsight.warnings.length ? <ul className="application-decision-map-insight-warnings">{selectedInsight.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        <div className="application-decision-map-insight-grid">
          {selectedInsight.fields.length ? <section>
            <h4>Record</h4>
            <dl>{selectedInsight.fields.map((field) => <div key={`${field.label}:${field.value}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
          </section> : null}
          {selectedInsight.chronology.length ? <section>
            <h4>Timeline</h4>
            <dl>{selectedInsight.chronology.map((item) => <div key={`${item.label}:${item.value}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          </section> : null}
          {selectedInsight.evidence.length ? <section>
            <h4>Evidence</h4>
            <ul>{selectedInsight.evidence.map((item, index) => <li key={`${item.kind}:${item.reference}:${index}`}><span>{item.kind.replaceAll("_", " ")}</span>{item.reference}</li>)}</ul>
          </section> : null}
          {selectedInsight.relationships.length ? <section>
            <h4>Connected nodes</h4>
            <ul>{selectedInsight.relationships.map((relationship) => <li key={relationship.id}><strong>{relationship.label}</strong><span>{relationship.targetLabel}</span><small>{relationship.provenance.replaceAll("_", " ")}</small></li>)}</ul>
          </section> : null}
        </div>
      </> : <>
        {appChronologyAnticipatedOnly ? <p className="application-decision-map-insight-notice is-anticipated"><strong>Anticipated chronology only.</strong> This application has no recorded functionality chronology. Select a node to inspect the source-order basis.</p> : null}
        <p className="application-decision-map-insight-empty">Choose a build event, functionality, decision outcome, agent, or service node to inspect its full record, timeline, evidence, and relationships.</p>
      </>}
    </aside>
  );
  const detailModal = showDetail && typeof document !== "undefined" && deliveryTimeline.rows.length ? createPortal(
    <div className="application-decision-map-detail-backdrop" role="presentation" onMouseDown={closeDetail}>
      <section className="application-decision-map-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="application-decision-map-detail-heading" onMouseDown={(event) => event.stopPropagation()} onKeyDown={trapDetailFocus}>
        <header className="application-decision-map-detail-header">
          <div>
            <span>Delivery decision graph · detail</span>
            <h3 id="application-decision-map-detail-heading" className="application-decision-map-app-title">
              {renderApplicationLogo("is-detail")}
              <b>{map.projectName} delivery relationships</b>
            </h3>
            <p>Build events, functionality, outcomes, agents, and services use the full canvas. Node labels are compact acronyms; select one for its full name and evidence. Drag to pan or reposition, and use the controls to zoom.</p>
          </div>
          <div className="application-decision-map-detail-actions">
            <button type="button" onClick={() => zoomGraph(0.8)} aria-label="Zoom out delivery decision graph">− Zoom</button>
            <button type="button" onClick={() => zoomGraph(1.25)} aria-label="Zoom in delivery decision graph">+ Zoom</button>
            <button type="button" onClick={fitGraph}>Fit graph</button>
            <button type="button" onClick={resetView}>Reset view</button>
            <button type="button" onClick={resetLayout}>Reset layout</button>
            <button ref={detailCloseRef} type="button" onClick={closeDetail} aria-label="Close delivery decision graph detail">Close</button>
          </div>
        </header>
        <div className="application-decision-map-toolbar" role="toolbar" aria-label="Delivery graph controls">
          <form onSubmit={(event) => { event.preventDefault(); applyNodeSearch(); }}>
            <label htmlFor="application-decision-map-search">Search nodes</label>
            <input id="application-decision-map-search" list="application-decision-map-search-options" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Name or ID" />
            <datalist id="application-decision-map-search-options">{searchNodes.slice(0, 120).map((node) => <option key={node.id} value={node.label || node.id} />)}</datalist>
            <button type="submit">Find</button>
          </form>
          <label>Group
            <select value={groupBy} onChange={(event) => { setGroupBy(event.target.value); setExpandedGroups(new Set()); }}>
              <option value="type">Type</option>
              <option value="module">Module</option>
              <option value="status">Status</option>
            </select>
          </label>
          <label>Depth
            <select value={depth} onChange={(event) => setDepth(event.target.value)}>
              <option value="1">1 hop</option>
              <option value="2">2 hops</option>
              <option value="all">All</option>
            </select>
          </label>
          <label>Relationships
            <select value={relationshipFilter} onChange={(event) => setRelationshipFilter(event.target.value)}>
              <option value="primary">Primary</option>
              <option value="dependencies">Dependencies</option>
              <option value="evidence">Evidence</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="application-decision-map-toggle"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Show inactive</label>
          <span className="application-decision-map-visible-count"><b>{graph.visibleNodeCount}</b> / {graph.sourceNodeCount} nodes</span>
          <button type="button" aria-expanded={legendOpen} onClick={() => setLegendOpen((current) => !current)}>Legend</button>
          <button type="button" onClick={resetGraphFilters}>Reset filters</button>
        </div>
        <div className="application-decision-map-detail-body">
          <div className="application-decision-map-layout">
            <div className="application-decision-map-viewport" ref={viewportRef}>
              <canvas ref={canvasRef} tabIndex="0" onClick={selectCanvasItem} onMouseMove={previewCanvasItem} onMouseLeave={clearCanvasPreview} onKeyDown={navigateCanvasItem} aria-describedby="application-decision-map-keyboard-help" aria-label={`${map.projectName} build event decision graph with functionality, agent, service, and decision outcome nodes`} />
              <small id="application-decision-map-keyboard-help">Select a node for its full name and evidence · drag nodes to reposition · drag open space to pan · scroll, double-click, or use Zoom controls to change scale · use arrow keys to inspect nodes</small>
              {legendOpen ? <div className="application-decision-map-detail-legend" aria-label="Graph legend">
                <strong>Legend</strong>
                <span><i className="is-orchestrator" /> Build / orchestrator</span>
                <span><i className="is-agent" /> Functionality / agent</span>
                <span><i className="is-tool" /> Tool / API</span>
                <span><i className="is-evidence" /> Decision / evidence</span>
                <small>Thin grey lines are normal relationships. Selected paths use category colour.</small>
              </div> : null}
            </div>
          </div>
          {insightPanel}
        </div>
      </section>
    </div>,
    document.body
  ) : null;

  return (
    <section className="application-decision-map" aria-labelledby="application-decision-map-heading">
      <header>
        <div>
          <span>Delivery decision graph</span>
          <h3 id="application-decision-map-heading">Build events branch into functionality, decisions, and agents</h3>
          <p>Every visible line is an explicit relationship: a completed build establishes a functionality, then selected, deferred, and rejected outcomes branch from that build context. Directional segue arrows connect only recorded or explicitly anticipated chronology.</p>
        </div>
        <div className="application-decision-map-summary" aria-label="Decision map summary">
          <span><b>{deliveryTimeline.summary.buildEventNodeCount}</b> build events</span>
          <span><b>{deliveryTimeline.summary.buildEventFunctionalityLinkCount}</b> build links</span>
          <span><b>{deliveryTimeline.summary.branchedSelectedOptionCount}</b> selected</span>
          <span><b>{deliveryTimeline.summary.branchedDeferredOptionCount}</b> deferred</span>
          <span><b>{deliveryTimeline.summary.branchedRejectedOptionCount}</b> rejected</span>
          <span><b>{map.summary.agentCount}</b> agent nodes</span>
          <span><b>{map.summary.functionalityDependencyCount}</b> functionality links</span>
          <button type="button" onClick={openDetail} disabled={!deliveryTimeline.rows.length}>Expand graph</button>
        </div>
      </header>
      {topologyState === "loading" ? <p className="application-decision-map-status" role="status">Loading recorded ownership and dependency topology…</p> : null}
      {topologyState === "error" ? <p className="application-decision-map-status is-error">Topology could not be loaded. Exact analysis assignments remain visible; topology ownership and dependency links are unavailable.</p> : null}
      {currentTimelineState === "loading" ? <p className="application-decision-map-status" role="status">Loading project build timeline…</p> : null}
      {currentTimelineState === "error" ? <p className="application-decision-map-status is-error">Build history could not be loaded. Source-derived functionality and option relationships remain available without claiming delivery history.</p> : null}
      {currentTimelineState === "ready" && !deliveryTimeline.summary.hasRecordedChronology && deliveryTimeline.summary.unsequencedRecordCount ? <p className="application-decision-map-status">{deliveryTimeline.summary.unsequencedRecordCount} matching completed build record{deliveryTimeline.summary.unsequencedRecordCount === 1 ? " has" : "s have"} no usable event time, so {deliveryTimeline.summary.unsequencedRecordCount === 1 ? "it remains" : "they remain"} explicitly unsequenced.</p> : null}
      {currentTimelineState === "ready" && deliveryTimeline.summary.hasRecordedEvidence && deliveryTimeline.summary.unmatchedBuildCount ? <p className="application-decision-map-status">{deliveryTimeline.summary.unmatchedBuildCount} completed build record{deliveryTimeline.summary.unmatchedBuildCount === 1 ? "" : "s"} could not be safely linked to a functionality and remain unassigned.</p> : null}
      {!deliveryTimeline.rows.length ? <p className="application-decision-map-status">Run application analysis to populate source-backed functionality decisions.</p> : (
        <div className="application-decision-map-brief">
          <div className="application-decision-map-brief-copy">
            <span>Brief delivery view</span>
            <strong className="application-decision-map-app-title">
              {renderApplicationLogo("is-brief")}
              <b>{map.projectName} relationship overview</b>
            </strong>
            <p>Build clusters are ordered by evidence. The full graph keeps the same explicit links without pinning node kinds into columns.</p>
            <div className="application-decision-map-brief-flow" aria-label="Build event, functionality, decision outcome, and agent relationship summary">
              <span><b>{deliveryTimeline.summary.buildEventNodeCount}</b> build events</span><i aria-hidden="true">→</i>
              <span><b>{map.summary.functionalityCount}</b> functions</span><i aria-hidden="true">→</i>
              <span><b>{deliveryTimeline.summary.branchedSelectedOptionCount + deliveryTimeline.summary.branchedDeferredOptionCount + deliveryTimeline.summary.branchedRejectedOptionCount}</b> outcomes</span><i aria-hidden="true">→</i>
              <span><b>{map.summary.agentCount}</b> agents</span>
            </div>
          </div>
          <div className="application-decision-map-brief-events">
            {briefEvents.length ? briefEvents.map((event) => <span key={event.id} className={event.historicalClaim ? "is-recorded" : "is-anticipated"}><b>{event.historicalClaim ? `Build ${event.buildIndex || ""}` : "Plan"}</b>{truncate(event.label, 24)}</span>) : <span className="is-anticipated"><b>Plan</b>{anticipatedFunctionalityCount} anticipated functionality node{anticipatedFunctionalityCount === 1 ? "" : "s"}</span>}
            {additionalBriefEventCount ? <small>+{additionalBriefEventCount} more recorded build event{additionalBriefEventCount === 1 ? "" : "s"}</small> : null}
          </div>
          <button type="button" className="application-decision-map-expand" onClick={openDetail}>
            <span>Expand delivery decision graph</span>
            <small>Open the full interactive map</small>
          </button>
        </div>
      )}
      <footer><span className="map-key recorded" /> Recorded build → functionality <span className="map-key chronology" /> Recorded chronology segue <span className="map-key anticipated" /> Anticipated chronology segue · not history <span className="map-key selected" /> Recorded selected branch <span className="map-key deferred" /> Recorded deferred branch <span className="map-key rejected" /> Recorded rejected branch <span className="map-key ownership" /> Recorded agent owner <span className="map-key assignment" /> Analysis assignment <span className="map-key functionality-link" /> Exact functionality dependency <span className="map-key dependency" /> Supporting dependency</footer>
      {detailModal}
    </section>
  );
}
