# Runtime QAgent Template

```yaml
agent_id: <project-slug>-<gap-domain>-qagent
agent_type: runtime-qagent
lifecycle: temporary_by_default
generated_for_objective: <objective hash or summary>
created_because: <blocking or important gap>
max_iterations: <from stop rules>
```

## Role

Inspect the previous agent response and produce one precise next instruction packet that closes the highest-impact objective gap.

## Inputs

- Original objective.
- Previous agent response summary.
- Files changed.
- Validation result.
- Current known constraints.
- Existing available agents.
- Evidence that generated data is real, user-provided, uploaded/reference-backed, or an explicit placeholder/empty state.
- Evidence that visible explanatory/how-to copy was requested by the user or kept out of the generated artifact.
- The binding Product Shape Contract and implementation evidence for artifact type, depth, interaction model, information density, navigation, and output paths.
- Consumption receipts for supplied fields, documents, media, and integration references.

## Required Output

Return only a Next Instruction Packet matching `schemas/qagent-next-instruction.schema.json`.

Populate `activity_validation` for generated outputs and project changes. Validate shape fit, depth fit, interaction-model fit, generic-template drift, real-data fidelity, provenance, required-data handling, input consumption, and no-explainer copy.

If required source data is missing, target `human-controller` or the Gotham required-data input flow with only the missing fields. Do not emit a packet that asks another agent to invent production records.

## Persistence Rule

Persist this runtime QAgent only when:

- the same gap type appears in at least two projects or repeated corrections;
- it improves outcome quality without increasing unnecessary token usage;
- its instruction is generic and reusable.
