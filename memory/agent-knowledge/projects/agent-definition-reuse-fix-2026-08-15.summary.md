---
agent_id: "project-execution-agent"
project_execution_id: "agent-definition-reuse-fix-20260815"
workflow_class: "software_engineering"
domain: "agent_orchestration"
deliverable_type: "existing_product_change"
version: "1.0.0"
content_type: "project_summary"
status: "completed"
created_at: "2026-08-15T16:30:00Z"
---

# Reusable Agent Definition Correction

Project names and workspace context must not be encoded in reusable agent identities. The corrected model stores stable global `AgentDefinition` records and distinct `ProjectAgentAssignment` records for each project.

Every binding is gated by a persisted `AgentReuseDecision`. Tiny and small tasks bind the canonical execution agent rather than generating specialists. Legacy managed project-prefixed definitions are archived during topology migration, and deleting a project removes assignments without deleting shared definitions.

Validation proved that equivalent projects share agent IDs, assignment IDs remain project-specific, artifact-specific responsibility stays on the assignment, and source-discovered functionality does not create one-off agents.
