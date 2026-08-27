import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEnterprisePortfolioAnalysis,
  canShareApplicationInformation,
  normalizeEnterpriseTag
} from "../src/enterprisePortfolio.js";

const acme = { enterpriseId: "acme", enterpriseName: "Acme, Inc." };
const alpha = { id: "alpha", name: "Alpha", enterprise: acme };
const beta = { id: "beta", name: "Beta", enterprise: acme };

function approvedAgreement(overrides = {}) {
  return {
    id: "agreement-1",
    status: "active",
    enterpriseId: "acme",
    sourceProjectId: "alpha",
    recipientProjectId: "beta",
    direction: "source_to_recipient",
    purposes: ["portfolio-analysis"],
    approvals: {
      account: { approved: true, principalId: "account-admin", decidedAt: "2025-01-01T00:00:00.000Z" },
      source: { approved: true, principalId: "alpha-owner", decidedAt: "2025-01-01T00:00:00.000Z" },
      recipient: { approved: true, principalId: "beta-owner", decidedAt: "2025-01-01T00:00:00.000Z" }
    },
    ...overrides
  };
}

test("normalizes enterprise tags without treating a display name as an access boundary", () => {
  assert.deepEqual(normalizeEnterpriseTag({ enterpriseId: "  ACME  ", enterpriseName: "  Acme   Inc. " }), {
    enterpriseId: "acme",
    enterpriseName: "Acme Inc."
  });
  assert.deepEqual(normalizeEnterpriseTag({ enterpriseName: "Unverified enterprise" }), {
    enterpriseId: "",
    enterpriseName: ""
  });
  assert.deepEqual(normalizeEnterpriseTag({ id: "northwind", name: "Northwind" }), {
    enterpriseId: "northwind",
    enterpriseName: "Northwind"
  });
  assert.deepEqual(normalizeEnterpriseTag({}, { id: "plain-project", name: "Plain project" }), {
    enterpriseId: "",
    enterpriseName: ""
  });
});

test("keeps an untagged project's own identity out of enterprise classification", () => {
  const analysis = buildEnterprisePortfolioAnalysis({
    projects: [{ id: "plain-project", name: "Plain project" }],
    graph: { nodes: [], links: [] },
    agreements: []
  });

  assert.equal(analysis.applications[0].enterprise, null);
  assert.deepEqual(analysis.enterprises, []);
});

test("denies sharing for untagged and different-enterprise applications", () => {
  assert.equal(canShareApplicationInformation({
    sourceProject: { id: "untagged" }, targetProject: beta, agreement: approvedAgreement({ sourceProjectId: "untagged" }), purpose: "portfolio-analysis"
  }), false);
  assert.equal(canShareApplicationInformation({
    sourceProject: alpha,
    targetProject: { id: "other", enterprise: { enterpriseId: "other-enterprise" } },
    agreement: approvedAgreement({ recipientProjectId: "other" }),
    purpose: "portfolio-analysis"
  }), false);
  assert.equal(canShareApplicationInformation({
    sourceProject: { id: "untagged-a", name: "Untagged A" },
    targetProject: { id: "untagged-b", name: "Untagged B" },
    agreement: approvedAgreement({ enterpriseId: "untagged-a", sourceProjectId: "untagged-a", recipientProjectId: "untagged-b" }),
    purpose: "portfolio-analysis"
  }), false);
});

test("denies sharing when any required approval is missing", () => {
  const agreement = approvedAgreement({ approvals: { account: { approved: true }, source: { approved: true } } });
  assert.equal(canShareApplicationInformation({ sourceProject: alpha, targetProject: beta, agreement, purpose: "portfolio-analysis" }), false);
});

test("allows only an active fully-approved agreement that covers direction and purpose", () => {
  const agreement = approvedAgreement();
  assert.equal(canShareApplicationInformation({ sourceProject: alpha, targetProject: beta, agreement, purpose: "portfolio-analysis" }), true);
  assert.equal(canShareApplicationInformation({ sourceProject: beta, targetProject: alpha, agreement, purpose: "portfolio-analysis" }), false);
  assert.equal(canShareApplicationInformation({ sourceProject: alpha, targetProject: beta, agreement, purpose: "runtime-telemetry" }), false);
});

