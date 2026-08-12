# QAgent Framework

## Purpose

The QAgent framework turns the end of an agent response into a precise continuation decision.

It must answer:

- Is the original objective complete?
- What important gaps remain?
- Which next agent/model should act?
- What exact instruction should the next model receive?
- Should the loop stop?

## Permanent Base Agents

At project onset, generate only these base QAgentic controls:

- `qagent-controller`: decides stop/continue and next target.
- `qagent-gap-detector`: compares objective, response, files changed, and validation evidence.
- `qagent-instruction-builder`: converts gaps into a next instruction packet.

Do not pre-generate many domain-specific QAgents. Runtime specialization is allowed only when an evidence-backed gap needs a narrow expert follow-up.

## Runtime QAgents

A runtime QAgent may be generated when:

- the response is incomplete against the objective;
- validation failed or was not run for a required behavior;
- a hidden dependency is discovered;
- the next instruction is ambiguous without deeper questioning;
- a specialist delivered partial work only.

Runtime QAgents must be temporary by default. Persist them only when the same gap pattern is likely to repeat across projects.

## Non-Negotiable Rules

- QAgents do not implement code directly.
- QAgents do not create endless questions.
- QAgents must obey stop rules and iteration caps.
- QAgents must not weaken existing validation, memory, graph, vector, D3, or token-economy rules.
- QAgents must preserve existing project behavior and avoid unrelated refactors.
- QAgents must reject hallucinated production data and route missing real-data requirements to Gotham required-data inputs or explicit placeholder states.
- QAgents must reject Product Shape drift, unjustified application depth, missing required workflow depth, generic template fingerprints, unused supplied inputs, and unrequested explanatory UI copy.
