import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const rawArgs = process.argv.slice(2);
const valueFor = (flag) => {
  const index = rawArgs.indexOf(flag);
  return index >= 0 ? rawArgs[index + 1] : undefined;
};
const databaseUrl = process.env.GOTHAM_STUDIO_DATABASE_URL || process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("GOTHAM_STUDIO_DATABASE_URL, DECISION_CONTINUITY_DATABASE_URL, or DATABASE_URL is required to run migrations.");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const migrationRoots = [process.env.PLUTOMIX_PROJECT_ROOT, path.resolve(scriptDir, "../../..")].filter(Boolean);
let migrationDir = "";
for (const root of migrationRoots) {
  const candidate = path.resolve(root, "database/migrations");
  try {
    await fs.access(candidate);
    migrationDir = candidate;
    break;
  } catch {
    // Try the next supported repository root.
  }
}
if (!migrationDir) throw new Error("Decision-continuity migration files are unavailable from the configured project root.");
let files = (await fs.readdir(migrationDir))
  .filter((name) => /^(?:00[2-9]|01[0-5])_(?:decision_continuity|governed_promotion|brainx_model_registry|suggestion_intel_governance|enterprise_brainx_governance|gotham_studio|ai_provider_profiles|tenant_governance).*\.sql$/.test(name))
  .sort();
const upTo = valueFor("--to");
if (upTo) {
  if (!files.includes(upTo)) throw new Error(`Unknown decision-continuity migration: ${upTo}`);
  files = files.filter((file) => file <= upTo);
}
if (!files.length) throw new Error("No decision-continuity migrations were found.");

const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1)", [712_810_045]);
  // Created before tracking itself so 002 can be applied to a clean database.
  await client.query(`CREATE TABLE IF NOT EXISTS decision_continuity_schema_migrations (
    migration_name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const applied = await client.query("SELECT migration_name, checksum FROM decision_continuity_schema_migrations");
  const known = new Map(applied.rows.map((row) => [row.migration_name, row.checksum]));
  const plan = [];
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationDir, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const recorded = known.get(file);
    if (recorded && recorded !== checksum) throw new Error(`Migration checksum mismatch for ${file}; do not edit an applied migration.`);
    plan.push({ file, sql, checksum, applied: Boolean(recorded) });
  }
  if (args.has("--check") || args.has("--dry-run")) {
    await client.query("ROLLBACK");
    console.log(JSON.stringify({ status: "ok", dryRun: args.has("--dry-run"), migrations: plan.map(({ file, applied }) => ({ file, applied })) }, null, 2));
  } else {
    for (const migration of plan.filter((item) => !item.applied)) {
      await client.query(migration.sql);
      await client.query("INSERT INTO decision_continuity_schema_migrations (migration_name, checksum) VALUES ($1, $2)", [migration.file, migration.checksum]);
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ status: "ok", applied: plan.filter((item) => !item.applied).map((item) => item.file), alreadyApplied: plan.filter((item) => item.applied).map((item) => item.file) }, null, 2));
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
