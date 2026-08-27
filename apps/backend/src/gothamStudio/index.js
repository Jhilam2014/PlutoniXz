import path from "node:path";
import { GothamStudioRepository } from "./gothamStudioRepository.js";
import { GothamStudioPostgresRepository } from "./gothamStudioPostgresRepository.js";
import { GothamStudioService } from "./gothamStudioService.js";
import { ProviderRegistry } from "./providers/providerRegistry.js";
import { DatabricksExecutionProvider } from "./providers/databricks/databricksProvider.js";
import { AzureMlExecutionProvider } from "./providers/azureMl/azureMlProvider.js";

export function resolveGothamStudioRepositoryMode(env = process.env) {
  const requested = String(env.GOTHAM_STUDIO_REPOSITORY || "").trim().toLowerCase();
  const mode = requested || (env.NODE_ENV === "production" ? "postgres" : "file");
  if (!["file", "postgres"].includes(mode)) {
    throw new Error(`Unsupported Gotham Studio repository mode: ${mode}`);
  }
  if (env.NODE_ENV === "production" && mode !== "postgres") {
    throw new Error("Gotham Studio requires PostgreSQL persistence in production.");
  }
  return mode;
}

export function createGothamStudio({ root, env = process.env, emit = () => {}, fetchImpl = globalThis.fetch, repository } = {}) {
  const providerRegistry = new ProviderRegistry([
    new DatabricksExecutionProvider({ env, fetchImpl }),
    new AzureMlExecutionProvider({ env, fetchImpl })
  ]);
  const repositoryMode = repository ? "injected" : resolveGothamStudioRepositoryMode(env);
  if (repositoryMode === "file" && !root) throw new Error("Gotham Studio's file repository requires a repository root.");
  const databaseUrl = env.GOTHAM_STUDIO_DATABASE_URL || env.DECISION_CONTINUITY_DATABASE_URL || env.DATABASE_URL;
  if (repositoryMode === "postgres" && !databaseUrl) {
    throw new Error("GOTHAM_STUDIO_DATABASE_URL, DECISION_CONTINUITY_DATABASE_URL, or DATABASE_URL is required for Gotham Studio PostgreSQL persistence.");
  }
  const studioRepository = repository || (repositoryMode === "postgres"
    ? new GothamStudioPostgresRepository({ databaseUrl })
    : new GothamStudioRepository({ filePath: env.GOTHAM_STUDIO_STATE_PATH || path.join(root, "database", "gotham-studio", "state.json") }));
  return new GothamStudioService({
    repository: studioRepository,
    providerRegistry,
    emit,
    reconciliationIntervalMs: env.GOTHAM_STUDIO_RECONCILIATION_INTERVAL_MS,
    maxReconciliationsPerCycle: env.GOTHAM_STUDIO_MAX_RECONCILIATIONS_PER_CYCLE
  });
}

export { registerGothamStudioRoutes } from "./gothamStudioRoutes.js";
export { detectMlExecutionIntent, deriveMlExecutionProposal } from "./gothamStudioIntent.js";
