# PlutoMix Architecture

PlutoMix uses three runtime containers:

1. `frontend`: a React/Vite control surface with a generation chat input, live runtime process messages, a center Playground preview, right-side PlutoMix status/log panel, and the PlutoMix Graphical Model page.
2. `backend`: an Express service that exposes REST endpoints, server-sent events, the strict Enterprise Brain control plane, and an internal Gotham MCP bridge used only by the alternate generation route.
3. `generated-site`: an isolated React/Vite app. The backend writes generated source files into this app through a Docker volume; Vite hot reloads the preview.

## Data Flow

```text
User instruction
  -> frontend POST /api/generate (or UI-selected /api/generate/mcp)
  -> PlutoMix orchestrator agent restructures instruction
  -> orchestrator creates add/modify/delete file-operation plan
  -> direct workflow or internal Gotham MCP bridge
  -> backend generator applies generated app file operations
  -> Vite hot reload refreshes generated-site by default
  -> generated-site Vite runtime
  -> frontend iframe preview
```

## Codex and Gotham MCP boundaries

There is no public generic `POST /mcp` JSON-RPC endpoint. Codex MCP is an external Codex integration. The backend's `POST /api/generate/mcp` endpoint is an application-specific alternate generation route that invokes the in-process `gotham.generate` bridge; it is not a remotely discoverable MCP server or a general tool surface. The direct route is `POST /api/generate`.

Both routes write generated files through the same bounded workflow, and generated-site Vite hot reloads by default. A hard generated-site Docker restart is opt-in through `RESTART_GENERATED_CONTAINER=true`.

## Enterprise decision control plane

The optional Enterprise BrainX layer is composed at the normal generation seam. A governed tenant resolves an application/enterprise binding, immutable policy snapshot, fresh evidence, and budget reservation before AIX records a model route or AgenticX supplies sanitized reuse knowledge. DecisionX captures only explicit path/outcome facts. ResearchX operates in a separate disabled-by-default profile and writes reviewable citations/observations, not source or policy changes.

The strict `/api/enterprise-brain/*` family is guarded by the existing OIDC membership/RBAC boundary. Its canonical records live in Decision Continuity; the Analysis workspace, portfolio view, Neo4j, and vector artifacts are derived projections. See [Enterprise BrainX governance](enterprise-brainx-governance.md).

## Safety

The first generator is deterministic and template based. It sanitizes text before writing generated React content, avoids shell execution, and writes only to the configured generated-site directory.

## Runtime Observability

The backend emits workflow runtime events through server-sent events, stores the latest 400 events in memory, and appends them to `runtime/workflow-runtime-log.jsonl` (the legacy `MCP_RUNTIME_LOG_PATH` environment alias is accepted for compatibility). The frontend displays the newest 400 rows in the builder chat and also polls `/api/runtime-log` so generation status remains visible if the live stream drops. User instructions and workflow process events appear in the same chat thread, with all displayed timestamps formatted in IST. File operation events include add, modify, and delete actions planned by the orchestrator agent.

The right-side PlutoMix panel shows major current-session events in Activity and runtime cards. Current-session rows are highlighted in light green. Some UI labels retain `MCP` for the optional internal bridge, not for a public `/mcp` endpoint. The center Playground uses a 16:9 aspect-ratio iframe by default and provides a fit-screen toggle for filling the available preview area.

## PlutoMix Graphical Model

The frontend serves `/agentic-system/d3/index.html`, which consumes `/topology/d3/agentic-system-graph.json`. The same standalone assets are also maintained under `agentic-system/d3/`. The graph shows the active PlutoMix fullstack agent and child functionality nodes for generation chat, playground preview, runtime observability, backend generation, optional internal Gotham bridge, file operations, generated-site runtime, memory providers, Neo4j artifact status, and human review.

Generation emits a task-console style trace: JSON-RPC tool receipt, instruction length, orchestrator restructuring, file plan rows, build start, workspace path, per-file write/delete start and completion, codegen completion, generated-site runtime refresh status, and final build duration.

## Generated App File Operation Runtime

The orchestrator agent produces `fileOperations` for every generation request. The backend applies those operations inside `apps/generated-site/src/generated/` only. The current operation set can add support data modules, modify the rendered React page and CSS, update metadata, and delete deprecated generated modules.
