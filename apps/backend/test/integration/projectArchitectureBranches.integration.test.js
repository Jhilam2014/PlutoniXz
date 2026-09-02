import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { IdentityAccessStore } from "../../src/identityAccess.js";
import { PostgresDecisionContinuityStore } from "../../src/decisionContinuityPostgres.js";

const databaseUrl = process.env.DECISION_CONTINUITY_TEST_DATABASE_URL;
const options = databaseUrl ? {} : { skip: "Set DECISION_CONTINUITY_TEST_DATABASE_URL to run project architecture branch HTTP integration." };

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

test("authorized managed-project analysis is source-cited, tenant-bound, anticipated, and idempotent", options, async (context) => {
  const runId = `${process.pid}-${Date.now()}`;
  const tenantId = `architecture-tenant-${runId}`;
  const issuer = `https://issuer.test/architecture-${runId}`;
  const audience = "plutomix-architecture-tests";
  const proposer = `architecture-proposer-${runId}`;
  const auditor = `architecture-auditor-${runId}`;
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: `architecture-key-${runId}`, use: "sig", key_ops: ["verify"] };
  const bearer = (subject) => {
    const header = base64Url({ alg: "RS256", typ: "JWT", kid: jwk.kid });
    const payload = base64Url({ iss: issuer, sub: subject, aud: audience, exp: Math.floor(Date.now() / 1000) + 300 });
    return `${header}.${payload}.${crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`;
  };
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-architecture-http-"));
  const projectRoot = path.join(temporaryRoot, "control-plane");
  const projectsRoot = path.join(temporaryRoot, "projects");
  const workspaceDir = path.join(projectsRoot, "imported-fixture");
  const projectId = `imported-fixture-${runId}`;
  await fs.mkdir(path.join(workspaceDir, "src"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "src", "App.jsx"), "import React from 'react'; export const App = () => <main>Fixture</main>;\n");
  await fs.writeFile(path.join(workspaceDir, "src", "server.js"), "app.get('/api/fixture', authenticate, () => {});\n");
  await fs.writeFile(path.join(workspaceDir, "schema.prisma"), "datasource db { provider = \"sqlite\" url = \"file:fixture.db\" }\nmodel Fixture { id String @id }\n");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, "projects.json"), JSON.stringify([{
    id: projectId,
    name: "Imported fixture",
    folderName: "imported-fixture",
    workspaceDir,
    port: 5398,
    status: "stopped",
    ownerUserId: `${issuer}:${proposer}`,
    ownerName: "Architecture proposer",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }], null, 2));

  const previous = Object.fromEntries([
    "NODE_ENV", "DECISION_CONTINUITY_ADAPTER", "DECISION_CONTINUITY_DATABASE_URL", "DECISION_CONTINUITY_DURABLE_WORKFLOWS",
    "PLUTOMIX_AUTH_MODE", "OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_JSON", "OIDC_JWKS_URL", "PLUTOMIX_DEV_AUTH_ENABLED",
    "PLUTOMIX_SERVER_AUTOSTART", "PLUTOMIX_PROJECT_ROOT", "PROJECTS_ROOT", "PROJECTS_REGISTRY_PATH", "PROJECT_AGENT_RUNTIME_ROOT",
    "PROJECT_AGENT_MARKDOWN_ROOT", "PROJECT_AGENT_NEO4J_PATH", "AGENTIC_SYSTEM_GRAPH_PATH", "FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH",
    "PROJECT_BRANCH_DISCOVERY_MODEL_ASSIST_ENABLED", "PROJECT_RUNTIME_MODE", "SELF_IMPROVEMENT_ENABLED"
  ].map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DECISION_CONTINUITY_ADAPTER: "postgres",
    DECISION_CONTINUITY_DATABASE_URL: databaseUrl,
    DECISION_CONTINUITY_DURABLE_WORKFLOWS: "false",
    PLUTOMIX_AUTH_MODE: "oidc",
    OIDC_ISSUER: issuer,
    OIDC_AUDIENCE: audience,
    OIDC_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
    OIDC_JWKS_URL: "",
    PLUTOMIX_DEV_AUTH_ENABLED: "false",
    PLUTOMIX_SERVER_AUTOSTART: "false",
    PLUTOMIX_PROJECT_ROOT: projectRoot,
    PROJECTS_ROOT: projectsRoot,
    PROJECTS_REGISTRY_PATH: path.join(projectRoot, "projects.json"),
    PROJECT_AGENT_RUNTIME_ROOT: path.join(projectRoot, "runtime", "agents", "projects"),
    PROJECT_AGENT_MARKDOWN_ROOT: path.join(projectRoot, "agents", "generated"),
    PROJECT_AGENT_NEO4J_PATH: path.join(projectRoot, "graph", "neo4j", "generated-project-agents.cypher"),
    AGENTIC_SYSTEM_GRAPH_PATH: path.join(projectRoot, "topology", "d3", "agentic-system-graph.json"),
    FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH: path.join(projectRoot, "frontend", "topology", "d3", "agentic-system-graph.json"),
    PROJECT_BRANCH_DISCOVERY_MODEL_ASSIST_ENABLED: "false",
    PROJECT_RUNTIME_MODE: "process",
    SELF_IMPROVEMENT_ENABLED: "false"
  });

  const identity = new IdentityAccessStore({ databaseUrl });
  await identity.provisionPrincipal({ id: proposer, issuer, subject: proposer, type: "human", displayName: "Architecture proposer" });
  await identity.provisionMembership({ principalId: proposer, tenantId, roles: ["proposer"] });
  await identity.provisionPrincipal({ id: auditor, issuer, subject: auditor, type: "human", displayName: "Architecture auditor" });
  await identity.provisionMembership({ principalId: auditor, tenantId, roles: ["auditor"] });
  const { app, closePlutoMixServerResources } = await import("../../src/server.js");
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, suffix, subject, body) => {
    const response = await fetch(`${baseUrl}/api/decision-continuity/projects/${encodeURIComponent(projectId)}/architecture-branches${suffix}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer(subject)}`,
        "x-plutomix-tenant-id": tenantId,
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json();
    return { status: response.status, json };
  };
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closePlutoMixServerResources();
    await identity.pool?.end();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const denied = await request("POST", "", auditor, { requestedFrom: "integration" });
  assert.equal(denied.status, 403);
  const created = await request("POST", "", proposer, { requestedFrom: "integration" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.ok(created.json.report.functionalities.length >= 4);
  assert.ok(created.json.report.branches.some((branch) => branch.inferenceRole === "observed_current"));
  assert.ok(created.json.report.branches.some((branch) => branch.inferenceRole === "anticipated_alternative" && branch.status === "candidate" && !branch.autoReconsideration && branch.historicalClaim === false));
  assert.equal(created.json.report.modelAssist.status, "disabled");
  const firstDigest = created.json.report.sourceDigest;

  const read = await request("GET", "", proposer);
  assert.equal(read.status, 200);
  assert.equal(read.json.report.sourceDigest, firstDigest);
  const repeated = await request("POST", "", proposer, { requestedFrom: "integration" });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.json.report.idempotent, true);

  await fs.appendFile(path.join(workspaceDir, "src", "server.js"), "app.post('/api/fixture', authorize, () => {});\n");
  const changed = await request("POST", "", proposer, { requestedFrom: "integration" });
  assert.equal(changed.status, 201, JSON.stringify(changed.json));
  assert.notEqual(changed.json.report.sourceDigest, firstDigest);
  const store = new PostgresDecisionContinuityStore({ databaseUrl });
  const ledger = await store.listBranches({ tenantId, workspaceId: projectId, limit: 250 });
  await store.pool?.end();
  assert.ok(ledger.some((branch) => branch.candidate?.sourceDigest === firstDigest));
  assert.ok(ledger.some((branch) => branch.candidate?.sourceDigest === changed.json.report.sourceDigest));
  const anticipated = ledger.filter((branch) => branch.candidate?.inferenceRole === "anticipated_alternative");
  assert.ok(anticipated.length > 0);
  assert.ok(anticipated.every((branch) => branch.status === "candidate" && !branch.autoReconsideration && !branch.allowRejectedReconsideration));
  const topology = JSON.parse(await fs.readFile(path.join(projectRoot, "runtime", "agents", "projects", `${projectId}.agents.json`), "utf8"));
  assert.ok(topology.functionalities.length > 0);
  assert.ok(topology.relationships.some((relationship) => relationship.type === "IMPLEMENTS"));
  assert.ok(topology.architectureBranches.some((branch) => branch.inferenceRole === "anticipated_alternative"));
  const graph = JSON.parse(await fs.readFile(path.join(projectRoot, "topology", "d3", "agentic-system-graph.json"), "utf8"));
  const functionality = graph.nodes.find((node) => node.type === "page" && node.metadata?.projectId === projectId && node.metadata?.applicationEntityType === "ui_surface");
  const branch = graph.nodes.find((node) => node.type === "branch" && node.metadata?.projectId === projectId && node.metadata?.inferenceRole === "anticipated_alternative");
  assert.ok(functionality, "the D3 graph contains a project UI application entity node");
  assert.ok(branch, "the D3 graph contains an anticipated architecture branch node");
  assert.ok(graph.links.some((link) => link.source === `project:${projectId}` && link.target === functionality.id && link.type === "contains_application_entity"));
  assert.ok(graph.links.some((link) => link.target === functionality.id && link.type === "implements"));
  assert.equal(graph.nodes.some((node) => node.type === "application_subfunctionality" && node.metadata?.projectId === projectId), false, "typed application entities do not acquire fabricated code-unit children");
  assert.ok(graph.links.some((link) => link.target === branch.id && ["has_architecture_branch", "supports_architecture_branch"].includes(link.type)));
});
