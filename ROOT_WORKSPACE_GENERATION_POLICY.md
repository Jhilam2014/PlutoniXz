# ROOT_WORKSPACE_GENERATION_POLICY.md

This file defines where generated orchestrator artifacts must be placed.

It does not replace `AGENTS.md`. The canonical orchestrator behavior is always defined in `AGENTS.md`.

## Clean project onset rule

At the start of a project, do not pre-create every orchestrator folder.

Keep only the main instruction/config files. The orchestrator should create operational folders during bootstrap or when a task requires them.

## Do not write generated operational artifacts inside

- `schemas/`
- `examples/`
- `.git/`
- `node_modules/`
- `.venv/`
- `venv/`
- `dist/`
- `build/`
- `.next/`
- unrelated application folders unless the user explicitly targets them

## On-demand root folders

The orchestrator may create these folders when bootstrap or task execution requires them:

```text
agents/
workflows/
tasks/
runtime/
registry/
graph/
topology/
deliverables/
human-review/
observability/
docs/
configs/
tests/
scripts/
integrations/
memory/
agentic-system/
database/
schemas/
```

## Placement map

| Artifact type | Required root folder |
|---|---|
| Generated agent instructions | `agents/generated/` |
| Custom human agents | `agents/custom/` |
| Human controller agents | `agents/human/` |
| Archived agents | `agents/archived/` |
| Workflow manifests | `workflows/` |
| Task breakdowns | `tasks/` |
| Agent registry | `registry/agents/` |
| Workflow registry | `registry/workflows/` |
| Vector registry | `registry/vector/` |
| Neo4j schema, constraints, seed, migrations | `graph/neo4j/` |
| Workspace graph JSON | `graph/` |
| D3 graph data | `topology/d3/` |
| Execution topology | `topology/execution/` |
| Infrastructure topology | `topology/infrastructure/` |
| API/data topology | `topology/api/`, `topology/data/` |
| Standalone D3 Agentic System page | `agentic-system/d3/` |
| Runtime graph services | `runtime/graph/` |
| Runtime vector services | `runtime/vector/` |
| Runtime agent-memory services | `runtime/agent-memory/` |
| Runtime observability services | `runtime/observability/` |
| Vector provider resolution | `memory/vector/` |
| Prompt ledger | `memory/vector/prompt-ledger.jsonl` |
| Redacted prompt summaries | `memory/agent-knowledge/prompts/` |
| Agent knowledge summaries | `memory/agent-knowledge/agents/` |
| Project knowledge summaries | `memory/agent-knowledge/projects/` |
| Pending memory sync | `memory/pending-sync/` |
| Neo4j sync logs | `observability/graph/` |
| Vector memory logs | `observability/vector-memory/` |
| Agent memory logs | `observability/agent-memory/` |
| Token plans, token events, and token reports | `observability/token-economics/` |
| Delivery manifests | `deliverables/` |
| Validation reports | `deliverables/validation/` |
| Human review requests | `human-review/requests/` |
| Human decisions | `human-review/decisions/` |
| Documentation | `docs/` |
| Scripts | `scripts/` |
| Configs | `configs/` |
| Database schemas/migrations | `database/` |
| User-provided required data records | `src/generated/metadata.json` and relevant generated source/data modules |
| Product Shape Decision record | `src/generated/metadata.json` and orchestration/runtime records |
| Non-web primary artifacts | `deliverables/` or the Product Shape Contract's task-specific artifact path |
| API/service primary outputs | Project-local `src/api/`, `backend/`, or `openapi/` as selected by the Product Shape Contract |
| Automation/CLI/data workflow outputs | Project-local `scripts/`, `src/`, and `tests/` as selected by the Product Shape Contract |
| New-project staged media references | Created project `public/uploads/` and project media registry |
| Project-local standalone Docker files | Generated project root |
| Generated single-page surface | `src/generated/generatedPage.jsx` plus generated data/style/metadata files |
| Generated multi-page route shell | `src/generated/generatedPage.jsx` |
| Generated multi-page route plan | `src/generated/siteStructure.js` |
| Generated multi-page route modules | `src/generated/pages/` |
| Reusable JSON schemas, including token observability schema | `schemas/` |
| Tests | `tests/` |
| Integrations | `integrations/` |

## Generated website surface placement

Apply website placement only after `schemas/product-shape-decision.schema.json` selects a browser-facing website or application. Do not use these paths as evidence that every artifact must become React UI.

When a generated website is classified as `single_page`, keep the primary implementation in `src/generated/generatedPage.jsx` with companion generated data, style, metadata, and README files.

When it is classified as `multi_page`, keep `src/generated/generatedPage.jsx` as the route shell, write the route plan to `src/generated/siteStructure.js`, and place each route-level page under `src/generated/pages/`. Do not flatten platform/projects/services websites into one generated page unless the user explicitly asks for a one-page site.

Generated surfaces must record missing backend/integration data as explicit empty states, placeholders, TODO configuration hooks, or metadata notes. Do not store invented production records in generated source files to make the surface look populated.

For `artifact_only`, the requested file in `deliverables/` or another contract-selected artifact path is the primary output. `src/generated/` may contain only metadata or an auxiliary preview/download surface and must not replace the requested file.

For `service_or_automation`, write runnable entrypoints, contracts, configuration, and tests to the project paths selected by the Product Shape Contract. A decorative browser dashboard is not a substitute.

## Project-local standalone Docker files

When PlutoniX creates a downstream project, keep the standalone Docker packaging files in that generated project root, not in the PlutoniX root artifact folders:

```text
Dockerfile
.dockerignore
docker-compose.yml
.env.example
README.md
```

These files must allow the project to run outside the PlutoniX playground with `docker compose up --build` and must not depend on PlutoniX-only services or shared preview volumes unless the project explicitly requires them.

## Bootstrap behavior

When the user asks to bootstrap, initialize, verify, or repair orchestrator memory, the orchestrator may create the full operational scaffold required by `AGENTS.md`.

If the workspace already contains orchestrator-generated artifacts from an older orchestrator-agent version, bootstrap must run as an upgrade/repair pass. It must preserve existing generated folders and files, create only missing artifacts, patch existing artifacts only when required for compatibility, and report every created, modified, skipped, and preserved file.

Bootstrap must also generate the token observability schema and token publishing artifacts required by `AGENTS.md`, including:

```text
schemas/token-observability.schema.json
runtime/observability/token-publisher.service.ts
observability/token-economics/latest-token-plan.json
observability/token-economics/token-events.jsonl
observability/token-economics/bootstrap-token-report.json
```

Before bootstrap, this package intentionally contains only instruction/config files.

## ChromaDB fallback placement

If no vector DB is configured in `.env`, generate ChromaDB fallback files on demand in the root-level locations required by `AGENTS.md`, such as:

```text
docker-compose.chroma.yml
configs/chromadb.config.json
runtime/vector/chromadb.service.ts
scripts/init-chromadb.ts
scripts/sync-agent-knowledge-to-chromadb.ts
scripts/verify-chromadb.ts
memory/vector/chroma-collections.json
observability/vector-memory/chromadb-verification.json
```
