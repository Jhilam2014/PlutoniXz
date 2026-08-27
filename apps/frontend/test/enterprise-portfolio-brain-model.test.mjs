import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPortfolioIntelligenceMap,
  portfolioAppVisualState,
  portfolioIntelligenceCanvasDimensions,
  resolvePortfolioAppIconUrl,
  seedPortfolioIntelligenceLayout
} from "../src/components/agentic-system/enterprisePortfolioBrainModel.js";

const applications = [
  {
    id: "catalog",
    name: "Catalog",
    status: "active",
    summary: "Product catalog application.",
    enterprise: { id: "acme", name: "Acme Group" },
    brainX: {
      label: "Catalog BrainX",
      scope: "application-private",
      summary: "Catalog evidence and decisions.",
      updatedAt: "2026-08-20T10:00:00.000Z",
      publicationId: "catalog-publication"
    },
    counts: { features: 4, apis: 2, databases: 1, services: 3, pages: 5 },
    attentionCount: 2
  },
  {
    id: "billing",
    name: "Billing",
    status: "review",
    enterprise: { id: "acme", name: "Acme Group" },
    brainX: { label: "Billing BrainX", scope: "application-private" },
    counts: { features: 3, apis: 1, dataStores: 2, services: 2, pages: 2 },
    attentionCount: 1
  },
  {
    id: "sandbox",
    name: "Sandbox",
    // A display name without an explicit identifier is not enterprise
    // membership and must not create a shared private scope.
    enterprise: { name: "Acme Group" },
    brainX: { label: "Sandbox BrainX", scope: "application-private" },
    counts: { features: 1 },
    attentionCount: 4
  }
];

const hierarchy = {
  enterprise: {
    label: "PlutoniX Enterprise Brain",
    summary: "Governed portfolio intelligence.",
    updatedAt: "2026-08-21T09:00:00.000Z",
    recorded: true
  },
  // This must not create scope links. `applications` is the source of the
  // canvas membership contract.
  applications: [{ projectId: "sandbox", enterprise: { id: "acme" } }]
};

test("creates enterprise scope links only for explicit membership and leaves unassigned App BrainX independent", () => {
  const map = buildPortfolioIntelligenceMap({ applications, hierarchy, portfolioSummary: { applicationCount: 3, staleCount: 1 } });
  const sandbox = map.nodes.find((node) => node.kind === "application-brain" && node.application.id === "sandbox");
  const scope = map.nodes.find((node) => node.kind === "enterprise-scope");

  assert.equal(map.root.kind, "enterprise-brain");
  assert.equal(map.root.label, "PlutoniX Enterprise Brain");
  assert.deepEqual(map.root.portfolioSummary, { applicationCount: 3, staleCount: 1 });
  assert.deepEqual(scope.enterprise, {
    id: "acme",
    name: "Acme Group",
    applicationIds: ["billing", "catalog"],
    applicationCount: 2
  });
  assert.equal(sandbox.scope, "application-private");
  assert.equal(map.nodes.some((node) => node.kind === "private-scope" || /private/i.test(node.id)), false);
  assert.equal(map.links.filter((link) => link.kind === "enterprise-scope").length, 1);
  assert.deepEqual(
    map.links.filter((link) => link.kind === "application-scope").map((link) => link.applicationId),
    ["billing", "catalog"]
  );
  assert.equal(map.links.some((link) => link.source === "enterprise-scope:acme" && link.target === sandbox.id), false);
  assert.deepEqual(map.summary, {
    applicationCount: 3,
    enterpriseScopeCount: 1,
    privateApplicationCount: 1,
    nodeCount: 5,
    linkCount: 3,
    enterpriseScopeLinkCount: 1,
    applicationScopeLinkCount: 2,
    causalDependencyCount: 0,
    authorizedInformationSharingCount: 0,
    causalRelationshipCount: 0,
    authorizedInformationSharingRelationshipCount: 0,
    applicationAttentionCount: 7
  });
});

