# CLAUDE.md

Generated at: 2026-06-23T07:54:19.692369+00:00

This file is a Claude/Claude Code adapter for the project orchestrator.

Important:
- Do not duplicate or override the canonical orchestrator instruction.
- The canonical orchestrator instruction is `AGENTS.md`.
- If this file conflicts with `AGENTS.md`, `AGENTS.md` wins.
- The content of `AGENTS.md` must not be changed by setup prompts.

## Claude startup behavior

Claude Code must read these files before executing a task:

1. `CLAUDE.md`
2. `AGENTS.md`
3. `ROOT_WORKSPACE_GENERATION_POLICY.md`
4. selected task template from `.claude/prompts/`
5. user task

## Task routing

When the user provides:

```text
Task type: tiny | small | medium | large
Task: <task description>
```

Claude must load the matching template:

- tiny -> `.claude/prompts/task-small.md`
- small -> `.claude/prompts/task-small.md`
- medium -> `.claude/prompts/task-medium.md`
- large -> `.claude/prompts/task-large.md`

Claude must use `.claude/prompts/bootstrap-orchestrator.md` for bootstrap-only workflows and `.claude/prompts/task-router.md` for task type routing.

## Claude rules

1. Do not silently skip mandatory orchestrator artifacts required by `AGENTS.md`.
2. Do not invent command results, test results, Neo4j sync, vector sync, or deployment status.
3. If credentials are missing, generate local artifacts and mark sync pending.
4. If vector DB is missing, follow the ChromaDB fallback behavior defined in `AGENTS.md`.
5. Preserve existing files and behavior unless explicitly asked to change them.
6. Follow `ROOT_WORKSPACE_GENERATION_POLICY.md` for generated artifacts.
7. Use concise reports for tiny/small tasks.
8. Use structured plans for medium/large tasks.
9. Apply the Gotham Chat workflow mode contract from `AGENTS.md`: Planner plans only, Debugger diagnoses and fixes narrowly, and Executor performs coding work.
10. Do not delete, remove, disable, hide, or weaken existing features, UI controls, workflows, prompts, memory artifacts, graph artifacts, or agent capabilities unless the user explicitly requests that exact removal.
11. For create/build work, consume the canonical Product Shape Contract before selecting stack, routes, agents, files, or UI; preserve non-web artifact intent and reject generic website/dashboard/template coercion.
12. When visible UI/functionality grows, apply the Agentic System design workshop lens from `AGENTS.md`: review UX workflow, frontend quality, accessibility, responsive behavior, visual hierarchy, professional aesthetic quality, and primary command placement while preserving all behavior.
13. Apply the Universal Instruction and Response Quality Contract in `AGENTS.md` and `docs/agent-instruction-quality.md`: use explicit Goal, Context, Scope, Constraints, Requirements, and Done when criteria; plan complex work before editing; and report only evidence-backed outcomes, validation, and fallbacks.
