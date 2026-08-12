# PlutoniX

PlutoniX is an autonomous multi-artifact creation system. It classifies each instruction before implementation and can generate applications, mobile surfaces, tools, APIs, automations, PDFs, documents, flyers, images, presentations, media, and formula-driven Excel or CSV workbooks. Browser products run in isolated preview containers; non-browser outputs remain real downloadable artifacts and open in an adaptive Playground.

## Services

- `frontend`: React control surface at `http://localhost:5173`.
- `backend`: Node/Express API at `http://localhost:8080`.
- `generated-site`: isolated generated webpage preview at `http://localhost:5174`.

## Run

```bash
./run.sh
```

Or run Compose directly:

```bash
docker compose up --build
```

Then open `http://localhost:5173`.

Useful runner commands:

```bash
./run.sh --status
./run.sh --logs
./run.sh --stop
```

## Generate

Submit an instruction in the PlutoniX chat. The central brain creates a Product Shape Contract, identifies required data and output paths, delegates to appropriate specialist agents, and validates the real primary deliverable. React/Vite generation is used for browser-facing products; document, print, workbook, media, service, and automation requests use their task-appropriate formats and runtimes.

## Projects, Uploads, And Export

New and imported projects are stored as named sibling folders directly under the parent `money` root, assigned an exclusive port from `PROJECT_PORT_START` to `PROJECT_PORT_END`, and shown in the Playground project dropdown. For example, a project named `Travel CRM` is created at `../travel-crm`; another project with the same name becomes `../travel-crm-2`. PlutoniX remains the host/control app; selecting a project inspects its dedicated runtime container, starts or recreates it when necessary, waits for the assigned port to become healthy, and then switches the iframe preview. Set `PROJECT_RUNTIME_MODE=process` only for local development without Docker.

Use the `Media` upload control after selecting a project to attach files under `public/uploads`; those paths are included in the Codex workflow instruction context. Use the `Project` upload control to import an existing `.zip` app into a new managed workspace. PlutoniX writes each managed project folder under the parent workspace `apps/` directory and adds that specific folder to `.gitignore` so projects stay detachable and untracked. Use `Export` to download the selected app as a zip containing source, frontend Dockerfile, backend service, PostgreSQL database service, `.env`, and `docker-compose.yml`.

Every created or imported app keeps project-scoped execution guidance inside `.agentic/orchestrator-agent.md`. PlutoniX Fullstack Agent remains the global planning and completion authority; it loads that local policy as context and delegates bounded work to project agents. Root `AGENTS.md` and `CLAUDE.md` continue to provide repository rules without allowing a project agent to redefine the PlutoniX parent task.

For a newly created project, PlutoniX safely extracts `orchestrator-temp/orchestrator-agent-001-main.zip` into the new app folder, strips the archive's wrapper directory, ignores `.DS_Store`, and preserves the generated app's runtime `.env`. The archive's canonical `AGENTS.md`, `CLAUDE.md`, `ROOT_WORKSPACE_GENERATION_POLICY.md`, `.codex/prompts`, PDF, docs, and supporting configuration are installed, and the ZIP SHA-256 is recorded in `.agentic/orchestrator-source.json`. PlutoniX then runs a separate ephemeral Codex command with `Use .codex/prompts/bootstrap-orchestrator.md and execute the bootstrap.`, verifies the required agent, registry, graph, D3, and observability artifacts, and only then reads and executes the UI application instruction. A failed extraction, bootstrap, verification, or first generation rolls the incomplete project back.

Use `Delete` on a non-default selected project to permanently remove its workspace, managed runtime containers, project/Compose database containers, volumes and networks, dependency volume, exports, registry record, generated agent records, and D3/Neo4j topology artifacts. The shared default generated site cannot be deleted.

## Codex MCP

PlutoniX no longer exposes a local `/mcp` server. Use the real Codex MCP integration from Codex itself, for example:

```bash
codex mcp-server
```

PlutoniX uses `POST /api/generate` for its Run workflow action and reports `codexMcp: external` from `GET /api/status`.
Inside Docker, the backend image installs the current Codex CLI package and mounts `${HOME}/.codex` at `/workspace/codex-home`, so `Run workflow` uses your authenticated Codex configuration. If Codex completes without changing generated-site files, the request fails instead of falling back to local code generation.

Every generation response includes `orchestrated`, which shows the orchestrator agent's normalized objective, page type, topic, audience, tone, sections, constraints, and handoff metadata.

## Generated App Restart

By default, PlutoniX uses the generated app's Vite hot reload after each successful generation. This avoids browser `ERR_CONNECTION_RESET` and WebSocket errors while the preview iframe is open. If you need a hard generated-site container restart, set `RESTART_GENERATED_CONTAINER=true`; the backend container already mounts `/var/run/docker.sock` and can restart `plutonix-generated-site` through Docker's local API. If the socket is unavailable, generation still succeeds and the response reports the skipped restart status.

## MCP Runtime Log

Generation status is visible directly inside the PlutoniX chat. The chat combines user instruction bubbles with runtime process bubbles, keeps the latest 400 rows with the newest event at the top, and polls the backend log endpoint in addition to the live event stream. Chat timestamps are formatted in IST only.

Major workflow events also appear in the right-side `Activity log` and `Codex runtime log` cards. Events from the current workflow session are highlighted in light green.

The center `Playground` adapts to the selected output: browser/device preview, PDF reader, image/print canvas, workbook grid with formula inspection and sheet tabs, document page, slide stage, code/data viewer, audio player, or video player. Its artifact rail keeps every generated deliverable available to inspect, open, or download.

The `Open PlutoniX Graphical Model` button opens a D3 graph of the active agent, functionality clusters, child features, services, memory nodes, Neo4j artifacts, and human review node.

The PlutoniX Graphical Model workspace also includes the Self-Improvement Control Plane status and controls. See `docs/self-improvement-control-plane.md` for autonomy modes, safety gates, recovery commands, and current limitations.

The Agentic System documentation now includes the product-level PlutoniX source of truth at `docs/product-doc-plutonix.md`, covering positioning, users, workflows, requirements, architecture, safety model, success metrics, roadmap, and open product questions.

You can also inspect the same data directly:

```bash
curl http://localhost:8080/api/runtime-log
tail -f runtime/workflow-runtime-log.jsonl
```

The log records `request-received`, `orchestrated`, `file-plan`, `generating`, `files-applied`, `restarted`, and `generated`.
Detailed process rows also include build start, workspace resolution, individual file-operation start/done events, code generation completion, and runtime refresh status so the panel behaves like a live development task log.

## Generated App File Operations

The generator now applies an orchestrator file-operation plan instead of only rewriting one component. Each request can:

- `add` generated support files such as `catalogData.js`
- `modify` React, CSS, and metadata files
- `delete` obsolete generated modules

For example, a bag-business instruction generates a commerce landing page with a product catalog, material story, buying workflow, metadata, and a generated handoff README.
