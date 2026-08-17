import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { AuthenticationError, assertProductionIdentityConfiguration, externalIdentityFromRequest, userFromRequest, verifyOidcToken } from "../src/auth.js";

const issuer = "https://issuer.test/plutonix-unit";
const audience = "plutonix-api";
const first = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const rotated = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = (key, kid) => ({ ...key.export({ format: "jwk" }), kid, use: "sig", key_ops: ["verify"] });
const keys = [jwk(first.publicKey, "primary"), jwk(rotated.publicKey, "rotated")];

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signedToken({ key = first.privateKey, kid = "primary", header = {}, claims = {} } = {}) {
  const encodedHeader = encode({ alg: "RS256", typ: "JWT", kid, ...header });
  const encodedClaims = encode({ iss: issuer, sub: "unit-subject", aud: audience, exp: Math.floor(Date.now() / 1000) + 300, ...claims });
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedClaims}`), key).toString("base64url");
  return `${encodedHeader}.${encodedClaims}.${signature}`;
}

function testEnvironment() {
  return {
    NODE_ENV: "test",
    PLUTONIX_AUTH_MODE: "oidc",
    OIDC_ISSUER: issuer,
    OIDC_AUDIENCE: audience,
    OIDC_JWKS_JSON: JSON.stringify({ keys }),
    OIDC_CLOCK_SKEW_SECONDS: "0"
  };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof AuthenticationError && error.code === code);
}

test("OIDC verifier accepts only correctly signed configured tokens and honors signing-key rotation", async () => {
  const env = testEnvironment();
  const valid = await verifyOidcToken(signedToken(), { env });
  assert.deepEqual(valid.claims, { issuer, subject: "unit-subject" });
  const rotatedIdentity = await verifyOidcToken(signedToken({ key: rotated.privateKey, kid: "rotated", claims: { sub: "rotated-subject" } }), { env });
  assert.equal(rotatedIdentity.subject, "rotated-subject");
  await rejectsCode(verifyOidcToken(signedToken({ kid: "unknown" }), { env }), "unknown_signing_key");
});

test("OIDC verifier rejects unsigned, expired, wrong issuer/audience/type, and tampered tokens", async () => {
  const env = testEnvironment();
  await rejectsCode(verifyOidcToken(signedToken({ header: { alg: "none" } }), { env }), "invalid_algorithm");
  await rejectsCode(verifyOidcToken(signedToken({ claims: { exp: Math.floor(Date.now() / 1000) - 1 } }), { env }), "token_expired");
  await rejectsCode(verifyOidcToken(signedToken({ claims: { iss: "https://other-issuer.test" } }), { env }), "invalid_issuer");
  await rejectsCode(verifyOidcToken(signedToken({ claims: { aud: "another-api" } }), { env }), "invalid_audience");
  await rejectsCode(verifyOidcToken(signedToken({ header: { typ: "not-a-jwt" } }), { env }), "invalid_token_type");
  const token = signedToken();
  await rejectsCode(verifyOidcToken(`${token.slice(0, -1)}x`, { env }), "invalid_signature");
});

test("development header identities require the explicit non-production flag and production guards fail closed", async () => {
  const identity = await externalIdentityFromRequest({ get: (name) => name === "x-plutonix-dev-subject" ? "developer" : "" }, {
    env: { NODE_ENV: "development", PLUTONIX_DEV_AUTH_ENABLED: "true" }
  });
  assert.equal(identity.subject, "developer");
  await rejectsCode(externalIdentityFromRequest({ get: () => "developer" }, {
    env: { NODE_ENV: "test", PLUTONIX_DEV_AUTH_ENABLED: "false" }
  }), "authentication_required");
  assert.throws(
    () => assertProductionIdentityConfiguration({ NODE_ENV: "production", PLUTONIX_AUTH_MODE: "oidc", PLUTONIX_DEV_AUTH_ENABLED: "true", OIDC_ISSUER: issuer, OIDC_AUDIENCE: audience, PLUTONIX_CORS_ORIGINS: "https://app.example" }),
    /PLUTONIX_DEV_AUTH_ENABLED/
  );
  assert.throws(
    () => assertProductionIdentityConfiguration({ NODE_ENV: "production", PLUTONIX_AUTH_MODE: "oidc", OIDC_ISSUER: issuer, OIDC_AUDIENCE: audience }),
    /PLUTONIX_CORS_ORIGINS/
  );
  assert.doesNotThrow(
    () => assertProductionIdentityConfiguration({ NODE_ENV: "production", PLUTONIX_AUTH_MODE: "oidc", OIDC_ISSUER: issuer, OIDC_AUDIENCE: audience, PLUTONIX_CORS_ORIGINS: "https://app.example" })
  );
});

test("development profile projects use the same subject alias as the Decision Continuity identity", () => {
  const previous = process.env.PLUTONIX_DEV_AUTH_ENABLED;
  process.env.PLUTONIX_DEV_AUTH_ENABLED = "true";
  try {
    const user = userFromRequest({
      get: (name) => name === "x-plutonix-dev-subject" ? "local:local-plutonix-user" : "",
      query: {}
    });
    assert.equal(user.id, "local:local-plutonix-user");
    assert.deepEqual(user.aliases, ["anonymous"]);
  } finally {
    if (previous === undefined) delete process.env.PLUTONIX_DEV_AUTH_ENABLED;
    else process.env.PLUTONIX_DEV_AUTH_ENABLED = previous;
  }
});
