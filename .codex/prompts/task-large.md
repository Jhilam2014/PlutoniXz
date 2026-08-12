Read AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md fully.

Enable orchestrator-agent mode.

Task: <write your task here>

Task size: large.

Rules:
- Do not modify AGENTS.md.
- Preserve existing features.
- For create/build work, consume and preserve the Product Shape Contract before selecting stack, routes, agents, files, or UI.
- When visible UI/functionality grows, apply the Agentic System design workshop lens: review UX workflow, frontend quality, accessibility, responsive behavior, visual hierarchy, and primary command placement while preserving all existing behavior.
- Select the smallest complete product shape and keep scope boundaries explicit.
- Do not substitute a generic React website, dashboard, hero/card/form template, fake data, or explanatory UI for the selected artifact and interaction model.
- Perform project discovery before implementation.
- Build execution topology.
- Create or reuse specialist agents.
- Break the work into tasks and assign to agents.
- Update local agent files under agents/generated/.
- Update Neo4j graph database artifacts for agents, workflows, components, APIs, services, files, and functionalities.
- Update PlutoniX Graphical Model page.
- Store redacted prompts, agent decisions, execution summaries, and validation summaries in vector memory.
- Use ChromaDB fallback if OpenAI Vector Store is missing.
- Follow ROOT_WORKSPACE_GENERATION_POLICY.md.

Validation:
- Run lint/build/test if available.
- Validate critical workflows.
- Check regression risk.
- If a command cannot run, explain why.

After completion, report:
- workflow created
- agents used or created
- tasks completed
- files modified
- validation result
- Neo4j update status
- vector memory provider used
- PlutoniX Graphical Model page path
