import fs from "node:fs/promises";
import path from "node:path";
import { PostgresDecisionContinuityStore } from "../src/decisionContinuityPostgres.js";
import crypto from "node:crypto";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex"); }

const args = process.argv.slice(2);
const valueFor = (flag) => args[args.indexOf(flag) + 1];
const snapshotPath = valueFor("--snapshot");
const eventsPath = valueFor("--events");
const dryRun = args.includes("--dry-run");
if (!snapshotPath || !eventsPath) throw new Error("Usage: node scripts/import-decision-continuity-jsonl.mjs --snapshot <ledger.json> --events <domain-events.jsonl> [--dry-run]");
const state = JSON.parse(await fs.readFile(path.resolve(snapshotPath), "utf8"));
const events = (await fs.readFile(path.resolve(eventsPath), "utf8")).split(/\r?\n/).filter(Boolean).map((line, index) => {
  try { return JSON.parse(line); } catch { throw new Error(`Invalid JSONL event at line ${index + 1}.`); }
});
const seen = new Set();
for (const event of events) {
  if (!event?.id || !event?.tenantId || !event?.workspaceId || !event?.type) throw new Error("Each imported event requires id, tenantId, workspaceId, and type.");
  if (seen.has(event.id)) throw new Error(`Duplicate imported event id: ${event.id}`);
  if (event.eventHash && event.hashVersion) {
    const expected = digest({ ...event, eventHash: undefined });
    if (event.eventHash !== expected) throw new Error(`Event hash validation failed for ${event.id}.`);
  }
  seen.add(event.id);
}
const store = new PostgresDecisionContinuityStore();
const result = await store.importLegacy({ state, events, dryRun });
console.log(JSON.stringify(result, null, 2));
if (store.pool) await store.pool.end();
