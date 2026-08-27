import crypto from "node:crypto";
import { probeCodexCli, probeCopilotCli } from "./codexWorkflow.js";
import { readAgentTokenRows } from "./tokenEconomy.js";

const CACHE_MS = 30_000;
const MAX_CACHE_ENTRIES = 200;

function boundedText(value, max = 240) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function safeId(value, max = 240) {
  const text = boundedText(value, max);
  return /(?:api[_-]?key|token|secret|password|authorization|bearer|cookie|sk-[a-z0-9_-]+)/i.test(text) ? "" : text;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function iso(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ownerKey(owner = {}) {
  return crypto.createHash("sha256")
    .update(`${boundedText(owner.issuer, 240)}:${boundedText(owner.subject, 240)}`)
    .digest("hex")
    .slice(0, 32);
}

function profile(owner = {}) {
  const issuer = boundedText(owner.issuer, 120);
  const subject = safeId(owner.subject, 160);
  return {
    id: issuer && subject ? `${issuer}:${subject}` : null,
    displayName: boundedText(owner.displayName, 160) || null,
    email: boundedText(owner.email, 254) || null,
    authMode: boundedText(owner.authMode || "verified_browser_identity", 80),
    source: "PlutoniX verified identity",
    availability: issuer && subject ? "available" : "unavailable",
    unavailableReason: issuer && subject ? null : "A verified PlutoniX profile is required."
  };
}

function providerLabel(provider) {
  return ({ codex: "Codex", copilot: "GitHub Copilot" }[provider] || provider || "Provider");
}

function normalizeUsageRow(row, { owner, projectId } = {}) {
  if (!row || typeof row !== "object") return null;
  if (!row.gothamUsageOwnerKey || row.gothamUsageOwnerKey !== ownerKey(owner)) return null;
  if (projectId && String(row.projectId || "") !== String(projectId)) return null;
  const createdAt = iso(row.createdAt);
  if (!createdAt) return null;
  const inputTokens = nonNegativeNumber(row.inputTokens);
  const outputTokens = nonNegativeNumber(row.outputTokens);
  const totalTokens = nonNegativeNumber(row.totalTokens);
  return {
    buildId: safeId(row.buildId, 160) || null,
    provider: boundedText(row.provider || "codex", 40).toLowerCase(),
    model: boundedText(row.executionModel || row.model || row.costModel, 160) || null,
    inputTokens,
    outputTokens,
    cachedTokens: nonNegativeNumber(row.cachedTokens),
    totalTokens: totalTokens ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    estimatedCost: nonNegativeNumber(row.estimatedUsd),
    currency: row.estimatedUsd === undefined ? null : "USD",
    observedAt: createdAt,
    source: boundedText(row.source || "gotham-cli-structured-estimate", 120),
    classification: boundedText(row.estimationMethod, 120) ? "estimated" : "reported"
  };
}

function latestUsage(rows, options) {
  return rows
    .map((row) => normalizeUsageRow(row, options))
    .filter(Boolean)
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0] || null;
}

function unavailableAccount(reason) {
  return {
    providerAccountId: null,
    providerAccountIdAvailability: "unavailable",
    providerAccountIdReason: reason,
    displayName: null,
    email: null,
    username: null,
    organization: null,
    workspace: null,
    plan: null,
    authenticationMode: null,
    identitySource: null
  };
}

function providerSnapshot({ id, runtime, usage, active }) {
  const connected = Boolean(runtime?.available || usage);
  const unavailableReason = id === "codex"
    ? "The current Gotham Codex exec runtime does not expose account identity or allowance APIs."
    : "The current Gotham CLI runtime does not expose account identity or allowance APIs.";
  return {
    id,
    label: providerLabel(id),
    active: Boolean(active),
    connection: {
      status: connected ? "connected" : "unavailable",
      source: runtime?.available ? "Gotham runtime capability check" : usage ? "Observed Gotham execution" : "Gotham runtime capability check",
      observedAt: new Date().toISOString(),
      availabilityReason: connected ? null : boundedText(runtime?.error, 240) || "Provider runtime is not connected."
    },
    runtime: {
      kind: id,
      version: boundedText(runtime?.version, 240) || null,
      capability: runtime?.available ? "execution_available" : "not_available"
    },
    account: unavailableAccount(unavailableReason),
    conversation: usage
      ? {
          availability: "available",
          buildId: usage.buildId,
          provider: usage.provider,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedTokens: usage.cachedTokens,
          totalTokens: usage.totalTokens,
          totalTokensSemantics: "Gotham's recorded input plus output estimate; cached tokens are excluded unless the provider reports them separately.",
          cost: usage.estimatedCost === null ? null : { amount: usage.estimatedCost, currency: usage.currency, classification: usage.classification },
          classification: usage.classification,
          source: usage.source,
          observedAt: usage.observedAt,
          availabilityReason: null
        }
      : {
          availability: "unavailable",
          buildId: null,
          provider: id,
          model: null,
          inputTokens: null,
          outputTokens: null,
          cachedTokens: null,
          totalTokens: null,
          totalTokensSemantics: null,
          cost: null,
          source: null,
          observedAt: null,
          availabilityReason: "No owner-scoped Gotham execution usage has been observed for this conversation."
        },
    allowance: {
      availability: "unavailable",
      buckets: [],
      credits: null,
      source: null,
      observedAt: null,
      availabilityReason: unavailableReason,
      note: "Provider account allowance can include activity outside PlutoniX."
    },
    contextWindow: {
      availability: "unavailable",
      occupancyTokens: null,
      capacityTokens: null,
      source: null,
      observedAt: null,
      availabilityReason: "The current Gotham CLI execution does not report context-window occupancy."
    }
  };
}

export function sanitizeGothamAccountUsage(snapshot) {
  const serialized = JSON.stringify(snapshot || {});
  if (/(?:api[_-]?key|authorization|refresh[_-]?token|access[_-]?token|cookie|bearer)"\s*:/i.test(serialized) || /sk-[a-z0-9_-]{8,}/i.test(serialized)) {
    throw new Error("Gotham account usage payload contained a restricted credential field.");
  }
  return snapshot;
}

export function createGothamAccountUsageService({ readRows = readAgentTokenRows, probeCodex = probeCodexCli, probeCopilot = probeCopilotCli, now = () => Date.now(), cacheMs = Number(process.env.GOTHAM_ACCOUNT_USAGE_CACHE_MS || CACHE_MS) } = {}) {
  cacheMs = Math.max(5_000, Math.min(300_000, Number(cacheMs) || CACHE_MS));
  const cache = new Map();

  async function providerRuntime() {
    const [codex, copilot] = await Promise.all([
      probeCodex(process.env.CODEX_BIN || "codex", Number(process.env.GOTHAM_ACCOUNT_USAGE_PROBE_TIMEOUT_MS || 3000)).catch((error) => ({ available: false, error: error.message })),
      probeCopilot(Number(process.env.GOTHAM_ACCOUNT_USAGE_PROBE_TIMEOUT_MS || 3000)).catch((error) => ({ available: false, error: error.message }))
    ]);
    return { codex, copilot };
  }

  async function read({ owner, projectId = "", refresh = false } = {}) {
    if (!owner?.issuer || !owner?.subject) throw new Error("A verified owner scope is required for Gotham account usage.");
    const key = `${ownerKey(owner)}:${boundedText(projectId, 160)}`;
    const current = cache.get(key);
    const timestamp = now();
    if (current && timestamp - current.createdAt < cacheMs) {
      return { ...current.snapshot, refresh: { status: refresh ? "throttled" : "cached", availableAt: new Date(current.createdAt + cacheMs).toISOString() } };
    }
    const [rows, runtime] = await Promise.all([readRows(), providerRuntime()]);
    const usage = latestUsage(Array.isArray(rows) ? rows : [], { owner, projectId });
    const activeProvider = usage?.provider || (runtime.codex?.available ? "codex" : runtime.copilot?.available ? "copilot" : "codex");
    const ids = new Set([activeProvider]);
    if (runtime.codex?.available || usage?.provider === "codex") ids.add("codex");
    if (runtime.copilot?.available || usage?.provider === "copilot") ids.add("copilot");
    const providers = [...ids].map((id) => providerSnapshot({ id, runtime: runtime[id], usage: usage?.provider === id ? usage : null, active: id === activeProvider }));
    const snapshot = sanitizeGothamAccountUsage({
      status: "ok",
      scope: { projectId: safeId(projectId, 160) || null, owner: "verified_profile" },
      profile: profile(owner),
      activeProvider,
      providers,
      updatedAt: new Date(timestamp).toISOString(),
      stale: false,
      refresh: { status: "refreshed", availableAt: new Date(timestamp + cacheMs).toISOString() }
    });
    cache.set(key, { createdAt: timestamp, snapshot });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return snapshot;
  }

  return { read, clear(owner, projectId = "") { cache.delete(`${ownerKey(owner)}:${boundedText(projectId, 160)}`); } };
}
