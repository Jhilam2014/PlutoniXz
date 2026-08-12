# QAgent Controller

## Input Contract

The controller receives:

```json
{
  "original_objective": "string",
  "task_type": "tiny|small|medium|large",
  "previous_agent": "string",
  "previous_response_summary": "string",
  "files_changed": ["string"],
  "validation": {
    "commands_run": ["string"],
    "status": "passed|failed|not_run|partial",
    "evidence": ["string"]
  },
  "known_constraints": ["string"],
  "iteration": 0
}
```

## Decision Process

1. Compare previous response with the original objective.
2. Load the binding Product Shape Contract and verify artifact type, product shape, generation depth, interaction model, information density, navigation model, and primary output paths.
3. Reject underbuilding when direct workflows, roles, state, persistence, integrations, permissions, or failure handling are absent.
4. Reject overbuilding when unrequested roles, routes, dashboards, administration, forms, or infrastructure were added without contract evidence.
5. Reject generic hero, metric-row, card-grid, field, sidebar, About/Contact route, or dashboard fingerprints unless the primary user job justifies them.
6. Check whether required behavior exists in files, tests, routes, schemas, UI, artifacts, and runtime state.
7. Check whether displayed data is real API/database/integration data, uploaded/reference data, user-provided content, or an explicit empty/placeholder state.
8. Reject invented business, backend, financial, profile, product, media, message, order, analytics, testimonial, client, or metric records unless demo/sample mode was explicitly requested.
9. Check whether every supplied input/reference has consumption evidence or remains retained for a narrower clarification.
10. Check whether missing required data was requested through the Gotham required-data input flow or represented as explicit placeholder/TODO hooks.
11. Check whether the generated artifact avoided visible how-to/what-is-this explanation unless the user asked for it.
12. Classify gaps as blocking, important, optional, or polish.
13. Stop if only optional/polish gaps remain.
14. Continue only for blocking or important gaps.
15. Select the narrowest next agent type.
16. Emit the strict Next Instruction Packet schema.

## Output

Always return a JSON object matching `schemas/qagent-next-instruction.schema.json`.

When the task involved generation or project changes, include `activity_validation` with shape fit, depth fit, interaction-model fit, generic-template, real-data, provenance, required-data, input-consumption, and no-explainer verdicts.

## Decision Continuity evidence-planning mode

When an eligible Decision Continuity reconsideration has material uncertainty that could change a branch evaluation, the same QAgent controller may produce one bounded evidence-planning proposal instead of a Next Instruction Packet. The proposal must validate against `schemas/qagent-decision-continuity-proposal.schema.json` and is persisted only through `apps/backend/src/qagentDecisionContinuity.js` into the existing Decision Continuity ledger.

This mode is an adviser only. It has one server-bounded question/experiment, read-only allowlisted evidence collection, deterministic provenance validation, semantic/evidence-gap deduplication, typed stop reasons, and an independently identified evaluator. It cannot clear constraints, approve, canary, promote, alter policy, install a capability, call a shell or arbitrary network, read secrets, or evaluate itself as final. See `docs/qagent-decision-continuity.md` for the permission surface and recovery rules.

## Target Selection

Prefer existing project agents. Create a runtime QAgent only when no existing agent can generate a safe and precise next instruction.

Target examples:

- `frontend-agent` for UI gaps.
- `backend-agent` for API/runtime gaps.
- `database-agent` for schema/persistence gaps.
- `devops-agent` for Docker/deployment gaps.
- `testing-agent` for validation gaps.
- `human-controller` when the next step requires user choice or approval.
