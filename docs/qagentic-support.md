# QAgentic Support

PlutoMix now generates QAgentic support for every new project.

## Best Practice

Keep the mandate in `AGENTS.md`, keep the detailed behavior in `qagentic-support/`, and keep machine validation in `schemas/qagent-next-instruction.schema.json`.

## Project Generation

During new project generation, PlutoMix installs the orchestrator seed and creates project-local QAgentic files under `.agentic/qagentic-support/`.

New projects also receive the root-level QAgentic framework files, `schemas/qagent-next-instruction.schema.json`, `.codex/prompts/task-qagentic.md`, and the optional `.codex/prompts/bootstrap-orchestrator-qagentic.md` bootstrap prompt.

Existing projects should receive QAgentic support only when explicitly requested.

## Runtime

After an agent response, the QAgent Controller decides whether to stop or produce a Next Instruction Packet for the next model/agent. Runtime QAgents are generated only when there is a blocking or important objective gap.

The controller must validate real-data behavior before continuation: no fabricated production records, missing backend/integration/media data is either requested through Gotham required-data inputs or shown as explicit placeholders, and generated artifacts do not include visible usage explanations unless requested.

## Non-Destructive Guarantee

This support is additive. It must not remove or weaken existing project generation, hosting, graph, vector, D3, memory, token observability, or validation behavior.
