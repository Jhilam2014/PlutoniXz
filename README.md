# PlutoMix

PlutoMix is an autonomous multi-artifact creation system. It classifies each instruction before implementation and can generate applications, mobile surfaces, tools, APIs, automations, PDFs, documents, flyers, images, presentations, media, and formula-driven Excel or CSV workbooks. Browser products run in isolated preview containers; non-browser outputs remain real downloadable artifacts and open in an adaptive Playground.

## Services

- `frontend`: React control surface at `http://localhost:5173`.
- `backend`: Node/Express API at `http://localhost:8080`.
- `generated-site`: isolated generated webpage preview at `http://localhost:5174`.
- `researchx-worker`: an optional, profile-gated PostgreSQL-backed research worker. It is absent from a normal `docker compose up`.

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

Submit an instruction in the PlutoMix chat. The central brain creates a Product Shape Contract, identifies required data and output paths, delegates to appropriate specialist agents, and validates the real primary deliverable. React/Vite generation is used for browser-facing products; document, print, workbook, media, service, and automation requests use their task-appropriate formats and runtimes.

## Projects, Uploads, And Export

New and imported projects are stored as named sibling folders directly under the parent `money` root, assigned an exclusive port from `PROJECT_PORT_START` to `PROJECT_PORT_END`, and shown in the Playground project dropdown. For example, a project named `Travel CRM` is created at `../travel-crm`; another project with the same name becomes `../travel-crm-2`. PlutoMix remains the host/control app; selecting a project inspects its dedicated runtime container, starts or recreates it when necessary, waits for the assigned port to become healthy, and then switches the iframe preview. Set `PROJECT_RUNTIME_MODE=process` only for local development without Docker.

Use the `Media` upload control after selecting a project to attach files under `public/uploads`; those paths are included in the Codex workflow instruction context. Use the `Project` upload control to import an existing `.zip` app into a new managed workspace. PlutoMix writes each managed project folder under the parent workspace `apps/` directory and adds that specific folder to `.gitignore` so projects stay detachable and untracked. Use `Export` to download the selected app as a zip containing source, frontend Dockerfile, backend service, PostgreSQL database service, `.env`, and `docker-compose.yml`.

Every created or imported app keeps project-scoped execution guidance inside `.agentic/orchestrator-agent.md`. PlutoMix Fullstack Agent remains the global planning and completion authority; it loads that local policy as context and delegates bounded work to project agents. Root `AGENTS.md` and `CLAUDE.md` continue to provide repository rules without allowing a project agent to redefine the PlutoMix parent task.

For a newly created project, PlutoMix safely extracts `orchestrator-temp/orchestrator-agent-001-main.zip` into the new app folder, strips the archive's wrapper directory, ignores `.DS_Store`, and preserves the generated app's runtime `.env`. The archive's canonical `AGENTS.md`, `CLAUDE.md`, `ROOT_WORKSPACE_GENERATION_POLICY.md`, `.codex/prompts`, PDF, docs, and supporting configuration are installed, and the ZIP SHA-256 is recorded in `.agentic/orchestrator-source.json`. PlutoMix then runs a separate ephemeral Codex command with `Use .codex/prompts/bootstrap-orchestrator.md and execute the bootstrap.`, verifies the required agent, registry, graph, D3, and observability artifacts, and only then reads and executes the UI application instruction. A failed extraction, bootstrap, verification, or first generation rolls the incomplete project back.

Production mounts the PlutoMix Git checkout read-only. Mutable topology, agent registry, workflow publication, memory, observability, model-pool, and self-improvement state is written under the persisted `/workspace/runtime` mount; generated applications remain under `/workspace/apps`. The deployment script still rejects genuine tracked source edits on the server, and production runtime state must never be committed or pushed from the deployment host.

Use `Delete` on a non-default selected project to permanently remove its workspace, managed runtime containers, project/Compose database containers, volumes and networks, dependency volume, exports, registry record, generated agent records, and D3/Neo4j topology artifacts. The shared default generated site cannot be deleted.

## Governed Enterprise BrainX

BrainX Enterprise Core is an opt-in decision-control layer over Decision Continuity. It records real development decisions and constraints, uses policy/budget/evidence receipts for governed model routing, limits reusable AgenticX knowledge to sanitized same-tenant context, and lets ResearchX produce reviewable observations from tenant-approved sources. It does not make legal/compliance certifications, automatically deploy, invoke a paid model, download a Hugging Face model, or browse the unrestricted internet.

The Analysis workspace preserves the existing portfolio and decision-map views and adds a BrainX workspace for policy/budget state, ResearchX findings, AIX route rationale, DecisionX history, and AgenticX reuse receipts. Strict Enterprise Brain APIs use the existing OIDC membership/RBAC layer; legacy portfolio tags and sharing-agreement JSON remain projection data, not authorization. See [Enterprise BrainX governance](docs/enterprise-brainx-governance.md).