test("fails closed on revoked, incomplete, or wrong-enterprise agreement records", () => {
  const cases = [
    approvedAgreement({ active: true, status: "revoked" }),
    approvedAgreement({ direction: undefined }),
    approvedAgreement({ purposes: undefined }),
    approvedAgreement({ enterpriseId: "other-enterprise" }),
    approvedAgreement({ approvals: { account: { approved: true }, source: { approved: true }, recipient: { approved: true } } }),
    approvedAgreement({ approvals: {
      account: { approved: true, principalId: "account-admin", decidedAt: "2099-01-01T00:00:00.000Z" },
      source: { approved: true, principalId: "alpha-owner", decidedAt: "2025-01-01T00:00:00.000Z" },
      recipient: { approved: true, principalId: "beta-owner", decidedAt: "2025-01-01T00:00:00.000Z" }
    } })
  ];
  for (const agreement of cases) {
    assert.equal(canShareApplicationInformation({ sourceProject: alpha, targetProject: beta, agreement, purpose: "portfolio-analysis" }), false);
  }
});

test("does not invent application dependencies from project creation, implementation, or ownership", () => {
  const analysis = buildEnterprisePortfolioAnalysis({
    projects: [alpha, beta],
    graph: {
      nodes: [
        { id: "alpha-agent", metadata: { projectId: "alpha" } },
        { id: "beta-api", metadata: { projectId: "beta" }, type: "api" }
      ],
      links: [
        { id: "created", source: "alpha-agent", target: "beta-api", type: "creates_project" },
        { id: "implemented", source: "alpha-agent", target: "beta-api", type: "implements" },
        { id: "owned", source: "alpha-agent", target: "beta-api", type: "owns" },
        { id: "enterprise-tag", source: "alpha-agent", target: "beta-api", type: "assigned_to" }
      ]
    },
    agreements: []
  });

  assert.deepEqual(analysis.causalRelationships, []);
  assert.deepEqual(analysis.relationships, []);
  assert.deepEqual(analysis.sharingRelationships, []);
  assert.equal(analysis.applications.find((application) => application.projectId === "alpha").counts.outboundCausalRelationships, 0);
});

test("aggregates literal cross-application causal links and exposes sharing only after the gate passes", () => {
  const analysis = buildEnterprisePortfolioAnalysis({
    projects: [alpha, beta],
    graph: {
      nodes: [
        { id: "alpha-ui", type: "ui_element", metadata: { projectId: "alpha" } },
        { id: "alpha-api", type: "api", metadata: { projectId: "alpha" } },
        { id: "beta-api", type: "api", metadata: { projectId: "beta" } }
      ],
      links: [
        { id: "call-1", source: "alpha-ui", target: "beta-api", type: "ui_calls_api" },
        { id: "call-2", source: "alpha-api", target: "beta-api", type: "ui_calls_api" },
        { id: "internal", source: "alpha-ui", target: "alpha-api", type: "ui_calls_api" }
      ]
    },
    agreements: [approvedAgreement()]
  });

  assert.equal(analysis.causalRelationships.length, 1);
  assert.deepEqual(analysis.causalRelationships[0], {
    id: "causal:alpha:beta:ui_calls_api",
    kind: "causal_dependency",
    sourceProjectId: "alpha",
    targetProjectId: "beta",
    type: "ui_calls_api",
    count: 2,
    evidenceCount: 0,
    linkIds: ["call-1", "call-2"],
    sourceNodeIds: ["alpha-api", "alpha-ui"],
    targetNodeIds: ["beta-api"]
  });
  assert.equal(analysis.sharingRelationships.length, 1);
  const alphaApplication = analysis.applications.find((application) => application.projectId === "alpha");
  assert.equal(alphaApplication.counts.apis, 1);
  assert.equal(alphaApplication.counts.links, 1);
  assert.deepEqual(alphaApplication.enterprise, { id: "acme", name: "Acme, Inc." });
  assert.deepEqual(alphaApplication.brainX, { label: "Alpha App BrainX", scope: "application-private" });
  assert.deepEqual(analysis.enterprises, [{ id: "acme", name: "Acme, Inc.", applicationIds: ["alpha", "beta"], applicationCount: 2 }]);
  assert.deepEqual(analysis.relationships, analysis.causalRelationships);
  assert.deepEqual(analysis.sharingPolicy, {
    default: "deny",
    sameEnterpriseRequired: true,
    activeAgreementRequired: true,
    requiredApprovals: ["account", "source", "recipient"],
    directionAndPurposeRequired: true
  });
  assert.match(analysis.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
