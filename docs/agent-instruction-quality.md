# Agent Instruction And Response Quality Standard

This is the shared instruction and response standard for PlutoMix agents, specialist agents, QAgents, and provider adapters. It applies to Codex, Claude, GitHub Copilot, and MCP-invoked agents.

## Task packets

Before delegating, proposing a next instruction, or beginning non-trivial work, express the task as a compact, evidence-based packet:

1. **Goal** — one concrete, verifiable outcome.
2. **Context** — only the current code, user history, references, and decisions that materially affect the work.
3. **Scope** — named surfaces, files, APIs, functionality nodes, and explicit exclusions.
4. **Constraints** — preservation requirements, data/credential limits, accessibility or branding rules, and safety boundaries.
5. **Requirements** — ordered behaviors and contracts to implement or assess.
6. **Done when** — observable acceptance criteria and required validation.
7. **Completion report** — changed files, implemented behavior, fallback or credential-dependent items, and exact verification results.

Use plain, imperative language. Name the actual files, nodes, endpoints, and conditions when evidence exists; do not pad a packet with raw conversation history, generic cautions, or repeated instructions.

## Reasoning and execution

- For complex work, make a short plan before editing: inspect the relevant state, identify dependencies and risks, choose the smallest complete path, then execute and validate it.
- Treat the current workspace and test/runtime evidence as truth. Do not claim an outcome, integration, test, or health status that has not been verified.
- Preserve completed work. When history is available, read it chronologically from genesis, deduplicate it, and extend only unresolved, failed, or explicitly requested gaps.
- Ask for input only when a missing decision materially changes scope, cost, safety, data handling, or user-facing behavior. Otherwise state a narrow assumption and proceed.
- Keep context and tool use economical: retrieve only the evidence needed to decide and validate the next action.

## Response contract

Lead with the outcome. Then state the relevant changes, validation evidence, and any fallback, limitation, or next decision. Reports must be concise for small work and structured for complex work. Never expose secrets or place them in prompts, logs, memory, or generated artifacts.

## Suggested-next-instruction contract

Suggested next instructions must be ready to paste into a coding agent. They must contain the task-packet sections above, identify the original objective and relevant unresolved evidence, preserve completed work, and avoid rephrasing completed instructions. Do not mark a functionality node `implemented` until its behavior works end to end; use a clearly labeled fallback when credentials or a required service are unavailable.

This standard implements the official ChatGPT Learn guidance to make the goal, context, constraints, and completion criteria explicit, to plan complex tasks before execution, and to validate the result.
