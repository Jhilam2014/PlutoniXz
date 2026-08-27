import crypto from "node:crypto";

const ALGORITHMS = Object.freeze({
  RS256: { digest: "RSA-SHA256", kty: "RSA" },
  RS384: { digest: "RSA-SHA384", kty: "RSA" },
  RS512: { digest: "RSA-SHA512", kty: "RSA" },
  ES256: { digest: "sha256", kty: "EC" },
  ES384: { digest: "sha384", kty: "EC" },
  ES512: { digest: "sha512", kty: "EC" }
});
const jwksCache = new Map();

export class AuthenticationError extends Error {
  constructor(message = "Authentication failed.", { code = "authentication_failed", status = 401 } = {}) {
    super(message);
    this.name = "AuthenticationError";
    this.code = code;
    this.status = status;
  }
}

function base64UrlJson(value, label) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new AuthenticationError(`The bearer token ${label} is malformed.`, { code: "invalid_token" });
  }
}

function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !parts.every(Boolean)) throw new AuthenticationError("A compact signed bearer token is required.", { code: "invalid_token" });
  return {
    header: base64UrlJson(parts[0], "header"),
    claims: base64UrlJson(parts[1], "payload"),
    signature: Buffer.from(parts[2], "base64url"),
    signed: `${parts[0]}.${parts[1]}`
  };
}

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new AuthenticationError(`Identity is not configured: ${key} is required.`, { code: "identity_configuration_invalid", status: 503 });
  return value;
}

function integer(env, key, fallback, { min, max }) {
  const value = env[key] === undefined || env[key] === "" ? fallback : Number(env[key]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AuthenticationError(`${key} must be an integer between ${min} and ${max}.`, { code: "identity_configuration_invalid", status: 503 });
  }
  return value;
}

function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").toLowerCase() === "production";
}

export function developmentAuthEnabled(env = process.env) {
  return !isProduction(env) && String(env.PLUTONIX_DEV_AUTH_ENABLED || "").toLowerCase() === "true";
}

export function assertProductionIdentityConfiguration(env = process.env) {
  if (!isProduction(env)) return;
  if (String(env.PLUTONIX_DEV_AUTH_ENABLED || "").toLowerCase() === "true") {
    throw new Error("Production refuses to start while PLUTONIX_DEV_AUTH_ENABLED=true.");
  }
  if (String(env.PLUTONIX_AUTH_MODE || "oidc").toLowerCase() !== "oidc") {
    throw new Error("Production requires PLUTONIX_AUTH_MODE=oidc.");
  }
  required(env, "OIDC_ISSUER");
  required(env, "OIDC_AUDIENCE");
  if (!String(env.PLUTONIX_CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean).length) {
    throw new Error("Production requires an explicit PLUTONIX_CORS_ORIGINS allowlist for browser bearer requests.");
  }
  if (String(env.OIDC_JWKS_JSON || "").trim()) {
    throw new Error("Production refuses OIDC_JWKS_JSON; use issuer discovery or OIDC_JWKS_URL.");
  }
}

function oidcConfig(env = process.env) {
  const issuer = required(env, "OIDC_ISSUER").replace(/\/$/, "");
  const audience = required(env, "OIDC_AUDIENCE").split(",").map((value) => value.trim()).filter(Boolean);
  if (!audience.length) throw new AuthenticationError("OIDC_AUDIENCE must contain an audience.", { code: "identity_configuration_invalid", status: 503 });
  const algorithms = String(env.OIDC_ALLOWED_ALGORITHMS || "RS256,RS384,RS512,ES256,ES384,ES512")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (!algorithms.length || algorithms.some((algorithm) => !ALGORITHMS[algorithm])) {
    throw new AuthenticationError("OIDC_ALLOWED_ALGORITHMS contains an unsupported or unsafe algorithm.", { code: "identity_configuration_invalid", status: 503 });
  }
  const tokenTypes = String(env.OIDC_ACCEPTED_TOKEN_TYPES || "JWT,at+jwt")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (!tokenTypes.length) throw new AuthenticationError("OIDC_ACCEPTED_TOKEN_TYPES must not be empty.", { code: "identity_configuration_invalid", status: 503 });
  return {
    issuer,
    audience,
    algorithms: new Set(algorithms),
    tokenTypes: new Set(tokenTypes),
    jwksUrl: String(env.OIDC_JWKS_URL || "").trim(),
    staticJwks: !isProduction(env) ? String(env.OIDC_JWKS_JSON || "").trim() : "",
    cacheMs: integer(env, "OIDC_JWKS_CACHE_MS", 300_000, { min: 1_000, max: 3_600_000 }),
    staleMs: integer(env, "OIDC_JWKS_STALE_GRACE_MS", 300_000, { min: 0, max: 3_600_000 }),
    clockSkewSeconds: integer(env, "OIDC_CLOCK_SKEW_SECONDS", 60, { min: 0, max: 300 })
  };
}

