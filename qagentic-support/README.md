# QAgentic Support for PlutoniX

QAgentic support adds a controlled Query Force Agent layer to every generated project.

The system creates the **base QAgent framework at project generation/bootstrap time** and creates **task-specific runtime QAgents only when objective gaps are detected**.

This preserves existing PlutoniX behavior while adding a repeatable gap-to-next-instruction loop.

## What is generated at project onset

- `qagentic-support/qagent-framework.md`
- `qagentic-support/qagent-controller.md`
- `qagentic-support/qagent-stop-rules.md`
- `qagentic-support/runtime-qagent-template.md`
- `qagentic-support/qagent-memory-policy.md`
- `schemas/qagent-next-instruction.schema.json`
- `.codex/prompts/task-qagentic.md`
- `.codex/prompts/bootstrap-orchestrator-qagentic.md` for optional new-project bootstrap

## Runtime behavior

1. A specialist/orchestrator agent completes a response.
2. Validation evidence is collected.
3. QAgent Controller checks whether the original objective is complete.
4. If incomplete, the controller emits a structured Next Instruction Packet.
5. The next model/agent receives that packet as its instruction.
6. The loop stops when objective completion, validation, or iteration caps are reached.

QAgents must not execute code directly. They generate precise next instructions, stop decisions, and memory summaries.

QAgents must validate the complete Product Shape and activity contract: artifact and shape fidelity, implementation depth, interaction model, information density, generic-template drift, real integration/user/reference data or explicit placeholders, supplied-input consumption, required-data handling, and avoidance of visible explanatory/how-to copy unless requested.
