Read AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md fully.

Apply the Universal Instruction and Response Quality Contract in `AGENTS.md`: use Goal, Context, Scope, Constraints, Requirements, and Done when criteria; plan complex work before editing; and report only evidence-backed outcomes, validation, and fallbacks.

The user may provide only:

```text
Task type: tiny | small | medium | large
Task: <task description>
```

For create/build requests, consume the deterministic Product Shape Contract from `AGENTS.md` before selecting stack, routes, agents, files, or UI. Preserve non-web artifact intent, choose the smallest complete product shape, and do not silently reclassify the task as a React website or dashboard.

When visible UI/functionality grows, require the Agentic System design workshop lens from `AGENTS.md`: review UX workflow, frontend quality, accessibility, responsive behavior, visual hierarchy, professional aesthetic quality, and primary command placement while preserving all behavior.

Automatically load the matching GitHub Copilot task prompt:

- tiny -> `.github/prompts/task-small.prompt.md`
- small -> `.github/prompts/task-small.prompt.md`
- medium -> `.github/prompts/task-medium.prompt.md`
- large -> `.github/prompts/task-large.prompt.md`

Apply the selected prompt completely.

Do not ask the user to paste the full prompt.

If the prompt file is missing, stop and report the missing path.

After loading the prompt, execute the task according to:

1. AGENTS.md
2. ROOT_WORKSPACE_GENERATION_POLICY.md
3. selected GitHub Copilot task prompt
4. user task

Do not modify AGENTS.md unless the user explicitly says to modify the canonical orchestrator instruction.
