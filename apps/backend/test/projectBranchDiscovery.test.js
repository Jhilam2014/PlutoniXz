import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDecisionContinuityStore } from "../src/decisionContinuity.js";
import { buildProjectAgentTopology } from "../src/projectAgents.js";
import {
  analyzeProjectArchitecture,
  deriveProjectObjectives,
  estimateCyclomaticComplexity,
  publishArchitectureBranches,
  publicArchitectureAnalysis,
  readProjectArchitectureAnalysis,
  redactSecretShapedValues,
  scoreArchitectureAlternative,
  writeProjectArchitectureAnalysis
} from "../src/projectBranchDiscovery.js";

test("source-evidenced architecture discovery emits real UI, routes, and database records without generic signals", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-architecture-discovery-"));
  const workspaceDir = path.join(root, "workspace");
  await fs.mkdir(path.join(workspaceDir, "src"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "src", "pages"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "src", "services"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "src", "repositories"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "tests"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, ".env"), "OPENAI_API_KEY=super-secret-value\n");
  await fs.writeFile(path.join(workspaceDir, "src", "App.jsx"), "import React from 'react'; import { OrdersPage } from './pages/OrdersPage'; export function App() { return <main><OrdersPage /></main>; }\n");
  await fs.writeFile(path.join(workspaceDir, "src", "pages", "OrdersPage.jsx"), "import { loadOrders } from '../services/ordersClient'; export function OrdersPage() { return <section><button aria-label='Load orders' onClick={loadOrders}>Load</button></section>; }\n");
  await fs.writeFile(path.join(workspaceDir, "src", "services", "ordersClient.js"), "export function loadOrders() { return fetch('/api/orders'); }\n");
  await fs.writeFile(path.join(workspaceDir, "src", "db.js"), "import { PrismaClient } from '@prisma/client'; export const prisma = new PrismaClient();\n");
  await fs.writeFile(path.join(workspaceDir, "src", "repositories", "orderRepository.js"), "import { prisma } from '../db'; export async function listOrdersFromDb() { return prisma.order.findMany(); }\n");
  await fs.writeFile(path.join(workspaceDir, "src", "services", "orderService.js"), "import { listOrdersFromDb } from '../repositories/orderRepository'; export async function listOrders() { return listOrdersFromDb(); }\n");
  await fs.writeFile(path.join(workspaceDir, "src", "server.js"), "import { listOrders } from './services/orderService'; app.get('/api/orders', async () => listOrders());\n");
  await fs.writeFile(path.join(workspaceDir, "schema.prisma"), "datasource db { provider = \"sqlite\" url = \"file:dev.db\" }\nmodel Order { id String @id }\n");
  await fs.writeFile(path.join(workspaceDir, "tests", "orders.test.js"), "test('orders', () => {});\n");
  await fs.writeFile(path.join(workspaceDir, "docker-compose.yml"), "services:\n  app:\n    image: node:22\n");
  const project = {
    id: "imported-orders",
    name: "Imported orders",
    folderName: "imported-orders",
    workspaceDir,
    port: 5300,
    status: "running",
    provenance: { origin: "imported", recordedAt: "2026-08-20T00:00:00.000Z", source: "plutonix_project_import" }
  };
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await analyzeProjectArchitecture({
    project,
    env: { PROJECT_BRANCH_DISCOVERY_MODEL_ASSIST_ENABLED: "true", OPENAI_API_KEY: "test-key", OPENAI_DEFAULT_MODEL: "test-model" },
    modelRunner: async () => {
      const error = new Error("simulated timeout");
      error.name = "AbortError";
      throw error;
    }
  });

  assert.equal(report.modelAssist.status, "timed_out");
  assert.equal(report.projectOrigin, "imported");
  assert.ok(report.functionalities.some((item) => item.category === "ui"));
  assert.ok(report.functionalities.some((item) => item.category === "api"));
  assert.ok(report.functionalities.some((item) => item.category === "data"));
  assert.ok(report.functionalities.some((item) => item.entityType === "ui_surface" && item.label === "App"));
  assert.ok(report.functionalities.some((item) => item.entityType === "ui_element" && item.label === "Load orders"));
  assert.ok(report.functionalities.some((item) => item.entityType === "ui_feature" && item.label === "Load Orders"));
  assert.ok(report.functionalities.some((item) => item.entityType === "api_route" && item.label === "GET /api/orders"));
  assert.ok(report.functionalities.some((item) => item.entityType === "database_connection"));
  assert.ok(report.functionalities.some((item) => item.entityType === "database_table" && item.label === "Table: Order"));
  assert.ok(report.functionalities.some((item) => item.entityType === "service" && /OrderService/i.test(item.label)));
  assert.ok(report.functionalities.every((item) => !/(?:UI surface|Data boundary|Integration boundary|Security boundary|Test coverage|Runtime configuration|API contract) in/i.test(item.label)));
  assert.ok(report.functionalities.every((item) => item.metrics?.cyclomaticComplexity >= 1));
  assert.ok(report.functionalities.every((item) => item.metrics?.relativeCyclomaticComplexity > 0));
  assert.ok(report.functionalities.every((item) => item.observedCurrent?.inferenceRole === "observed_current" && item.observedCurrent?.sourceOnly), "static source scans expose observations, not historical decisions");
  assert.ok(report.functionalities.every((item) => item.subfunctionalities?.length === 0), "typed application entities do not acquire fabricated code-unit children");
  assert.ok(!report.sourceFiles.some((item) => item.path === ".env"));
  assert.ok(report.objectives.length >= 1, "connected source entities are grouped into project objectives");
  assert.ok(report.majorFunctionalities.length < report.functionalities.length, "elementary observations are retained as features rather than ledger-sized functionalities");
  assert.ok(report.majorFunctionalities.every((item) => item.objectiveId && Array.isArray(item.features)));
  assert.ok(report.majorFunctionalities.some((item) => item.features.some((feature) => feature.label === "Load orders")), "the UI element remains visible beneath its coordinated major functionality");
  assert.ok(report.candidates.length > 0, "alternatives are evaluated at the major-functionality level");
  assert.ok(report.candidates.every((candidate) => report.majorFunctionalities.some((item) => item.id === candidate.functionalityId)));
  assert.ok(report.applicationLinks.some((link) => link.type === "ui_calls_api"));
  assert.ok(report.applicationLinks.some((link) => link.type === "contains_feature"));
  assert.ok(report.applicationLinks.some((link) => link.type === "contains_ui_element"));
  assert.ok(report.applicationLinks.some((link) => link.type === "has_ui_feature"));
  assert.ok(report.applicationLinks.some((link) => link.type === "ui_uses_service"));
  assert.ok(report.applicationLinks.some((link) => link.type === "api_calls_service"));
  assert.ok(report.applicationLinks.some((link) => link.type === "service_uses_service"));
  assert.ok(report.applicationLinks.some((link) => link.type === "service_uses_database"));
  const importedUiCall = report.applicationLinks.find((link) => link.type === "ui_calls_api");
  assert.ok(importedUiCall.evidence.length >= 2, "the page-to-API relationship retains both client-call and import-chain evidence");
  const byLabel = new Map(report.functionalities.map((item) => [item.label, item]));
  assert.equal(byLabel.get("OrdersPage")?.parentEntityId, byLabel.get("App")?.id);
  assert.equal(byLabel.get("Load orders")?.parentEntityId, byLabel.get("OrdersPage")?.id);
  assert.equal(byLabel.get("Load Orders")?.parentEntityId, byLabel.get("Load orders")?.id);
  assert.equal(byLabel.get("GET /api/orders")?.parentEntityId, byLabel.get("OrdersPage")?.id);
  assert.equal(byLabel.get("OrderService Service")?.parentEntityId, byLabel.get("GET /api/orders")?.id);
  assert.equal(byLabel.get("OrderRepository Service")?.parentEntityId, byLabel.get("OrderService Service")?.id);
  assert.deepEqual(report.functionalities.map((item) => item.chronology?.order).sort((left, right) => left - right), report.functionalities.map((_item, index) => index));
  assert.deepEqual(report.functionalities.map((item) => item.chronology?.deliveryOrder).sort((left, right) => left - right), report.functionalities.map((_item, index) => index + 1));
  assert.ok(report.functionalities.every((item) => item.chronology?.basis === "dependency_aware_delivery_inference" && item.chronology?.inferred));
  assert.ok(byLabel.get("GET /api/orders")?.chronology?.deliveryOrder < byLabel.get("OrdersPage")?.chronology?.deliveryOrder, "API delivery precedes its UI consumer");
  assert.ok(report.functionalities.every((item) => item.hierarchyDepth >= 1 && item.metrics?.connectorCount >= 0));
  assert.equal(redactSecretShapedValues("API_KEY=leak-me-now").includes("leak-me-now"), false);
  assert.ok(estimateCyclomaticComplexity("if (ready && allowed) { for (const row of rows) {} }") > estimateCyclomaticComplexity("return value;"));

  const lowValue = scoreArchitectureAlternative({
    evidenceCoverage: 0.1, functionalityFit: 0.1, compatibilityFeasibility: 0.1, reversibility: 0.1, maintainability: 0.1,
    estimatedChangeCost: 1, dataMigrationRisk: 1, dependencyOperationalRisk: 1, uncertainty: 1
  });
  assert.ok(lowValue.score < 0.60);

  const topology = buildProjectAgentTopology(project, { discoveredFunctionalities: report.functionalities, applicationLinks: report.applicationLinks, analysis: { sourceDigest: report.sourceDigest } });
  assert.equal(topology.functionalities.length, report.functionalities.length);
  assert.equal(topology.subfunctionalities.length, 0);
  assert.equal(topology.applicationLinks.length, report.applicationLinks.length);
  assert.equal(topology.applicationLinks.filter((link) => link.hierarchy).length, report.applicationLinks.filter((link) => link.hierarchy).length);
  assert.ok(topology.relationships.some((relationship) => relationship.type === "IMPLEMENTS"));
  assert.ok(topology.functionalityAssignments.some((assignment) => assignment.assignment === "reused" || assignment.assignment === "created"));

  const store = createDecisionContinuityStore({ root, adapter: "file", environment: "test" });
  const branches = await publishArchitectureBranches({
    report,
    store,
    tenantId: "tenant-a",
    workspaceId: project.id,
    actor: { type: "user", id: "proposer" },
    principalId: "proposer"
  });
  assert.ok(branches.some((branch) => branch.inferenceRole === "observed_current"));
  assert.equal(branches.filter((branch) => branch.inferenceRole === "observed_current").length, report.majorFunctionalities.length, "only major functionalities receive current decision branches");
  assert.ok(branches.some((branch) => branch.inferenceRole === "anticipated_alternative"), "evidence-backed alternatives are retained beneath the major functionality without implying a historical disposition");
  const ledger = await store.listBranches({ tenantId: "tenant-a", workspaceId: project.id, limit: 250 });
  assert.ok(ledger.every((branch) => branch.candidate?.inferenceRole !== "anticipated_alternative" || branch.status === "candidate"), "anticipated alternatives remain candidates; source analysis does not infer a deferred disposition");
  assert.ok(ledger.every((branch) => branch.candidate?.inferenceRole !== "observed_current" || !/selected/i.test(branch.disposition?.reason || "")));

  report.assignments = topology.functionalityAssignments;
  report.branches = branches;
  const publicReport = publicArchitectureAnalysis(report);
  assert.equal(publicReport.projectOrigin, "imported");
  assert.deepEqual(publicReport.publishedCandidates, report.publishedCandidates);
  assert.equal(Object.hasOwn(publicReport, "candidates"), false, "the source read contract exposes publishable candidates, not the full internal candidate pool");
  const saved = await writeProjectArchitectureAnalysis({ root, report });
  const repeated = await writeProjectArchitectureAnalysis({ root, report: { ...report, analyzedAt: "2099-01-01T00:00:00.000Z" } });
  assert.equal(repeated.analyzedAt, saved.analyzedAt, "analysis reports are immutable per source digest");
  const restored = await readProjectArchitectureAnalysis({ root, projectId: project.id, sourceDigest: report.sourceDigest });
  assert.equal(restored.sourceDigest, report.sourceDigest);
});

