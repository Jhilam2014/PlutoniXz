Read AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md fully.

Enable orchestrator-agent mode.

Task: <write your task here>

Task size: tiny or small.

Rules:
- Do not modify AGENTS.md.
- Preserve existing features.
- For create/build work, consume and preserve the Product Shape Contract before selecting stack, routes, files, or UI.
- When visible UI/functionality grows, apply the Agentic System design workshop lens: review UX workflow, frontend quality, accessibility, responsive behavior, visual hierarchy, and primary command placement while preserving all existing behavior.
- Select the smallest complete product shape and keep scope boundaries explicit.
- Do not substitute a generic React website, dashboard, hero/card/form template, fake data, or explanatory UI for the selected artifact and interaction model.
- Use Token-Minimal Coding Mode.
- Reuse existing code and agents before creating new ones.
- Patch only necessary files.
- Do not rewrite the whole project.
- Do not invent files, APIs, imports, tests, assets, or sync results.
- Do not run full project discovery unless required.
- Do not run full Neo4j/D3 regeneration unless required.
- However, always perform mandatory incremental Neo4j, D3, vector memory, prompt ledger, and observability updates when project artifacts are modified.
- Use ChromaDB fallback if OpenAI Vector Store is missing.
- Follow ROOT_WORKSPACE_GENERATION_POLICY.md.

Validation:
- Run lint/build/test if available.
- If a command cannot run, explain why.

After completion, report:
- files modified
- changes made
- validation result
- Neo4j update status
- vector memory provider used
- PlutoMix Graphical Model page path
