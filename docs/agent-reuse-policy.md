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

## AgenticX enterprise knowledge gateway

Agent definitions and AgenticX knowledge are related but not interchangeable. Global reusable definitions still follow the resolution gate above. AgenticX adds a tenant-scoped retrieval gateway before agent selection and prompt assembly so eligible prior knowledge can improve an assigned agent without copying raw project material into a global definition.

The gateway accepts only sanitized summaries and metadata. Registration stays private to its source workspace, while an authorization-first Enterprise Brain gateway may retrieve an eligible summary for another application in the same tenant and enterprise only after target-policy, evidence, classification, region, purpose, retention, and transformation checks. It never enumerates cross-workspace candidates or shares secrets, credentials, raw attachments, or restricted content. Cross-tenant retrieval is denied. Every allowed or denied retrieval persists an access receipt, so reuse can be audited without treating a vector/graph result as authorization.

`AGENTICX_KNOWLEDGE_ENABLED=false` is the rollout default. Enabling it requires named tenant configuration and the relevant Enterprise BrainX policy evidence; a blank allowlist never bypasses the record-level controls. See [Enterprise BrainX governance](enterprise-brainx-governance.md).
