import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../src/components/agentic-system/ApplicationDecisionMappingCanvas.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/components/agentic-system/applicationDecisionMappingCanvas.css", import.meta.url), "utf8");

test("delivery detail supports canvas zoom, background pan, node drag, and fixed manual positions", () => {
  assert.ok(component.includes('["wheel", "dblclick"].includes(event.type)) return true'));
  assert.ok(component.includes("scroll, double-click, or use Zoom controls"));
  assert.ok(component.includes("panRef.current.scaleBy, factor"));
  assert.ok(component.includes('aria-label="Zoom out delivery decision graph"'));
  assert.ok(component.includes('aria-label="Zoom in delivery decision graph"'));
  assert.ok(component.includes("node.fx = point.x"));
  assert.ok(component.includes("node.fy = point.y"));
  assert.ok(component.includes("return !forceNodeAt(worldPoint(event))"));
  assert.ok(component.includes("Boolean(forceNodeAt(worldPoint(event)))"));
  assert.equal(component.includes('.force("laneX"'), false);
  assert.equal(component.includes('.force("laneY"'), false);
  assert.match(styles, /\.application-decision-map-viewport \{[^}]*overflow: hidden;/);
});

test("delivery detail favors larger acronym nodes and thin relationship connectors", () => {
  assert.ok(component.includes("const FUNCTIONALITY_WIDTH = 220"));
  assert.ok(component.includes("const OPTION_SIZE = 62"));
  assert.ok(component.includes("const AGENT_SIZE = 84"));
  assert.ok(component.includes("acronym(event.label, 5)"));
  assert.ok(component.includes("acronym(functionality.label, 5)"));
  assert.ok(component.includes("acronym(service.label, 5)"));
  assert.ok(component.includes("highlighted ? 1.5 : connected ? 0.5 : 0.22"));
});

test("delivery detail prevents rectangular overlap and uses category and application artwork", () => {
  assert.ok(component.includes('.force("rectCollide", forceRectCollide(20, 5))'));
  assert.ok(component.includes("const clampDraggedPoint = (node, point) =>"));
  assert.ok(component.includes("(node.width + other.width) / 2 + 18"));
  assert.equal(component.includes('.force("collide", d3.forceCollide'), false);
  assert.ok(component.includes('iconKey === "orchestrator"'));
  assert.ok(component.includes('iconKey === "controller"'));
  assert.ok(component.includes('context.fillText("Q"'));
  assert.ok(component.includes("functionalityIconKey(functionality)"));
  assert.ok(component.includes("drawFunctionalityIcon(context"));
  assert.ok(component.includes("resolvePortfolioAppIconUrl"));
  assert.ok(component.includes("drawApplicationLogo(context, applicationLogoRef.current"));
  assert.ok(component.includes('fetch(`${BACKEND_URL}/api/agents/global`'));
  assert.ok(component.includes("agentAvatarDataUrl(visual)"));
  assert.ok(component.includes("agentAvatarImagesRef.current.get(avatar.dataUrl)"));
  assert.match(styles, /\.application-decision-map-app-logo \{/);
});

test("delivery service relationships use storyboard-style segue connectors", () => {
  assert.ok(component.includes("function drawServiceSegue(context, source, target"));
  assert.ok(component.includes("context.arc(badge.x, badge.y, 9"));
  assert.ok(component.includes("drawServiceSegue(context, source, target"));
  assert.ok(component.includes("Math.PI / 4) * arrowSize"));
});

test("delivery detail exposes progressive disclosure, filters, search, hover preview, and inspector actions", () => {
  assert.ok(component.includes("buildDeliveryGraphView(fullGraph"));
  assert.ok(component.includes('setRelationshipFilter("primary")'));
  assert.ok(component.includes('setGroupBy("type")'));
  assert.ok(component.includes("Expand neighbours"));
  assert.ok(component.includes("Collapse branch"));
  assert.ok(component.includes("Trace path"));
  assert.ok(component.includes("Focus node"));
  assert.ok(component.includes("Clear selection"));
  assert.ok(component.includes("onMouseMove={previewCanvasItem}"));
  assert.ok(component.includes("Reset filters"));
  assert.match(styles, /\.application-decision-map-toolbar \{/);
  assert.match(styles, /\.application-decision-map-detail-legend \{/);
});

test("delivery detail removes synthetic header and plan nodes and renders direct chronology segues", () => {
  assert.equal(component.includes('context.fillText("DELIVERY DECISION GRAPH"'), false);
  assert.equal(component.includes("Anticipated delivery plan"), false);
  assert.equal(component.includes("anticipated-functionality"), false);
  assert.ok(component.includes("buildDeliveryChronologyLinks(rows)"));
  assert.ok(component.includes('link.kind === "chronology-segue"'));
  assert.ok(component.includes("drawChronologySegue(context, source, target"));
  assert.ok(component.includes("if (!group.historicalClaim) continue"));
});