test("projects only normalized cross-application relationships and keeps causal and authorized-sharing links distinct", () => {
  const relations = [
    {
      id: "causal-catalog-billing",
      kind: "causal_dependency",
      sourceProjectId: "catalog",
      targetProjectId: "billing",
      type: "ui_calls_api",
      label: "Catalog calls Billing API",
      evidenceCount: 2,
      count: 2
    },
    // Duplicate payloads are a refresh artifact, not a second dependency.
    {
      id: "causal-catalog-billing",
      kind: "causal_dependency",
      sourceProjectId: "catalog",
      targetProjectId: "billing",
      type: "ui_calls_api",
      label: "Catalog calls Billing API",
      evidenceCount: 2,
      count: 2
    },
    {
      id: "sharing-catalog-billing",
      kind: "authorized_information_sharing",
      sourceProjectId: "catalog",
      targetProjectId: "billing",
      purpose: "portfolio-analysis",
      agreementCount: 1
    },
    // Normalized but unsupported relationship kinds must not be reclassified
    // as a causal or sharing edge by this presentation model.
    {
      id: "recorded-label-only",
      kind: "recorded_relationship",
      sourceProjectId: "catalog",
      targetProjectId: "sandbox",
      type: "shares_api"
    },
    {
      id: "missing-target",
      kind: "causal_dependency",
      sourceProjectId: "catalog",
      targetProjectId: "not-in-portfolio",
      type: "calls"
    }
  ];
  const map = buildPortfolioIntelligenceMap({ applications, relations, hierarchy });
  const causal = map.links.find((link) => link.kind === "causal-dependency");
  const sharing = map.links.find((link) => link.kind === "authorized-information-sharing");

  assert.equal(map.links.filter((link) => link.kind === "causal-dependency").length, 1);
  assert.equal(map.links.filter((link) => link.kind === "authorized-information-sharing").length, 1);
  assert.equal(causal.source, "application-brain:catalog");
  assert.equal(causal.target, "application-brain:billing");
  assert.deepEqual(causal.relationIds, ["causal-catalog-billing"]);
  assert.equal(causal.relationshipCount, 2);
  assert.equal(causal.evidenceCount, 2);
  assert.equal(sharing.source, causal.source);
  assert.equal(sharing.target, causal.target);
  assert.equal(sharing.purpose, "portfolio-analysis");
  assert.equal(sharing.agreementCount, 1);
  assert.equal(map.links.some((link) => link.kind === "recorded-relationship"), false);
  assert.equal(map.nodes.some((node) => /decision/i.test(node.kind)), false);
  assert.equal(map.summary.causalDependencyCount, 1);
  assert.equal(map.summary.authorizedInformationSharingCount, 1);
});

test("carries recorded application BrainX metadata, counts, and attention without inventing portfolio entities", () => {
  const map = buildPortfolioIntelligenceMap({ applications, hierarchy });
  const catalog = map.nodes.find((node) => node.application?.id === "catalog");

  assert.equal(catalog.label, "Catalog BrainX");
  assert.equal(catalog.application.brainX.summary, "Catalog evidence and decisions.");
  assert.equal(catalog.application.brainX.publicationId, "catalog-publication");
  assert.equal(catalog.application.brainX.recorded, true);
  assert.deepEqual(catalog.application.counts, {
    features: 4,
    apis: 2,
    dataStores: 1,
    services: 3,
    pages: 5
  });
  assert.equal(catalog.application.attentionCount, 2);
  assert.deepEqual(catalog.project, { id: "catalog", name: "Catalog" });
  assert.equal(catalog.isPrivate, false);
  assert.equal(catalog.brainRecorded, true);
  assert.equal(map.nodes.filter((node) => node.kind === "application-brain").length, applications.length);
  assert.equal(map.nodes.some((node) => node.kind === "decision" || node.kind === "decision-option"), false);
});

