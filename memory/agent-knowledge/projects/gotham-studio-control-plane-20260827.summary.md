---
workflow_id: gotham-studio-control-plane-20260827
agent_id: project-execution-agent
content_type: project_summary
status: completed
sanitized: true
---

# Gotham Studio AI/ML execution control plane

Added a protected internal Gotham Builder workspace with Overview, Jobs, Pipelines, Experiments, Models, and Providers views. The UI consumes only a project-scoped provider-neutral API, shows capability-dependent actions, and labels unavailable evidence directly.

The backend now persists logical pipelines, jobs, provider checks, lifecycle events, experiments, and model projections in an atomic local repository. A normalized PostgreSQL projection is supplied for controlled deployment. Strict identity/RBAC and managed-project scope are enforced for every Studio route. Provider credentials are backend-only and credential-shaped request fields are rejected.

Databricks supports Jobs API submission/status/cancel/output plus opt-in MLflow metric/artifact reads for explicitly referenced run IDs. Azure ML supports ARM job create/read/cancel. Both adapters publish safe configuration metadata and normalized states. Executor is the only submission mode; Gotham ML intent creates drafts and never launches compute automatically. Cost ceilings require provider evidence or a provider-side budget control reference; deployment defaults to denied.

No new agent was created. `project-execution-agent` was exactly reused because the work is a bounded application control-plane implementation rather than a new durable agent role.
