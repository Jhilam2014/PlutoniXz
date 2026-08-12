# PlutoniX Architecture

PlutoniX uses three runtime containers:

1. `frontend`: a React/Vite control surface with a wide MCP chat input, live runtime process messages, a center Playground preview, right-side PlutoniX status/log panel, and the PlutoniX Graphical Model page.
2. `backend`: an Express service that exposes REST endpoints, server-sent events, and a small MCP-compatible JSON-RPC endpoint.
3. `generated-site`: an isolated React/Vite app. The backend writes generated source files into this app through a Docker volume; Vite hot reloads the preview.

## Data Flow

```text
User instruction
  -> frontend POST /mcp tools/call
  -> PlutoniX orchestrator agent restructures instruction
  -> orchestrator creates add/modify/delete file-operation plan
  -> backend MCP handler
  -> backend generator applies generated app file operations
  -> Vite hot reload refreshes generated-site by default
  -> generated-site Vite runtime
  -> frontend iframe preview
```

## MCP Surface

`POST /mcp` accepts JSON-RPC requests. The `generate_webpage` tool writes the generated files and lets the generated-site Vite runtime hot-reload by default. A hard generated-site Docker restart is opt-in through `RESTART_GENERATED_CONTAINER=true`.

## Safety

The first generator is deterministic and template based. It sanitizes text before writing generated React content, avoids shell execution, and writes only to the configured generated-site directory.

## Runtime Observability

The backend emits MCP runtime events through server-sent events, stores the latest 400 events in memory, and appends them to `runtime/mcp-runtime-log.jsonl`. The frontend displays the newest 400 rows in the `MCP Builder chat`, ordered latest first, and also polls `/api/runtime-log` so generation status remains visible if the live stream drops. User instructions and MCP process events appear in the same chat thread, with all displayed timestamps formatted in IST. File operation events include add, modify, and delete actions planned by the orchestrator agent.

The right-side PlutoniX panel shows major current-session events in both Activity and MCP runtime cards. Current-session rows are highlighted in light green. The center Playground uses a 16:9 aspect-ratio iframe by default and provides a fit-screen toggle for filling the available preview area.

## PlutoniX Graphical Model

The frontend serves `/agentic-system/d3/index.html`, which consumes `/topology/d3/agentic-system-graph.json`. The same standalone assets are also maintained under `agentic-system/d3/`. The graph shows the active PlutoniX fullstack agent and child functionality nodes for MCP chat, playground preview, runtime observability, backend generation, MCP instruction restructuring, file operations, generated-site runtime, memory providers, Neo4j artifact status, and human review.

Generation emits a task-console style trace: JSON-RPC tool receipt, instruction length, orchestrator restructuring, file plan rows, build start, workspace path, per-file write/delete start and completion, codegen completion, generated-site runtime refresh status, and final build duration.

## Generated App File Operation Runtime

The orchestrator agent produces `fileOperations` for every MCP generation request. The backend applies those operations inside `apps/generated-site/src/generated/` only. The current operation set can add support data modules, modify the rendered React page and CSS, update metadata, and delete deprecated generated modules.
