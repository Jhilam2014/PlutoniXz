# GitHub Copilot instructions for PlutoniX

The canonical orchestrator instruction is `AGENTS.md`.

Do not duplicate, override, or weaken `AGENTS.md`. If this file conflicts with `AGENTS.md`, `AGENTS.md` wins.

Before implementing a task, read:

1. `AGENTS.md`
2. `ROOT_WORKSPACE_GENERATION_POLICY.md`
3. the selected prompt file from `.github/prompts/`
4. the user task

When the user provides:

```text
Task type: tiny | small | medium | large
Task: <task description>
```

Use `.github/prompts/task-router.prompt.md`, then load:

- tiny -> `.github/prompts/task-small.prompt.md`
- small -> `.github/prompts/task-small.prompt.md`
- medium -> `.github/prompts/task-medium.prompt.md`
- large -> `.github/prompts/task-large.prompt.md`

Rules:

1. Preserve existing behavior unless the user explicitly requests a change.
2. Do not silently skip mandatory orchestrator artifacts required by `AGENTS.md`.
3. Do not invent command results, test results, Neo4j sync, vector sync, or deployment status.
4. If credentials are missing, generate local artifacts and mark sync pending.
5. If vector DB is missing, follow the ChromaDB fallback behavior defined in `AGENTS.md`.
6. Follow `ROOT_WORKSPACE_GENERATION_POLICY.md` for generated artifacts.
7. Use concise reports for tiny/small tasks.
8. Use structured plans for medium/large tasks.
9. For create/build work, consume the canonical Product Shape Contract before selecting stack, routes, agents, files, or UI; preserve non-web artifact intent and reject generic website/dashboard/template coercion.
10. When visible UI/functionality grows, apply the Agentic System design workshop lens from `AGENTS.md`: review UX workflow, frontend quality, accessibility, responsive behavior, visual hierarchy, professional aesthetic quality, and primary command placement while preserving all behavior.
11. Apply the Universal Instruction and Response Quality Contract in `AGENTS.md` and `docs/agent-instruction-quality.md`: use explicit Goal, Context, Scope, Constraints, Requirements, and Done when criteria; plan complex work before editing; and report only evidence-backed outcomes, validation, and fallbacks.