Portfolio Intelligence and the Delivery Decision Graph use lightweight default previews and mount their interactive D3 canvases only in dedicated popups. Portfolio application artwork comes from the matching BuildX project icon. Delivery agent artwork shares the Global Agent Memory avatar source; functionality uses recorded-category icons; service and chronology relationships use directional storyboard-style segues. The detail canvas prevents rectangular node overlap and supports wheel/double-click/button zoom, background pan, collision-aware node dragging, Fit, Reset view, and Reset layout. Compact canvas labels are presentation-only—the adjacent inspector remains authoritative for full names, evidence, constraints, and chronology. See [PlutoMix Product Document](docs/product-doc-plutomix.md#551-operate-the-intelligence-canvases).

ResearchX stays disabled until its feature, worker, network, named-tenant, domain allowlist, PostgreSQL, policy/budget, and egress controls have all been configured. After the controlled migration, an operator can explicitly start its profile:

```bash
docker compose build backend
docker compose --profile decision-continuity-production run --rm decision-continuity-migrate
docker compose --profile researchx up researchx-worker
```

## Gotham Studio

Gotham Builder includes a protected, project-scoped **Studio** workspace for governed AI/ML execution. It stores provider-neutral pipeline, job, experiment, model, provider-check, and lifecycle records; submits real Databricks or Azure Machine Learning jobs only from Executor mode; reconciles provider state in the backend; and keeps provider credentials outside the browser. Provider-specific logs, MLflow metrics, artifacts, cancellation, and outbound links appear only when the active adapter advertises those capabilities. Empty and unavailable values remain explicit rather than being simulated.

Configure the backend variables in `.env`, apply migration `012_gotham_studio.sql` before production rollout, restart the backend, select a project in Builder, and open **Studio** beside the Gotham Intel control. Production uses PostgreSQL; the atomic file repository is limited to development and tests. See [Gotham Studio operations and architecture](docs/gotham-studio.md) for provider setup, APIs, security controls, persistence, and current adapter limitations.

## Tenant and enterprise administration

BrainX requires every new or imported app to select an enterprise label and either the global community agent catalog or an enterprise-specific catalog. PostgreSQL owns tenant instances, enterprise assignments, tenant-wide team memberships, and the platform-admin portfolio. A tenant can hold at most two enterprises; a database trigger enforces that limit during concurrent writes, and an enterprise with applications cannot be deleted. New tenant app workspaces are isolated under `apps/tenants/<tenant-instance-key>/` while legacy project paths remain compatible.

Apply migrations `014_tenant_governance.sql` and `015_tenant_governance_instance_backfill.sql`, provision tenant owners with the `tenant_admin` role at workspace `*`, and open **Tenant admin** in the Gotham Builder header. Optional Google JIT onboarding can provision verified users into one server-configured tenant; only an exact configured issuer + subject + email identity receives administrator authority. The separately authorized **Admin** tenant table reads the cross-tenant portfolio from the backend and is not rendered for ordinary members. See [Tenant governance](docs/tenant-governance.md) for APIs, onboarding configuration, invitation acceptance, isolation, deployment, and rollback.

## Run Gotham with Codex or Claude Code without VS Code

Gotham Builder manages documented CLI sign-in and isolated account profiles from the **AI Accounts** control in the chat header. It detects Codex, Claude Code, GitHub Copilot, Cursor, and Emergent, exposes only capability-backed actions, supports global/workspace activation, and freezes the selected provider/profile into every model call in a job. Connected Codex and Claude profiles can be selected with **Use for Gotham**. Apply migration \`013_ai_provider_profiles.sql\` for production. See [AI provider profiles](docs/ai-provider-profiles.md) for the generated capability matrix, isolation/security contract, installation, and troubleshooting.

Install Codex, then start Gotham and use **AI Accounts** for normal sign-in. The terminal command below remains an operator recovery/bootstrap option:

```bash
npm install -g @openai/codex
codex login --device-auth
docker compose up --build
```

VS Code may remain completely closed; neither the Codex nor Claude Code VS Code extension is required. The PlutoMix backend owns each provider CLI process, selects the registered project workspace as its working directory, parses bounded JSONL events, and streams only safe activity and final response evidence to Gotham Chat. Claude browser/SSO sign-in is started from **AI Accounts**: open the approved verification page and, when Claude displays a one-time authorization code, paste it into the protected AI Accounts field so it can be sent directly to the waiting CLI. The host or server running the backend must remain running while a task executes.

The backend image installs the pinned `@openai/codex` version selected by `CODEX_VERSION` and `@anthropic-ai/claude-code@2.1.251` by default through `CLAUDE_VERSION`. Docker mounts only the host Codex configuration directory at `/workspace/codex-home`; isolated Claude profiles remain under `AI_PROVIDER_RUNTIME_ROOT` in the persisted narrow `runtime` mount. Do not mount the host's whole home or `~/.claude`. A host OS keyring is not available inside the Linux container, so container deployments must use a provider-supported file-backed or separately governed server authentication method.

Runtime variables:

```env
CODEX_BIN=/usr/local/bin/codex
CODEX_HOME=/workspace/codex-home
CODEX_WORKFLOW_TIMEOUT_MS=600000
CLAUDE_VERSION=2.1.251
CLAUDE_BIN=/usr/local/bin/claude
CLAUDE_WORKFLOW_TIMEOUT_MS=600000
CLAUDE_WORKFLOW_MAX_TURNS=40
AI_PROVIDER_RUNTIME_ROOT=/workspace/runtime/ai-provider-profiles
GOTHAM_RUNTIME_PROBE=true
GOTHAM_FALLBACK_MODEL=
```

`GOTHAM_FALLBACK_MODEL` is intentionally empty. A provider uses its authenticated default model unless a validated server-governed route explicitly selects a model. Browser callers cannot supply raw flags, sandbox modes, approval settings, or executables. Claude runs headlessly with `--restricted`, backend-owned fail-closed sandbox settings, bounded turns/time, and a fixed tool allowlist. The Linux sandbox requires Bubblewrap and `socat`, both installed in the backend image. PlutoMix does not use `--dangerously-skip-permissions` or `bypassPermissions`.

Verify the installation, mounted authentication, backend status, and direct transport:

```bash
docker compose config
docker compose build backend
docker compose up -d
docker compose exec backend codex --version
docker compose exec backend codex login status
docker compose exec backend claude --version
docker compose exec backend claude auth status
curl http://localhost:8080/api/status
```

`GET /api/status` separates backend liveness from Codex readiness. Its `codex` object reports the CLI version, availability, authentication state, backend ownership, and `requiresVsCode: false`. If it reports `authentication_required`, run `codex login --device-auth` on the host and confirm that `HOST_CODEX_HOME` maps that same configuration directory. If the CLI is unavailable, rebuild with a valid pinned `CODEX_VERSION` and verify `CODEX_BIN`. If workspace execution is blocked, inspect the safe sandbox diagnostic in the runtime log and verify the narrow project mounts and container security policy.

Use the square Stop control shown beside the active Gotham instruction to call `POST /api/generate/stop`. The backend sends `SIGTERM`, escalates to `SIGKILL` after a short grace period if necessary, and cleans up active provider children during timeout or backend shutdown.

PlutoMix does not run deprecated `codex mcp-server` and does not expose a generic remote-code-execution or public MCP endpoint. `POST /api/generate` is the direct backend-managed CLI route. The optional `POST /api/generate/mcp` UI mode is only an in-process Gotham orchestration bridge; it terminates in the same controlled Codex runtime adapter and project security boundary.

If the selected provider completes without changing meaningful project files, the request fails instead of falling back to local code generation or silently switching accounts.

Every generation response includes `orchestrated`, which shows the orchestrator agent's normalized objective, page type, topic, audience, tone, sections, constraints, and handoff metadata.

## Generated App Restart

By default, PlutoMix uses the generated app's Vite hot reload after each successful generation. This avoids browser `ERR_CONNECTION_RESET` and WebSocket errors while the preview iframe is open. If you need a hard generated-site container restart, set `RESTART_GENERATED_CONTAINER=true`; the backend container already mounts `/var/run/docker.sock` and can restart `plutomix-generated-site` through Docker's local API. If the socket is unavailable, generation still succeeds and the response reports the skipped restart status.

## Workflow Runtime Log

Generation status is visible directly inside the PlutoMix chat. The chat combines user instruction bubbles with workflow process bubbles, keeps the latest 400 rows with the newest event at the top, and polls the backend log endpoint in addition to the live event stream. Chat timestamps are formatted in IST only.

Major workflow events also appear in the right-side `Activity log` and runtime-log cards. Events from the current workflow session are highlighted in light green. Some UI/event names retain `MCP` for the optional internal Gotham bridge; they do not indicate a public `/mcp` endpoint.

The center `Playground` adapts to the selected output: browser/device preview, PDF reader, image/print canvas, workbook grid with formula inspection and sheet tabs, document page, slide stage, code/data viewer, audio player, or video player. Its artifact rail keeps every generated deliverable available to inspect, open, or download.

The `Open PlutoMix Graphical Model` button opens a D3 graph of the active agent, functionality clusters, child features, services, memory nodes, Neo4j artifacts, and human review node.

The PlutoMix Graphical Model workspace also includes the Self-Improvement Control Plane status and controls. See `docs/self-improvement-control-plane.md` for autonomy modes, safety gates, recovery commands, and current limitations.

The Agentic System documentation now includes the product-level PlutoMix source of truth at `docs/product-doc-plutomix.md`, covering positioning, users, workflows, requirements, architecture, safety model, success metrics, roadmap, and open product questions.

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
