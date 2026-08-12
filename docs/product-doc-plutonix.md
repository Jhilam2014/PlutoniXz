# PlutoniX Product Document

Version: 1.0  
Date: 2026-08-08  
Status: Current product definition and roadmap

## 1. Product Summary

PlutoniX is an autonomous multi-artifact creation system. It turns instructions, uploaded project context, screenshots, source files, structured data, and iterative feedback into the most suitable digital output: web or mobile applications, focused tools, APIs, automations, PDFs, documents, flyers, images, presentations, videos, audio, Excel workbooks, CSV tables with formulas, and hybrid deliverables.

The product is not a prompt-to-page generator. Its central brain creates a binding Product Shape Contract before implementation, coordinates specialist agents, preserves the requested artifact as the primary deliverable, and validates it in an artifact-aware Playground. A browser page may support inspection, but it must never replace the requested workbook, PDF, image, flyer, media file, service, script, or packaged application.

## 2. Product Positioning

### Core Promise

PlutoniX helps a user move from an idea, reference, dataset, or existing workspace to a working, inspectable, exportable digital product with agentic planning and artifact-native evidence built in.

### Differentiators

- Project-owned execution: generated and imported apps live in managed project workspaces instead of being mixed into the PlutoniX host app.
- Product-shape intelligence: the central brain selects the smallest complete app, artifact, service, automation, or existing-product change instead of defaulting to React or a generic website.
- Multi-artifact generation: application code, PDFs, documents, flyers, images, presentations, workbooks, datasets, media, APIs, scripts, and automation packages are first-class outputs.
- Artifact-aware Playground: the center workspace changes to a browser/device frame, PDF reader, print/image canvas, workbook grid with formulas and sheet tabs, document page, presentation stage, code/data viewer, or media player.
- Agentic orchestration: PlutoniX restructures raw user instructions into safer build requests and delegates bounded work to global and project-local agents.
- Live runtime visibility: users see generation status, file operations, Codex runtime logs, activity logs, and workflow events while work is happening.
- Functionality analysis: project behavior is decomposed into functionality and subfunctionality graphs with node-level evidence and agent assignments.
- System topology: the PlutoniX Graphical Model workspace visualizes agents, memory, graph artifacts, runtime state, and self-improvement control-plane relationships.
- Safe platform evolution: self-improvement is evidence-backed, isolated, reviewed, and rollback-aware rather than a direct log-to-code loop.
- Deployment readiness: the cloud hosting workspace guides project selection, provider choice, permissions, credentials, plan preview, approval, simulated deployment, health check, and rollback.

## 3. Primary Users

### Solo Builder

Wants to describe a product or artifact, inspect it in the correct viewer, iterate quickly, export the real deliverable, and understand what changed.

Key needs:

- Fast creation from plain-language instructions and supplied references
- Native preview without local setup complexity
- Uploads for media, project archives, and design/source context
- Exportable project package
- Clear runtime status when generation is slow or fails

### Product Operator

Wants to manage multiple generated apps, track requirements, inspect functionality coverage, and prepare projects for hosting.

Key needs:

- Project dropdown and managed workspaces
- Functionality graph for requirement coverage
- Logs and generated artifacts as evidence
- Safe delete and export operations
- Hosting workflow with permission and credential checks

### Agent Platform Maintainer

Wants to evolve PlutoniX itself without destabilizing generated projects or overwriting user work.

Key needs:

- Feature inventory and baseline preservation
- Agent memory, D3 topology, Neo4j/vector artifacts
- Self-improvement signals, patterns, proposals, validations, reviews, and rollback controls
- Emergency stop, pause, resume, and autonomy-mode configuration

## 4. Current Product Surface

### Builder Workspace

The main PlutoniX app is a React/Vite frontend served at `http://localhost:5173`. It provides:

