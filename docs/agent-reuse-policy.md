# Agent Reuse Policy

Local agent definitions are authoritative. A project never owns or renames a reusable definition; it binds that definition through a `ProjectAgentAssignment` stored in its runtime topology and project-local `.agentic/` overlay.

## Resolution gate

Before a project can bind an agent role, `resolveAgent` must produce one of the decision types allowed by `schemas/agent-reuse-decision.schema.json`. The topology write fails closed when any selected agent lacks a persisted `AgentReuseDecision`.

Resolution order:

1. Reuse the exact global agent ID.
2. Reuse a compatible global definition with the same role.
3. Upgrade a compatible definition only through the governed instruction-version workflow.
4. Create a reusable definition only when no compatible local definition exists.

Project names, folder slugs, objectives, workspace paths, and attached-source context belong only to assignments and `.agentic/` overlays. They must not appear in reusable agent IDs or global definition files.

## Task-size rule

Tiny and small tasks bind the canonical `project-execution-agent` and shared `qagent-controller`; they do not create specialist definitions. Medium and large tasks may bind the global project orchestrator and only those reusable specialists justified by the product contract.

## Reconciliation

Managed project-prefixed definitions from the legacy model are archived under `agents/archived/legacy-project-scoped/` during migration. Removing a project removes its assignment records, not a shared definition still available to other projects.
