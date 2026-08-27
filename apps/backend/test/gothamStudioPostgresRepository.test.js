import assert from "node:assert/strict";
import test from "node:test";
import { createGothamStudio, resolveGothamStudioRepositoryMode } from "../src/gothamStudio/index.js";
import { GothamStudioRepository } from "../src/gothamStudio/gothamStudioRepository.js";
import { GothamStudioPostgresRepository } from "../src/gothamStudio/gothamStudioPostgresRepository.js";

const scope = { tenantId: "tenant-a", workspaceId: "workspace-a", projectId: "project-a" };

test("selects PostgreSQL as the production authority and confines file persistence to non-production", () => {
  assert.equal(resolveGothamStudioRepositoryMode({ NODE_ENV: "production" }), "postgres");
  assert.equal(resolveGothamStudioRepositoryMode({ NODE_ENV: "development" }), "file");
  assert.throws(
    () => createGothamStudio({ root: "/tmp", env: { NODE_ENV: "production", GOTHAM_STUDIO_REPOSITORY: "file" } }),
    /requires PostgreSQL persistence/
  );
  assert.throws(
    () => createGothamStudio({ root: "/tmp", env: { NODE_ENV: "production" } }),
    /DATABASE_URL is required/
  );
  const studio = createGothamStudio({ root: "/tmp", env: { NODE_ENV: "development", GOTHAM_STUDIO_REPOSITORY: "file" } });
  assert.ok(studio.repository instanceof GothamStudioRepository);
});

test("PostgreSQL job reads apply tenant, workspace, and project scope", async () => {
  const seen = [];
  const record = { id: "PX-ML-1", ...scope, name: "Scoped job", idempotencyKey: "private" };
  const repository = new GothamStudioPostgresRepository({
    pool: {
      async query(sql, values) {
        seen.push({ sql, values });
        return values[1] === scope.tenantId && values[2] === scope.workspaceId && values[3] === scope.projectId
          ? { rows: [{ record }] }
          : { rows: [] };
      }
    }
  });

  const job = await repository.getJob(record.id, scope);
  assert.equal(job.id, record.id);
  assert.equal(job.tenantId, undefined);
  assert.equal(job.idempotencyKey, undefined);
  assert.match(seen[0].sql, /tenant_id=\$2 AND workspace_id=\$3 AND project_id=\$4/);
  assert.deepEqual(seen[0].values, [record.id, scope.tenantId, scope.workspaceId, scope.projectId]);
  await assert.rejects(
    () => repository.getJob(record.id, { ...scope, projectId: "project-b" }),
    (error) => error.code === "job_not_found" && error.status === 404
  );
});

test("PostgreSQL repository reports a missing Studio migration without leaking database detail", async () => {
  const repository = new GothamStudioPostgresRepository({
    pool: {
      async query() {
        const error = new Error("relation gotham_studio_jobs does not exist");
        error.code = "42P01";
        throw error;
      }
    }
  });
  await assert.rejects(
    () => repository.listJobs(scope),
    (error) => error.code === "studio_migration_required" && error.status === 503 && !error.message.includes("relation")
  );
});

test("PostgreSQL reconciliation leases are scope-keyed and released after work", async () => {
  const queries = [];
  let releases = 0;
  const repository = new GothamStudioPostgresRepository({
    pool: {
      async connect() {
        return {
          async query(sql, values) {
            queries.push({ sql, values });
            return { rows: sql.includes("pg_try_advisory_lock") ? [{ acquired: true }] : [] };
          },
          release() { releases += 1; }
        };
      }
    }
  });
  const value = await repository.withJobLease("PX-ML-1", scope, async () => "reconciled");
  assert.equal(value, "reconciled");
  assert.match(queries[0].sql, /pg_try_advisory_lock/);
  assert.equal(queries[0].values[0], "tenant-a:workspace-a:project-a:PX-ML-1");
  assert.match(queries[1].sql, /pg_advisory_unlock/);
  assert.equal(releases, 1);
});