function cacheKey(config) {
  return config.staticJwks ? `static:${crypto.createHash("sha256").update(config.staticJwks).digest("hex")}` : `${config.issuer}|${config.jwksUrl || "discovery"}`;
}

function validateJwks(payload) {
  if (!payload || !Array.isArray(payload.keys)) throw new AuthenticationError("The OIDC JWKS response is invalid.", { code: "identity_provider_unavailable", status: 503 });
  return payload.keys.filter((key) => {
    if (!key || typeof key !== "object" || typeof key.kid !== "string" || !key.kid) return false;
    if (key.kty === "RSA") return Boolean(key.n && key.e);
    if (key.kty === "EC") return Boolean(key.x && key.y && key.crv);
    return false;
  });
}

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, { redirect: "error", headers: { accept: "application/json" } });
  } catch {
    throw new AuthenticationError("The OIDC identity provider is unavailable.", { code: "identity_provider_unavailable", status: 503 });
  }
  if (!response.ok) throw new AuthenticationError("The OIDC identity provider returned an invalid response.", { code: "identity_provider_unavailable", status: 503 });
  try {
    return await response.json();
  } catch {
    throw new AuthenticationError("The OIDC identity provider returned invalid JSON.", { code: "identity_provider_unavailable", status: 503 });
  }
}

async function jwksUri(config) {
  if (config.jwksUrl) return config.jwksUrl;
  const discovery = await fetchJson(`${config.issuer}/.well-known/openid-configuration`);
  if (discovery.issuer !== config.issuer || typeof discovery.jwks_uri !== "string" || !discovery.jwks_uri) {
    throw new AuthenticationError("OIDC issuer discovery did not return a matching issuer and JWKS URI.", { code: "identity_provider_unavailable", status: 503 });
  }
  return discovery.jwks_uri;
}

async function loadJwks(config, { force = false } = {}) {
  const key = cacheKey(config);
  const cached = jwksCache.get(key);
  const now = Date.now();
  if (!force && cached && now < cached.freshUntil) return cached.keys;
  try {
    const payload = config.staticJwks ? JSON.parse(config.staticJwks) : await fetchJson(await jwksUri(config));
    const keys = validateJwks(payload);
    if (!keys.length) throw new AuthenticationError("The OIDC JWKS contains no usable signing keys.", { code: "identity_provider_unavailable", status: 503 });
    jwksCache.set(key, { keys, freshUntil: now + config.cacheMs, staleUntil: now + config.cacheMs + config.staleMs });
    return keys;
  } catch (error) {
    if (cached && now < cached.staleUntil) return cached.keys;
    throw error instanceof AuthenticationError ? error : new AuthenticationError("The OIDC identity provider is unavailable.", { code: "identity_provider_unavailable", status: 503 });
  }
}

function selectedJwk(keys, header) {
  const profile = ALGORITHMS[header.alg];
  const candidates = keys.filter((key) => key.kid === header.kid && key.kty === profile.kty && (!key.use || key.use === "sig") && (!key.key_ops || key.key_ops.includes("verify")));
  if (candidates.length !== 1) throw new AuthenticationError("The bearer token signing key is unknown.", { code: "unknown_signing_key" });
  return candidates[0];
}

