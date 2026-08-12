import fs from "node:fs";
import path from "node:path";

const observabilityRoot = process.env.HOSTING_OBSERVABILITY_DIR || "/workspace/observability/hosting";

function ensureRoot() {
  fs.mkdirSync(observabilityRoot, { recursive: true });
}

export function sanitizeEvent(event) {
  const { credentialPayload, credentials, token, secret, env, ...safe } = event || {};
  return safe;
}

export function writeLatestSession(session) {
  ensureRoot();
  fs.writeFileSync(path.join(observabilityRoot, "latest-hosting-session.json"), JSON.stringify(sanitizeEvent(session), null, 2));
}

export function appendDeploymentAudit(event) {
  ensureRoot();
  fs.appendFileSync(path.join(observabilityRoot, "deployment-audit-events.jsonl"), `${JSON.stringify(sanitizeEvent(event))}\n`);
}

export function appendCredentialAudit(event) {
  ensureRoot();
  fs.appendFileSync(path.join(observabilityRoot, "credential-security-events.jsonl"), `${JSON.stringify(sanitizeEvent(event))}\n`);
}
