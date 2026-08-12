Optional new-project bootstrap prompt for QAgentic support.

Use this only when creating or bootstrapping a new project, or when the user explicitly requests QAgentic support for an existing project.

Additive requirements:
- Do not replace AGENTS.md or any existing orchestrator instruction.
- Do not delete, remove, disable, hide, or weaken existing features, UI controls, workflows, prompts, memory artifacts, graph artifacts, bootstrap behavior, or agent capabilities unless the user explicitly asks for that exact removal.
- Preserve and ingest the Gotham Chat workflow mode contract from AGENTS.md: Planner plans only, Debugger diagnoses and fixes narrowly, and Executor performs coding work.
- Append or verify the QAgentic support section only.
- Create missing qagentic-support/ framework files.
- Create schemas/qagent-next-instruction.schema.json if missing.
- Create .codex/prompts/task-qagentic.md if missing.
- Create observability/qagentic/latest-qagentic-bootstrap.json.
- Add QAgent Controller as a system/support agent in project-local topology.
- Add graph/D3/Neo4j relationships only when the project already uses those topology artifacts.

Behavior:
- QAgent Controller reviews the previous agent response against the original objective.
- It detects missing work, weak validation, incomplete implementation, or unclear next steps.
- It validates that generated data is real/user/reference-backed or explicit placeholder state, and that missing data was routed to Gotham required-data inputs instead of fabricated.
- It validates Product Shape fidelity, implementation depth, interaction model, information density, generic-template drift, source provenance, supplied-input consumption, and unrequested explainer copy.
- It outputs a structured Next Instruction Packet.
- It decides whether to continue or stop.
- It obeys task iteration caps: tiny=1, small=3, medium=5, large=8.
- It must not execute code directly.

Stop when:
- the objective is complete;
- validation passes;
- continuation would only polish or over-engineer;
- required user information is missing;
- continuation would require invented production data;
- max iterations are reached.