test("architecture discovery excludes virtual environments and preserves only literal application topology", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-architecture-chains-"));
  const workspaceDir = path.join(root, "workspace");
  await fs.mkdir(path.join(workspaceDir, "src"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, ".venv-local", "lib", "python3.12", "site-packages", "fastapi"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, ".venv-local", "lib", "python3.12", "site-packages", "fastapi", "routing.py"), "@app.get('/internal/package-route')\ndef route(): pass\n");
  await fs.writeFile(path.join(workspaceDir, "src", "App.jsx"), "export const App = () => <button onClick={() => fetch('/api/orders')}>Load</button>;\n");
  await fs.writeFile(path.join(workspaceDir, "src", "server.js"), "app.get('/api/orders', () => {});\n");
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await analyzeProjectArchitecture({
    project: { id: "chain-fixture", name: "Chain fixture", workspaceDir },
    env: { PROJECT_BRANCH_DISCOVERY_MODEL_ASSIST_ENABLED: "false" }
  });

  assert.equal(report.version, 9);
  assert.equal(report.inferredChains.length, 0);
  assert.ok(!report.sourceFiles.some((file) => file.path.includes("site-packages")));
  assert.ok(!report.functionalities.some((item) => item.label.includes("/internal/package-route")));
  assert.ok(report.applicationLinks.some((link) => link.type === "ui_calls_api"));
  const topology = buildProjectAgentTopology({ id: "chain-fixture", name: "Chain fixture", folderName: "chain-fixture" }, {
    discoveredFunctionalities: report.functionalities,
    applicationLinks: report.applicationLinks,
    inferredChains: report.inferredChains
  });
  assert.equal(topology.subfunctionalities.length, 0);
  assert.equal(topology.applicationLinks.length, report.applicationLinks.length);
  assert.equal(topology.inferredChains.length, report.inferredChains.length);
});

