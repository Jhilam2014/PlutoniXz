Read AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md fully.

Apply the Universal Instruction and Response Quality Contract in `AGENTS.md`: use Goal, Context, Scope, Constraints, Requirements, and Done when criteria; plan complex work before editing; and report only evidence-backed outcomes, validation, and fallbacks.

The user may provide only:

Task type: tiny | small | medium | large
Task: <task description>

The user may also choose or imply a Gotham Chat workflow mode:

- Planner: plan, research, estimate, architect, or suggest an approach. Do not edit files in Planner mode.
- Debugger: reproduce, inspect, diagnose, trace, and fix focused bugs or regressions.
- Executor: implement, code, wire, migrate, refactor, and validate feature work.

Route planning-language requests to Planner, bug/error/regression requests to Debugger, and implementation-language requests to Executor. Preserve all existing features and do not delete, remove, disable, hide, or weaken behavior unless the user explicitly asks for that exact removal.

For create/build requests, consume the deterministic Product Shape Contract from `AGENTS.md` before selecting stack, routes, agents, files, or UI. Preserve non-web artifact intent, choose the smallest complete product shape, and do not silently reclassify the task as a React website or dashboard.

When visible UI/functionality grows, require the Agentic System design workshop lens from `AGENTS.md`: review UX workflow, frontend quality, accessibility, responsive behavior, visual hierarchy, professional aesthetic quality, and primary command placement while preserving all behavior.

Automatically load the matching task template:

- tiny -> .codex/prompts/task-small.md
- small -> .codex/prompts/task-small.md
- medium -> .codex/prompts/task-medium.md
- large -> .codex/prompts/task-large.md

Apply the selected template completely.

Do not ask the user to paste the full template.

If the template file is missing, stop and report the missing path.

After loading the template, execute the task according to:

1. AGENTS.md
2. ROOT_WORKSPACE_GENERATION_POLICY.md
3. selected task template
4. user task

Do not modify AGENTS.md unless the user explicitly says to modify the canonical orchestrator instruction.
