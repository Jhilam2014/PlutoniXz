---
workflow_id: gotham-studio-control-plane-20260827
agent_id: project-execution-agent
content_type: project_summary
status: completed
sanitized: true
---

# Gotham Studio AI/ML execution control plane

Added a protected internal Gotham Builder workspace with Overview, Jobs, Pipelines, Experiments, Models, and Providers views. The UI consumes only a project-scoped provider-neutral API, shows capability-dependent actions, and labels unavailable evidence directly.

The backend now persists logical pipelines, jobs, provider checks, lifecycle events, experiments, and model projections in PostgreSQL as the mandatory production authority, with transactions, scoped row locks, and advisory reconciliation leases. The atomic file repository is limited to development and tests. Strict identity/RBAC and managed-project scope are enforced for every Studio route. Provider credentials are backend-only and credential-shaped request fields are rejected.

Databricks supports Jobs API submission/status/cancel/output plus opt-in MLflow metric/artifact reads for explicitly referenced run IDs. Azure ML supports ARM job create/read/cancel. Both adapters publish safe configuration metadata and normalized states. Executor is the only submission mode; Gotham ML intent creates drafts and never launches compute automatically. Cost ceilings require provider evidence or a provider-side budget control reference; deployment defaults to denied. Provider calls record outcome and latency telemetry, while job reconciliation records an observable poll without inventing lifecycle changes.

Builder Account & Usage now reads Codex account identity, plan, rate-limit allowance, reset credits, and account token activity from the read-only Codex App Server account APIs. Account-wide values are disclosed only when the Codex account email matches the verified PlutoniX owner email. Provider account ID and active-thread context occupancy remain explicitly unavailable when Codex does not expose them.

No new agent was created. `project-execution-agent` was exactly reused because the work is a bounded application control-plane implementation rather than a new durable agent role.
