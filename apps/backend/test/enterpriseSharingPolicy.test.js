import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildApplicationInformationSharingContext,
  readEnterpriseSharingAgreementRegistry,
  saveEnterpriseSharingAgreement
} from "../src/enterpriseSharingPolicy.js";

const projects = [
  { id: "source-app", name: "Source", enterprise: { id: "acme", name: "Acme" } },
  { id: "target-app", name: "Target", enterprise: { id: "acme", name: "Acme" } }
];

function input(overrides = {}) {
  return {
    status: "active",
    enterpriseId: "acme",
    sourceProjectId: "source-app",
    recipientProjectId: "target-app",
    direction: "source_to_recipient",
    purposes: ["application_development"],
    scope: { level: "client", accountId: "", clientId: "client-42", label: "Client 42" },
    information: {
      summary: "The recipient may consider the client's recorded residency requirement.",
      dataCategories: ["client constraints"],
      classification: "confidential",
      region: "in",
      retentionDays: 30,
      governanceRules: ["Use only for application design."],
      privacyPolicies: ["Do not expose client identifiers in generated UI."],
      enterpriseConstraints: ["Keep regulated client data in India."]
    },
    approvals: {
      account: { approved: true, principalId: "account-owner" },
      source: { approved: true, principalId: "source-owner" },
      recipient: { approved: true, principalId: "recipient-owner" }
    },
    ...overrides
  };
}

test("persists an approved scoped policy atomically and compiles only its authorized direction", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-sharing-policy-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const agreement = await saveEnterpriseSharingAgreement(input(), { root, actorId: "operator-1" });
  const registry = await readEnterpriseSharingAgreementRegistry({ root });
  assert.equal(registry.status, "configured");
  assert.equal(registry.agreements.length, 1);
  assert.equal(registry.agreements[0].id, agreement.id);
  assert.match(registry.agreements[0].approvals.account.decidedAt, /^\d{4}-\d{2}-\d{2}T/);

  const sourceContext = buildApplicationInformationSharingContext({ project: projects[0], projects, agreements: registry.agreements });
  assert.equal(sourceContext.activePolicies.length, 1);
  assert.equal(sourceContext.activePolicies[0].direction, "outbound");
  assert.deepEqual(sourceContext.enterpriseConstraints, ["Keep regulated client data in India."]);
  assert.deepEqual(sourceContext.privacyPolicies, ["Do not expose client identifiers in generated UI."]);

  const targetContext = buildApplicationInformationSharingContext({ project: projects[1], projects, agreements: registry.agreements });
  assert.equal(targetContext.activePolicies.length, 1);
  assert.equal(targetContext.activePolicies[0].direction, "inbound");
});

test("keeps draft, wrong-purpose, and incomplete policies unavailable to Gotham context", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const approvals = Object.fromEntries(["account", "source", "recipient"].map((party) => [party, { approved: true, principalId: `${party}-owner`, decidedAt: now }]));
  const agreements = [
    { ...input({ status: "draft" }), id: "draft", approvals },
    { ...input({ purposes: ["portfolio_analysis"] }), id: "wrong-purpose", approvals },
    { ...input(), id: "missing-approval", approvals: { account: approvals.account } }
  ];
  const result = buildApplicationInformationSharingContext({ project: projects[1], projects, agreements });
  assert.deepEqual(result.activePolicies, []);
  assert.deepEqual(result.blockedPolicies.map((policy) => policy.id), ["draft", "wrong-purpose", "missing-approval"]);
  assert.equal(result.defaultPolicy, "deny");
});

test("requires the identifying account or client scope and all approvals before activation", async () => {
  await assert.rejects(() => saveEnterpriseSharingAgreement(input({ scope: { level: "client", accountId: "", clientId: "", label: "Missing" } })), /Client scope requires/);
  await assert.rejects(() => saveEnterpriseSharingAgreement(input({ approvals: { account: { approved: false, principalId: "" }, source: { approved: true, principalId: "source" }, recipient: { approved: true, principalId: "recipient" } } })), /Active sharing requires/);
});

test("serializes concurrent policy writes without losing an agreement", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-sharing-concurrent-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await Promise.all([
    saveEnterpriseSharingAgreement(input({ id: "sharing-a" }), { root, actorId: "operator" }),
    saveEnterpriseSharingAgreement(input({ id: "sharing-b", information: { ...input().information, summary: "A second approved application-development policy." } }), { root, actorId: "operator" })
  ]);
  const registry = await readEnterpriseSharingAgreementRegistry({ root });
  assert.deepEqual(registry.agreements.map((agreement) => agreement.id).sort(), ["sharing-a", "sharing-b"]);
});