- Instruction/chat workflow for project generation
- Runtime process bubbles and activity log panels
- Center Playground iframe preview
- Artifact navigator and adaptive preview canvases for browser apps, PDF, image/print, workbook, document, presentation, code/data, audio, and video
- Project selector for generated and imported apps
- Upload controls for media and project archives
- Export and delete actions for managed projects
- PlutoniX Graphical Model access

### Backend Orchestration

The backend is a Node/Express service at `http://localhost:8080`. It provides:

- Generation endpoints, including `POST /api/generate`
- Runtime status endpoints
- Server-sent events and polling-backed runtime logs
- Codex workflow execution through authenticated Codex configuration
- Project management, workspace import/export, runtime startup, and cleanup
- Hosting workflow APIs
- Self-improvement APIs

Current README guidance says PlutoniX no longer exposes a local `/mcp` server; it uses real Codex MCP integration externally and reports `codexMcp: external` from status.

### Generated Project Runtime

Browser applications run separately from the PlutoniX control app. The default generated-site runtime is a Vite app at `http://localhost:5174`. Managed browser projects receive exclusive runtime ports. Non-browser deliverables are inspected directly from approved project artifact roots and do not need a fake web runtime.

Project behavior:

- New or imported projects are stored as named sibling workspaces.
- Project names are slugged and disambiguated when needed.
- PlutoniX writes project-specific `.agentic/orchestrator-agent.md` guidance.
- New projects can be bootstrapped from the orchestrator archive, verified, and rolled back if setup or first generation fails.
- Export produces a zip with source, frontend Dockerfile, backend service, PostgreSQL service, `.env`, and `docker-compose.yml`.
- Delete removes project workspace, managed containers, volumes, networks, exports, registry records, generated agents, and topology artifacts. The shared default generated site cannot be deleted.

## 5. Key Workflows

### 5.1 Generate The Correct Product Or Artifact

1. User selects or creates a project.
2. User enters a product, tool, document, data, media, automation, or application instruction in PlutoniX chat.
3. Frontend sends the request to the backend generation workflow.
4. The central brain classifies artifact type, product shape, interaction model, complexity, required data, output paths, and validation gates.
5. PlutoniX routes bounded work to the appropriate design, frontend, backend, data, document, media, spreadsheet, and QA specialists.
6. The orchestrator creates a file-operation and deliverable plan.
7. The backend applies add, modify, and delete operations in the selected workspace.
8. The real primary artifact is generated; browser runtime refresh is used only for browser-facing products.
9. The Playground switches to the correct native viewer and presents runtime, validation, formula, file, or media evidence.

Success response includes orchestration metadata such as normalized objective, page type, topic, audience, tone, sections, constraints, and handoff details.

### 5.2 Artifact-Aware Playground

1. PlutoniX reads the Product Shape Contract and generated artifact inventory.
2. The Playground selects the matching canvas: browser/device, PDF, image/print, workbook, document, slides, code/data, audio, or video.
3. The artifact rail allows the user to switch among all deliverables without leaving the project.
4. Workbook previews expose sheets, cell coordinates, values, and formulas rather than rendering a decorative HTML table.
5. DOCX and PPTX packages expose readable document paragraphs and slide content; downloadable originals remain authoritative.
6. The user can open or download the selected artifact directly from the persistent preview bar.

### 5.3 Import Existing Project

1. User uploads a `.zip` project archive.
2. PlutoniX extracts it into a managed workspace.
3. PlutoniX assigns an exclusive runtime port.
4. Project appears in the Playground selector.
5. Runtime inspection and preview switch to the selected project.

### 5.4 Attach Media Or Context

1. User selects a managed project.
2. User uploads media or supporting files.
3. Files are stored under the project `public/uploads` path.
4. Paths are included in Codex workflow instruction context.

### 5.5 Inspect Functionality Analysis

1. PlutoniX normalizes flow-path and instruction evidence into a functionality graph.
2. The graph shows project, functionality, and subfunctionality nodes.
3. Users can open detailed analysis, zoom/pan the graph, drag nodes, select nodes, and inspect node evidence.
4. The insight panel shows status, child nodes, assigned working agents, and supporting evidence.

