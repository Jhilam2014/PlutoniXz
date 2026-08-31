import fs from "node:fs/promises";
import path from "node:path";

const MAX_CAPTURE_CHARS = 32 * 1024;
const SECRET_PATTERNS = [
  /\b(?:sk|sess|ghp|github_pat|nvapi|xox[abprs])[-_a-z0-9]{8,}\b/gi,
  /\bBearer\s+[a-z0-9._~+\/-]+=*/gi,
  /\b(?:access|refresh|id|api|auth(?:orization)?)_?(?:token|key)\s*[:=]\s*[^\s,;]+/gi,
  /([?&](?:code|token|state|key|secret|signature)=)[^&\s]+/gi
];

export function redactProviderText(value, maxLength = 4000) {
  let text = String(value || "").slice(-Math.max(0, Math.min(MAX_CAPTURE_CHARS, maxLength)));
  for (const pattern of SECRET_PATTERNS.slice(0, -1)) text = text.replace(pattern, "[REDACTED]");
  text = text.replace(SECRET_PATTERNS.at(-1), "$1[REDACTED]");
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function appendBounded(current, chunk, maxLength = MAX_CAPTURE_CHARS) {
  return `${current || ""}${String(chunk || "")}`.slice(-maxLength);
}

export function validateAuthorizationUrl(candidate, allowedDomains = []) {
  let url;
  try {
    url = new URL(String(candidate || "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const allowed = allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (!allowed) return null;
  return url;
}

export function extractAuthorizationChallenge(text, allowedDomains = []) {
  const urls = String(text || "").match(/https:\/\/[^\s<>"']+/gi) || [];
  let authorizationUrl = "";
  let destinationDomain = "";
  for (const raw of urls) {
    const cleaned = raw.replace(/[),.;]+$/, "");
    const validated = validateAuthorizationUrl(cleaned, allowedDomains);
    if (validated) {
      authorizationUrl = validated.toString();
      destinationDomain = validated.hostname;
      break;
    }
  }
  const codeMatch = String(text || "").match(/(?:one[- ]time|device|verification)?\s*code\s*[:\-]?\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{3,})*)/i);
  return { authorizationUrl, destinationDomain, deviceCode: codeMatch?.[1] || "" };
}

export function safeFingerprint(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const visible = text.includes("@") ? text.replace(/^(.{1,2}).*(@.*)$/, "$1***$2") : `${text.slice(0, 2)}***${text.slice(-2)}`;
  return visible.slice(0, 120);
}

export function sanitizeAuditMetadata(metadata = {}) {
  const result = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (/token|secret|authorization|url|code|credential|stdout|stderr|cookie|header|path/i.test(key)) continue;
    if (["string", "number", "boolean"].includes(typeof value)) result[key] = typeof value === "string" ? redactProviderText(value, 240) : value;
  }
  return result;
}

export async function assertSecureRuntimeDirectory(runtimeRoot, segments) {
  const root = path.resolve(runtimeRoot);
  const normalized = segments.map((segment) => {
    const value = String(segment || "");
    if (!/^[a-zA-Z0-9._-]{1,160}$/.test(value) || value === "." || value === "..") throw new Error("Invalid provider runtime scope.");
    return value;
  });
  const target = path.resolve(root, ...normalized);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Provider runtime path escaped its managed root.");
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  await fs.chmod(target, 0o700);
  return target;
}
