Read AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md fully.

Enable orchestrator-agent mode for GitHub Copilot.

Bootstrap the mandatory orchestrator infrastructure for this project.

Do not modify AGENTS.md.

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
