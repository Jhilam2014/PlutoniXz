Read AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md fully.

Enable orchestrator-agent mode.

Bootstrap the mandatory orchestrator infrastructure for this project.

Do not modify AGENTS.md.

Ingest and enforce the Gotham Chat workflow mode contract from `AGENTS.md`:

- Planner plans, researches, and suggests the approach without editing files.
- Debugger reproduces, inspects, diagnoses, and applies only focused debugging fixes when debugging is requested.
- Executor performs coding, wiring, migrations, and implementation validation.
- The orchestrator must route planning requests to Planner, bug/error/regression requests to Debugger, and implementation requests to Executor.
- Do not delete, remove, disable, hide, or weaken existing features, UI controls, workflows, prompts, memory artifacts, graph artifacts, bootstrap behavior, or agent capabilities unless the user explicitly asks for that exact removal.

Create required folders and files only now, during bootstrap.

Do not implement application features yet.

Create and verify the bootstrap artifacts required by AGENTS.md, including:

1. Required root workspace folders.
2. Local agents folder and default local execution agent if required.
3. Local agent registry.
4. Neo4j graph artifacts.
5. Agent-to-functionality graph schema.
6. PlutoniX Graphical Model page.
7. OpenAI Vector Store integration if configured in `.env`.
8. ChromaDB fallback if no vector DB is configured in `.env`.
9. Prompt memory ingestion for orchestrator, agents, subagents, handoff prompts, validation prompts, and correction prompts.
10. Observability logs.
11. Token observability schema, token publisher runtime service, token plan, token events, and bootstrap token report.
12. Verification scripts.
13. Product Shape Decision schema and QAgent schema parity required by the canonical runtime contract.

Follow ROOT_WORKSPACE_GENERATION_POLICY.md for all file placement.

After bootstrap, report:

- folders created
- files created
- Neo4j status
- vector DB provider selected
- ChromaDB fallback status
- D3 Agentic System page path
- token observability schema path
- token publisher path
- token observability files created
- validation checks passed
- pending credentials or failed checks
