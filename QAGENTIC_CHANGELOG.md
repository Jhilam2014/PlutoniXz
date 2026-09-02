# QAgentic Additive Patch Changelog

This patch adds Query Force Agent / QAgentic support without removing existing PlutoMix features.

## Added

- Root QAgentic support files under `qagentic-support/`.
- Strict `schemas/qagent-next-instruction.schema.json`.
- QAgentic Codex prompts:
  - `.codex/prompts/bootstrap-orchestrator-qagentic.md`
  - `.codex/prompts/task-qagentic.md`
- Documentation: `docs/qagentic-support.md`.
- Observability seed: `observability/qagentic/latest-qagentic-bootstrap.json`.
- Project-local QAgentic generation during project topology creation:
  - `.agentic/qagentic-support/qagent-controller.md`
  - `.agentic/qagentic-support/runtime-qagent-template.md`
  - `.agentic/qagentic-support/qagent-bootstrap.json`
- QAgent Controller in generated project-agent topology.
- Neo4j generated-project-agent relationship support for `USES_QAGENT_CONTROLLER`.
- Fallback QAgentic artifacts when bootstrap fallback mode is used.
- Updated `orchestrator-temp/orchestrator-agent-001-main.zip` so newly generated projects receive QAgentic files from the seed archive.

## Modified

- `AGENTS.md`: added an additive QAgentic support mandate.
- `.codex/prompts/bootstrap-orchestrator.md`: added QAgentic bootstrap reporting requirements.
- `apps/backend/src/projectAgents.js`: generates project-local QAgentic support and project QAgent Controller.
- `apps/backend/src/projectBootstrap.js`: creates fallback QAgentic artifacts if bootstrap needs fallback recovery.
- `scripts/bootstrap-orchestrator.py`: generates QAgentic baseline artifacts during bootstrap.
- `orchestrator-temp/orchestrator-agent-001-main.zip`: updated embedded orchestrator seed.

## Preserved

Existing project generation, hosting, frontend, backend, graph, vector memory, Neo4j, D3, ChromaDB fallback, token observability, and validation behavior were left intact.

## Validation Performed

Passed:

- `node --check apps/backend/src/projectAgents.js`
- `node --check apps/backend/src/projectBootstrap.js`
- `python3 -m py_compile scripts/bootstrap-orchestrator.py`
- `python3 scripts/validate_project.py`

Backend test suite was also run. 8 of 14 tests passed. The remaining failures appear tied to pre-existing test expectations / runtime timing behavior unrelated to the QAgentic patch:

- stale expected task casing in tests vs current `Task Type` / `Task` formatter;
- zero-second Gotham timeout renewal test behavior;
- bootstrap status file expectation in test setup;
- runtime process exit message expectation.

One QAgentic-introduced test issue was fixed by keeping QAgentic seed files backward-compatible with older orchestrator archives.