test("objective aggregation keeps elementary features as evidence beneath a connected major functionality", () => {
  const functionalities = [
    { id: "page", label: "Orders page", category: "ui", entityType: "ui_surface", sourceHints: { ui: { role: "page" } }, evidence: [{ id: "page-source" }], metrics: {} },
    { id: "button", label: "Load orders", category: "ui", entityType: "ui_element", parentEntityId: "page", evidence: [{ id: "button-source" }], metrics: {} },
    { id: "handler", label: "Load Orders", category: "ui", entityType: "ui_feature", parentEntityId: "button", evidence: [{ id: "handler-source" }], metrics: {} },
    { id: "route", label: "GET /api/orders", category: "api", entityType: "api_route", parentEntityId: "page", evidence: [{ id: "route-source" }], metrics: {} }
  ];
  const { objectives, majorFunctionalities } = deriveProjectObjectives({
    projectName: "Orders",
    functionalities,
    applicationLinks: [
      { sourceEntityId: "page", targetEntityId: "button", type: "contains_ui_element" },
      { sourceEntityId: "button", targetEntityId: "handler", type: "has_ui_feature" },
      { sourceEntityId: "page", targetEntityId: "route", type: "ui_calls_api" }
    ]
  });
  assert.equal(objectives.length, 1);
  assert.equal(majorFunctionalities.length, 1);
  assert.equal(majorFunctionalities[0].label, "Orders page");
  assert.deepEqual(majorFunctionalities[0].features.map((item) => item.label).sort(), ["GET /api/orders", "Load Orders", "Load orders"]);
  assert.equal(objectives[0].majorFunctionalityIds[0], majorFunctionalities[0].id);
});