### 5.6 Prepare Cloud Hosting

1. User opens the Cloud Hosting workspace.
2. Assistant guides project selection and deployment goal.
3. User selects provider, stack, and region.
4. PlutoniX previews permissions and credential method.
5. User enters credentials through secure onboarding.
6. PlutoniX previews deployment plan.
7. User approves.
8. Current implementation simulates deployment, health check, result, rollback, and finalization without mutating real cloud accounts.

### 5.7 Improve PlutoniX Itself

1. Runtime events, instruction timelines, token summaries, and health reports are observed.
2. Investigator decides whether a signal has enough evidence.
3. Aggregator groups related signals into patterns.
4. Trigger engine creates bounded triggers.
5. Evidence builder redacts and packages context.
6. Analyst and planner create improvement proposals.
7. Candidate worker isolates work and rollback artifacts.
8. Validation and independent review gates run.
9. Promotion policy stages or promotes depending on autonomy mode and risk.
10. Rollback controller records rollback if post-promotion metrics regress.

## 6. Functional Requirements

### Project Generation

- Accept natural-language build instructions.
- Normalize instructions through a PlutoniX authority/orchestrator step.
- Classify every request before stack selection and preserve the primary artifact intent.
- Generate or update the correct application, mobile surface, service, automation, document, print, data, workbook, image, presentation, audio, or video output.
- Apply file operations instead of single-file replacement only.
- Preserve generated app runtime stability through Vite hot reload when the selected output is browser-facing.
- Fail when execution completes without the requested primary artifact or relevant implementation evidence instead of silently fabricating success.

### Artifact Generation And Validation

- PDF and document requests must produce real downloadable files or valid document-rendering source with deliberate page composition, typography, graphics, print behavior, and accessibility where applicable.
- Flyer and image requests must produce inspectable visual assets at the requested size, format, resolution, and print/digital color intent.
- Spreadsheet requests must produce real `.xlsx`, `.xls`, `.csv`, or `.tsv` deliverables. Formulas, sheet structure, tables, formatting, validation, and recalculation requirements must be implemented and verified rather than simulated in HTML.
- Presentation requests must produce a real deck or an explicitly requested presentation-format source with coherent slide hierarchy and visual evidence.
- API, script, automation, and data-workflow requests must produce runnable entrypoints, contracts, dependencies, tests, and execution evidence; UI is optional unless requested.
- Every output must retain a source-consumption receipt, artifact inventory, validation result, and truthful unresolved-constraint record.

### Adaptive Playground

- Detect artifact kind from Product Shape metadata and verified file MIME/extension data.
- Present purpose-built viewers for browser, PDF, image/print, workbook, document, presentation, code/data, audio, and video outputs.
- Keep artifact switching, opening, and downloading available in the primary visible workspace.
- Parse workbook sheets and formulas using structured package data and bounded preview limits.
- Extract bounded readable previews from DOCX, PPTX, Markdown, text, JSON, YAML, scripts, CSV, and TSV while preserving the original file as authoritative.

### Project Management

- Create, import, select, export, and delete managed projects.
- Assign exclusive project ports.
- Keep generated projects detachable and untracked where intended.
- Preserve project-scoped `.agentic` guidance.
- Roll back incomplete new-project setup on extraction, bootstrap, verification, or first-generation failure.

### Observability

- Show runtime process events in the chat.
- Keep latest 400 runtime rows visible.
- Support SSE plus polling fallback.
- Format displayed timestamps in IST.
- Highlight current-session events.
- Persist runtime logs to JSONL.

### Functionality Analysis

- Normalize legacy flow evidence and explicit functionality graphs.
- Preserve initial instruction functionality when later flows are merged.
- Show project, functionality, and subfunctionality nodes.
- Support detailed graph zoom, pan, node drag, and node selection.
- Show node evidence and assigned agents without inventing responsibility.

### Agentic System Graph

