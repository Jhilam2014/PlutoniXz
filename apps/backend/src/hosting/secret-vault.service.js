import crypto from "node:crypto";

const vault = new Map();

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

export function storeCredentialMetadata({ sessionId, providerId, credentialMethod, credentialPayload = {} }) {
  const raw = JSON.stringify(credentialPayload);
  const credentialId = `cred_${crypto.randomUUID()}`;
  vault.set(credentialId, {
    encrypted_reference: `mock-vault://${credentialId}`,
    fingerprint: fingerprint(raw),
    created_at: new Date().toISOString()
  });
  return {
    credential_id: credentialId,
    provider_id: providerId,
    session_id: sessionId,
    method: credentialMethod,
    status: "connected",
    encrypted_reference: `mock-vault://${credentialId}`,
    fingerprint: fingerprint(raw),
    warning: "Local mock vault stores only an in-memory encrypted-reference placeholder. Configure cloud KMS/vault before real deployments.",
    created_at: new Date().toISOString()
  };
}

export function revokeCredential(credentialId) {
  const existed = vault.delete(credentialId);
  return { credential_id: credentialId, status: existed ? "deleted" : "not_found", deleted_at: new Date().toISOString() };
}