function validateClaims(claims, header, config) {
  const now = Math.floor(Date.now() / 1000);
  const skew = config.clockSkewSeconds;
  if (header.typ === undefined || !config.tokenTypes.has(String(header.typ))) {
    throw new AuthenticationError("The bearer token type is not accepted.", { code: "invalid_token_type" });
  }
  if (claims.iss !== config.issuer) throw new AuthenticationError("The bearer token issuer is not accepted.", { code: "invalid_issuer" });
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.some((audience) => config.audience.includes(audience))) throw new AuthenticationError("The bearer token audience is not accepted.", { code: "invalid_audience" });
  if (!Number.isFinite(claims.exp) || Number(claims.exp) <= now - skew) throw new AuthenticationError("The bearer token has expired.", { code: "token_expired" });
  if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || Number(claims.nbf) > now + skew)) throw new AuthenticationError("The bearer token is not active.", { code: "token_not_active" });
  if (typeof claims.sub !== "string" || !claims.sub.trim() || claims.sub.length > 200) throw new AuthenticationError("The bearer token subject is invalid.", { code: "invalid_subject" });
}

export async function verifyOidcToken(token, { env = process.env } = {}) {
  const config = oidcConfig(env);
  const parsed = parseJwt(token);
  if (!config.algorithms.has(parsed.header.alg) || parsed.header.alg === "none" || !parsed.header.kid) {
    throw new AuthenticationError("The bearer token signing algorithm or key identifier is not accepted.", { code: "invalid_algorithm" });
  }
  let keys = await loadJwks(config);
  let jwk;
  try {
    jwk = selectedJwk(keys, parsed.header);
  } catch (error) {
    if (error.code !== "unknown_signing_key") throw error;
    keys = await loadJwks(config, { force: true });
    jwk = selectedJwk(keys, parsed.header);
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    throw new AuthenticationError("The bearer token signing key is invalid.", { code: "invalid_signing_key" });
  }
  const algorithm = ALGORITHMS[parsed.header.alg];
  const verified = crypto.verify(
    algorithm.digest,
    Buffer.from(parsed.signed),
    algorithm.kty === "EC" ? { key: publicKey, dsaEncoding: "ieee-p1363" } : publicKey,
    parsed.signature
  );
  if (!verified) throw new AuthenticationError("The bearer token signature is invalid.", { code: "invalid_signature" });
  validateClaims(parsed.claims, parsed.header, config);
  return {
    issuer: config.issuer,
    subject: parsed.claims.sub.trim(),
    displayName: String(parsed.claims.name || parsed.claims.preferred_username || "").slice(0, 160),
    email: String(parsed.claims.email || "").slice(0, 254),
    tokenType: String(parsed.header.typ),
    claims: { issuer: config.issuer, subject: parsed.claims.sub.trim() }
  };
}

function googleIdentityEnvironment(credential, env = process.env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) {
    throw new AuthenticationError(
      "Google sign-in is not configured on the backend: GOOGLE_CLIENT_ID is required.",
      { code: "google_identity_configuration_invalid", status: 503 }
    );
  }

  // The issuer claim is untrusted at this point, but it can only select one of
  // Google's two documented issuer spellings. Signature and claim validation
  // still happen below against Google's fixed JWKS endpoint and this client ID.
  const issuer = String(parseJwt(credential).claims.iss || "");
  if (!["https://accounts.google.com", "accounts.google.com"].includes(issuer)) {
    throw new AuthenticationError("The Google identity token issuer is not accepted.", { code: "invalid_issuer" });
  }

  return {
    ...env,
    OIDC_ISSUER: issuer,
    OIDC_AUDIENCE: clientId,
    OIDC_JWKS_URL: "https://www.googleapis.com/oauth2/v3/certs",
    OIDC_ALLOWED_ALGORITHMS: "RS256",
    OIDC_ACCEPTED_TOKEN_TYPES: "JWT"
  };
}