test("sorts and deduplicates stably and supplies deterministic initial canvas positions", () => {
  const relations = [
    {
      id: "sharing-catalog-billing",
      kind: "authorized_information_sharing",
      sourceProjectId: "catalog",
      targetProjectId: "billing",
      purpose: "portfolio-analysis",
      agreementCount: 1
    },
    {
      id: "causal-catalog-billing",
      kind: "causal_dependency",
      sourceProjectId: "catalog",
      targetProjectId: "billing",
      type: "ui_calls_api"
    }
  ];
  const first = buildPortfolioIntelligenceMap({ applications, relations, hierarchy });
  const second = buildPortfolioIntelligenceMap({ applications: [...applications].reverse(), relations: [...relations].reverse(), hierarchy });
  const firstLayout = seedPortfolioIntelligenceLayout(first, 960, 620);
  const secondLayout = seedPortfolioIntelligenceLayout(second, 960, 620);

  assert.deepEqual(second, first);
  assert.deepEqual(secondLayout, firstLayout);
  assert.ok(firstLayout.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  const scope = firstLayout.find((node) => node.kind === "enterprise-scope");
  const catalog = firstLayout.find((node) => node.application?.id === "catalog");
  const billing = firstLayout.find((node) => node.application?.id === "billing");
  const sandbox = firstLayout.find((node) => node.application?.id === "sandbox");
  const root = firstLayout.find((node) => node.kind === "enterprise-brain");
  const distanceFromRoot = (node) => Math.hypot(node.x - root.x, node.y - root.y);
  assert.ok(distanceFromRoot(scope) < distanceFromRoot(catalog));
  assert.ok(Math.abs(distanceFromRoot(catalog) - distanceFromRoot(billing)) < 0.001);
  assert.ok(distanceFromRoot(sandbox) > distanceFromRoot(catalog));
  assert.ok(firstLayout.every((node) => node.x >= 0 && node.x <= 960 && node.y >= 0 && node.y <= 620));
});

test("grows the canvas and distributes dense application groups around enterprise perimeters without overlap", () => {
  const denseApplications = Array.from({ length: 20 }, (_, index) => ({
    id: `service-${String(index + 1).padStart(2, "0")}`,
    name: `Service ${index + 1}`,
    enterprise: { id: "acme", name: "Acme Group" },
    brainX: { label: `Service ${index + 1} BrainX`, scope: "application-private" }
  }));
  const map = buildPortfolioIntelligenceMap({ applications: denseApplications });
  const dimensions = portfolioIntelligenceCanvasDimensions(map);
  const layout = seedPortfolioIntelligenceLayout(map, dimensions.width, dimensions.height);
  const apps = layout.filter((node) => node.kind === "application-brain");
  const root = layout.find((node) => node.kind === "enterprise-brain");
  const appRadii = apps.map((node) => Math.hypot(node.x - root.x, node.y - root.y));

  assert.ok(dimensions.width >= 1120);
  assert.ok(dimensions.height > 720);
  assert.equal(apps.length, denseApplications.length);
  assert.equal(new Set(apps.map((node) => `${node.x}:${node.y}`)).size, apps.length);
  assert.ok(Math.max(...appRadii) - Math.min(...appRadii) < 0.001, "enterprise applications should share one perimeter");
  for (let index = 0; index < apps.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < apps.length; otherIndex += 1) {
      const distance = Math.hypot(apps[index].x - apps[otherIndex].x, apps[index].y - apps[otherIndex].y);
      assert.ok(distance >= 102, `expected ${apps[index].id} and ${apps[otherIndex].id} to remain visually separate`);
    }
  }

  const multiScopeApplications = Array.from({ length: 24 }, (_, index) => ({
    id: `multi-scope-${String(index + 1).padStart(2, "0")}`,
    name: `Multi scope service ${index + 1}`,
    enterprise: {
      id: `enterprise-${Math.floor(index / 6) + 1}`,
      name: `Enterprise ${Math.floor(index / 6) + 1}`
    },
    brainX: { label: `Multi scope service ${index + 1} BrainX`, scope: "application-private" }
  }));
  const multiScopeMap = buildPortfolioIntelligenceMap({ applications: multiScopeApplications });
  const multiScopeDimensions = portfolioIntelligenceCanvasDimensions(multiScopeMap);
  const multiScopeApps = seedPortfolioIntelligenceLayout(multiScopeMap, multiScopeDimensions.width, multiScopeDimensions.height)
    .filter((node) => node.kind === "application-brain");

  for (let index = 0; index < multiScopeApps.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < multiScopeApps.length; otherIndex += 1) {
      const distance = Math.hypot(
        multiScopeApps[index].x - multiScopeApps[otherIndex].x,
        multiScopeApps[index].y - multiScopeApps[otherIndex].y
      );
      assert.ok(distance >= 102, `expected ${multiScopeApps[index].id} and ${multiScopeApps[otherIndex].id} to remain visually separate`);
    }
  }
});

test("uses only explicit application-icon media, resolves it against its own preview, and keeps color state factual", () => {
  const iconApplications = [
    {
      id: "catalog",
      name: "Catalog",
      enterprise: { id: "acme", name: "Acme Group" },
      project: {
        id: "catalog",
        name: "Catalog",
        previewUrl: "https://catalog.example.test:4173",
        appIcon: { purpose: "app-icon", urlPath: "/uploads/catalog.svg", kind: "analytics" },
        media: [{ purpose: "media", urlPath: "/uploads/not-an-icon.svg" }]
      },
      attentionCount: 0
    },
    {
      id: "billing",
      name: "Billing",
      project: {
        id: "billing",
        name: "Billing",
        previewUrl: "https://billing.example.test:4174",
        media: [{ purpose: "media", urlPath: "/uploads/not-an-icon.svg" }]
      },
      attentionCount: 0
    }
  ];
  const map = buildPortfolioIntelligenceMap({ applications: iconApplications });
  const catalog = map.nodes.find((node) => node.application?.id === "catalog");
  const billing = map.nodes.find((node) => node.application?.id === "billing");

  assert.equal(catalog.appIcon.url, "/uploads/catalog.svg");
  assert.equal(catalog.appIcon.resolvedUrl, "https://catalog.example.test:4173/uploads/catalog.svg");
  assert.equal(catalog.appIcon.kind, "analytics");
  assert.equal(billing.appIcon.url, "");
  assert.equal(resolvePortfolioAppIconUrl({ project: { previewUrl: "https://catalog.example.test" }, appIcon: { url: "javascript:alert(1)" } }), "");
  assert.equal(resolvePortfolioAppIconUrl({ project: { previewUrl: "not-a-url" }, appIcon: { url: "/uploads/catalog.svg" } }), "");
  assert.equal(portfolioAppVisualState({ attentionCount: 2, isPrivate: true, brainRecorded: true }), "review");
  assert.equal(portfolioAppVisualState({ isPrivate: true, brainRecorded: true }), "private");
  assert.equal(portfolioAppVisualState({ isPrivate: false, brainRecorded: true }), "recorded");
  assert.equal(portfolioAppVisualState({ isPrivate: false, brainRecorded: false }), "scope");
});