- Visualize agents, memory nodes, graph/vector artifacts, validation, ownership, and self-improvement relationships.
- Support modes for overview, dependency view, live execution, and explore.
- Include search, filters, legend, minimap, details drawer, progressive rendering, and canvas edges for large graphs.

### Hosting

- Guide user through deployment stages.
- Validate stage order.
- Preview provider permissions.
- Collect credentials through a secure workflow.
- Produce deployment plans and audit events.
- Current shipped behavior must remain mock-safe until real provider integrations are explicitly enabled.

### Self-Improvement

- Treat logs, generated content, and model output as untrusted.
- Redact secrets and sensitive records in evidence packages.
- Preserve feature inventory.
- Require isolation, validation, review, and rollback readiness before promotion.
- Support sandbox, controlled auto, and advanced auto policy modes.
- Support monetary approval gates for paid tools and services.
- Provide pause, resume, emergency stop, and status APIs.

## 7. Non-Functional Requirements

### Reliability

- Generated project preview should avoid unnecessary iframe resets.
- Runtime log visibility should survive SSE drops.
- Project creation should be transactional enough to roll back incomplete setup.
- Large graph rendering should remain responsive through progressive rendering and canvas edges.

### Safety

- Generated-project workspaces must not be able to redefine PlutoniX parent task authority.
- Self-improvement must not mutate live platform source directly from logs or model responses.
- Paid resources require explicit approval.
- Secrets and credentials must not appear in evidence packages or logs.

### Portability

- Generated projects should be exportable as source plus Docker/runtime packaging.
- PlutoniX should work through Docker Compose for local operation.
- Project runtimes should remain separable from the PlutoniX host.

### Auditability

- Every meaningful workflow should produce runtime events.
- Generated file operations should be visible.
- Hosting actions should write sanitized audit events.
- Self-improvement cycles should retain proposals, validations, reviews, promotions, and rollback records.

## 8. Architecture Overview

```text
Instruction + references + real data
                |
                v
       PlutoniX central brain
                |
                v
       Product Shape Contract
                |
     +----------+-----------+----------------+
     |          |           |                |
 App/runtime  Document   Workbook/data   Media/service
     |          |           |                |
     +----------+-----------+----------------+
                |
                v
       Artifact-native validation
                |
                v
 Adaptive Playground + evidence + export
```

Runtime services:

- `frontend`: React/Vite control surface.
- `backend`: Express API, SSE, project/workflow/hosting/self-improvement services.
- `generated-site`: isolated default generated preview runtime.
- Managed project runtimes: per-project generated/imported apps with exclusive ports.

Important backend modules:

- `plutonixAuthority.js`: global planning and completion authority.
- `codexWorkflow.js`: Codex-backed workflow execution.
- `generator.js`: generated source/file operation handling.
- `projectManager.js`: managed workspace and runtime operations.
- `projectBootstrap.js`: orchestrator bootstrap and verification.
- `functionalityGraph.js`: functionality graph backend support.
- `hosting/*`: stage-based hosting workflow.
- `selfImprovement/*`: control-plane observer, investigator, planner, validation, promotion, and rollback services.

Important frontend modules:

- `App.jsx`: main PlutoniX control surface, project workflow, runtime panels, functionality analysis.
- `functionalityGraphModel.js`: functionality graph normalization, merging, layout, and insights.
- `pages/CloudHostingPage.jsx`: guided hosting workspace.
- `public/agentic-system/d3/*`: standalone Agentic System topology workspace.

## 9. Data And Memory Model

PlutoniX stores and reads several evidence layers:

- Runtime logs under `runtime/`.
- Project-local `.agentic` guidance and orchestrator-source records.
- Generated agent registry records.
- Functionality graph evidence from instructions, flow paths, changed files, and explicit functionality graph payloads.
- Vector memory and Neo4j/D3 topology artifacts.
- Self-improvement JSONL/JSON state under `runtime/self-improvement` and `observability/self-improvement`.