export async function verifyGoogleIdentityToken(credential, { env = process.env } = {}) {
  const token = String(credential || "").trim();
  if (!token) throw new AuthenticationError("A Google identity credential is required.", { code: "google_credential_required" });
  const identity = await verifyOidcToken(token, { env: googleIdentityEnvironment(token, env) });
  const pictureClaim = String(parseJwt(token).claims.picture || "").trim();
  let picture = "";
  try {
    const url = new URL(pictureClaim);
    if (url.protocol === "https:" && (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"))) {
      picture = url.toString().slice(0, 2048);
    }
  } catch {
    // A missing or non-Google image never prevents an otherwise valid login.
  }
  return { ...identity, picture };
}

export async function externalIdentityFromRequest(req, { env = process.env } = {}) {
  const authorization = String(req.get?.("authorization") || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match) {
    const hasEnterpriseOidc = Boolean(String(env.OIDC_ISSUER || "").trim() && String(env.OIDC_AUDIENCE || "").trim());
    const hasGoogleIdentity = Boolean(String(env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID || "").trim());
    if (!isProduction(env) && !hasEnterpriseOidc && hasGoogleIdentity) {
      return verifyGoogleIdentityToken(match[1], { env });
    }
    return verifyOidcToken(match[1], { env });
  }
  if (developmentAuthEnabled(env)) {
    const subject = String(req.get?.("x-plutonix-dev-subject") || "").trim();
    if (subject && subject.length <= 200) {
      return { issuer: "development", subject, displayName: String(req.get?.("x-plutonix-dev-name") || "").slice(0, 160), email: "", tokenType: "development", claims: { issuer: "development", subject } };
    }
  }
  throw new AuthenticationError("A verified bearer token is required.", { code: "authentication_required" });
}

// Legacy non-decision routes still use this compatibility projection. The
// Decision Continuity surface uses externalIdentityFromRequest plus database
// membership resolution and never trusts these client-controlled values.
export function userFromRequest(req) {
  const userId = String(req.get("x-plutonix-user-id") || req.query?.userId || "").trim();
  const userName = String(req.get("x-plutonix-user-name") || req.query?.userName || "").trim();
  const userEmail = String(req.get("x-plutonix-user-email") || req.query?.userEmail || "").trim();
  if (!userId && developmentAuthEnabled()) {
    const subject = String(req.get("x-plutonix-dev-subject") || "").trim();
    if (subject && subject.length <= 200) {
      return {
        id: subject.slice(0, 160),
        name: String(req.get("x-plutonix-dev-name") || "Local PlutoniX User").slice(0, 120),
        email: "",
        authProvider: "development",
        // Retain access to pre-identity local projects created as anonymous.
        aliases: ["anonymous"]
      };
    }
  }
  if (!userId) return { id: "anonymous", name: "Local user", email: "", authProvider: "local" };
  return { id: userId.slice(0, 160), name: userName.slice(0, 120) || "PlutoniX user", email: userEmail.slice(0, 160), authProvider: "legacy" };
}

export async function authenticateGooglePayload(body = {}, { env = process.env } = {}) {
  const identity = await verifyGoogleIdentityToken(body.credential, { env });
  return { id: `${identity.issuer}:${identity.subject}`, name: identity.displayName || "Verified user", email: identity.email, picture: identity.picture, authProvider: "oidc" };
}

export function restrictedIntent(text) {
  const value = String(text || "").toLowerCase();
  const rules = [
    { pattern: /(tech|architecture|source|code|implementation|system prompt|internal).{0,80}(agentic[- ]?plutonix|plutonix system|orchestrator)/i, reason: "Requests for internal PlutoniX implementation details are restricted." },
    { pattern: /(clone|copy|same|exact|replica|duplicate).{0,80}(agentic[- ]?plutonix|plutonix app|this app)/i, reason: "Creating an exact copy of PlutoniX is restricted." },
    { pattern: /(agent_knowledge_global|global vector|vectordb|vector db|vector store).{0,80}(pull|dump|export|extract|list|download|read|copy)/i, reason: "Direct extraction of global agent knowledge/vector memory is restricted." }
  ];
  return rules.find((rule) => rule.pattern.test(value)) || null;
}