The product should treat local artifacts as authoritative until live credentials and external stores are configured and verified.

## 10. Success Metrics

### Generation Quality

- Percentage of runs that produce meaningful changed-file evidence.
- Preview health after generation.
- Number of user corrections required per successful project.
- Functionality coverage against initial instruction.
- Primary-artifact completion rate by artifact type.
- Workbook formula and sheet-validation pass rate.
- PDF, print-layout, and media-fidelity validation pass rate.

### Runtime Reliability

- Project runtime startup success rate.
- Average time to healthy preview.
- Generation failure recovery rate.
- Frequency of iframe/runtime reset issues.

### Product Usability

- Time from instruction to first useful preview.
- Time from instruction to first valid native artifact preview.
- Number of successful imports and exports.
- Usage of functionality analysis detail view.
- Hosting workflow completion rate.

### Agentic Safety

- Self-improvement proposal validation pass rate.
- Number of blocked unsafe proposals.
- Rollback readiness coverage.
- Monetary approval requests resolved through approve, cheaper-solution, or reject.

## 11. Current Limitations

- Cloud hosting workflow is mock-safe and does not mutate real cloud accounts.
- Self-improvement live patch generation is intentionally not enabled in the default vertical slice.
- Rule-based analysis is the default for self-improvement unless a provider-neutral model adapter is configured.
- Production-grade self-improvement would need durable queue/lock infrastructure if multiple backend instances run without a shared runtime volume.
- Some older architecture docs mention a local MCP-compatible endpoint, while the current README states PlutoniX uses external Codex MCP integration and no longer exposes local `/mcp`.

## 12. Roadmap

### Near Term

- Stabilize Functionality Analysis D3 interactions across dense graphs and modal resizing.
- Add explicit product-level empty, error, and recovery states for all long-running workflows.
- Expand structured previews with document page thumbnails, slide rendering, workbook styles, charts, and recalculated formula evidence.
- Improve generated-project health checks and preview readiness diagnostics.
- Add a clearer project passport view with requirements, files changed, agents involved, tests, risks, and export status.
- Expand smoke tests for project import/export/delete and functionality graph interaction.

### Mid Term

- Convert mock-safe hosting into provider-specific deployment adapters behind explicit credential and permission gates.
- Add deploy-result verification with logs, URLs, health checks, rollback evidence, and cost estimate.
- Improve project-local agent selection and reuse based on capability scoring.
- Add richer requirement traceability between user instruction, functionality graph, file operations, and generated UI.
- Add visual diff or before/after preview for generated app changes.

### Long Term

- Productionize self-improvement with durable queueing, stronger policy configuration, candidate branch management, benchmark comparison, and full rollback automation.
- Support multi-user permissions for project ownership, hosting credentials, and administrative self-improvement actions.
- Add marketplace-style reusable project templates, agent packs, and deployment recipes.
- Integrate verified external memory/vector/graph stores as optional production backends.

## 13. Product Principles

- Keep generated projects owned, separable, and inspectable.
- Preserve the requested artifact as the product; never substitute a generic webpage.
- Match validation and Playground behavior to the output type.
- Prefer visible workflow evidence over hidden “AI magic.”
- Preserve user work and project boundaries.
- Treat logs and model outputs as untrusted inputs.
- Make risky actions explicit: deletion, deployment, paid tools, source mutation, and promotion.
- Design for recovery: failed setup, bad generation, unhealthy preview, unsafe improvement, deployment issue, or regression should all have a path back.

## 14. Open Product Questions

- What is the first paid customer segment: solo builders, agencies, internal tooling teams, or AI platform maintainers?
- Should PlutoniX optimize first for app generation quality, hosting completion, or agentic governance trust?
- Which deployment providers should graduate from mock-safe workflow first?
- How much project history should be retained locally by default?
- Should functionality analysis become the primary planning surface before generation, or remain an inspection surface after generation?
- What level of autonomy should be acceptable for platform self-improvement in production?
