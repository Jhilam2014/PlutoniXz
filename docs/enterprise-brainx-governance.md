# BrainX Enterprise Core — Governed Rollout

BrainX Enterprise Core is the additive, tenant-scoped decision control plane for PlutoniX. It helps teams preserve the evidence and constraints behind application-development and integration choices. It is decision support and an audit trail, not a claim of legal certification, autonomous deployment, or guaranteed architectural correctness.

The existing Decision Continuity ledger remains the authority for lifecycle facts. The existing portfolio view remains a backwards-compatible projection; project tags, JSON agreements, prompts, model output, graph/vector data, and browser input do not authorize an enterprise action.

## What is governed

```text
Authenticated request / worker
  -> OIDC membership + tenant/workspace scope
  -> immutable application-to-enterprise binding
  -> policy snapshot + fresh evidence + budget reservation
  -> DecisionX / AIX / AgenticX / ResearchX result
  -> Decision Continuity event and reviewable receipt
  -> Analysis workspace projection
```

The control plane records:

- immutable application and enterprise bindings;
- versioned policy snapshots and evidence references;
- budget envelopes, reservations, settlement/release state, and estimated-versus-actual cost;
- explicit DecisionX proposed, selected, deferred, rejected, validation, and final-outcome facts;
- ResearchX approved sources, runs, citations, bounded redacted evidence, and observations;
- AIX candidate exclusions and model-route receipts; and
- AgenticX allowed and denied knowledge-reuse receipts.

Changing an immutable record creates a new version or record. A retried build/workflow reuses its stable idempotency key rather than creating a fabricated second decision.

## Enterprise policy controls

Every governed operation evaluates the active tenant/workspace policy snapshot and its evidence. The policy model supports organization-defined compliance-control IDs alongside budget, data classification, regional/data-sovereignty, egress, retention, and transformation requirements.

Evidence is fail closed. Missing, stale, expired, unauthorized, malformed, or non-matching evidence cannot satisfy a control. A high-impact operation remains proposed or denied until the configured human approval is present. Model, research, and agent output never promotes a Decision Continuity branch by itself.

Policy evaluation does not treat legacy project tags or sharing-agreement JSON as authorization. Those records may remain useful portfolio context, but an authenticated Enterprise Brain API action and its policy receipt are required for authority.

## DecisionX: actual development decisions only

New Decision Continuity branches may include an optional `enterpriseDecisionContext` containing the application, enterprise, affected application connections, policy snapshot, budget scope, classification/region/purpose, and evidence references. Existing branch payloads are still valid unchanged.

During a normal generation flow, DecisionX captures only facts actually observed in that flow:

- the proposed path and alternatives returned by the workflow;
- the selected route when a human or existing authority selected it;
- deferred/rejected alternatives and their recorded constraint outcomes;
- execution validation; and
- the resulting outcome or failure.

It never invents historical decisions, treats an agent recommendation as a human decision, or auto-promotes a path. The decision context and final outcome make maintenance and future reconsideration traceable without asserting that a previous route was universally correct.

## AIX: policy-aware model routing

AIX evaluates registered OpenAI/Codex and Hugging Face candidates at the generation seam. Candidate eligibility includes task role, tenant policy, data sensitivity, region, egress, licence/commercial-use conditions, immutable artifact/provenance, health, hardware, latency, and a budget reservation.

- If BrainX is disabled for the tenant, the existing executor behavior remains unchanged.
- If BrainX is enabled and no candidate is eligible, AIX returns a persisted, reviewable `no_eligible_model` result. It does not silently bypass governance.
- Hugging Face candidates can be registered and evaluated, but live Hugging Face inference is unavailable in this rollout.
- Automatic Hugging Face downloads are disabled. Staging requires an immutable revision, licence and provenance evidence, artifact checksum, hardware assessment, and human approval before any separate adapter can be considered.
- A route receipt stores the estimated cost separately from actual cost. Actual provider cost remains `usage_evidence_required` until provider usage evidence is supplied; the system never invents spend.

No live provider call, GPU allocation, remote artifact execution, or paid provider execution is enabled by this release.

## ResearchX: allowlisted, reviewable research

ResearchX is a low-privilege scheduled worker, not a crawler, coding agent, policy editor, deployment client, or unrestricted browser. A source must be created through the authenticated control plane and pass both a tenant-approved source allowlist and the deployment allowlist.

Before fetch, ResearchX checks the tenant feature opt-in, source cadence/quota, policy snapshot, egress, and any non-zero budget reservation. It accepts bounded text/feed/JSON/XML evidence, constrains redirects and response size, persists a redacted digest with citation metadata, and emits a reviewable observation or reconsideration request only. It cannot write code, mutate policy, deploy, or alter a decision disposition.

The Compose worker is not started by ordinary `docker compose up`. It requires all of the following explicit settings:

```dotenv
RESEARCHX_ENABLED=true
RESEARCHX_WORKER_ENABLED=true
RESEARCHX_NETWORK_ENABLED=true
RESEARCHX_ENABLED_TENANTS=tenant-id
RESEARCHX_ALLOWED_DOMAINS=docs.example.com,security.example.org
DECISION_CONTINUITY_ADAPTER=postgres
DECISION_CONTINUITY_DATABASE_URL=
RESEARCHX_WORKER_PRINCIPAL_ID=
```

Enable it only after migration, OIDC/RBAC provisioning, a tenant policy/budget setup, and deployment-level egress enforcement:

```bash
docker compose build backend
docker compose --profile decision-continuity-production run --rm decision-continuity-migrate
docker compose --profile researchx up researchx-worker
```

The application layer validates source domains and redirects; production operators must also enforce the same boundary with their egress/network policy. HTTP remains disabled unless explicitly allowed, and unrestricted internet research is never enabled by this configuration.

## AgenticX: tenant-scoped reusable knowledge

AgenticX runs before agent selection and prompt assembly. A source registration remains private to its workspace, but the authority can retrieve an eligible sanitized summary for a different application in the same tenant and enterprise after target-policy, classification, region, purpose, retention, and transformation checks. It excludes raw source material, secrets, credentials, and restricted content from reusable context, and never exposes cross-workspace candidate lists.

Every retrieval records an allowed or denied receipt. Cross-tenant retrieval is denied, and an empty tenant allowlist does not override the registered record and governance controls. Reused summaries are scoped to the current application-development purpose and must not be used to recover the original content.

## APIs and roles

The strict `/api/enterprise-brain/*` family is protected by the existing verified OIDC principal/membership flow. Read views use reviewed human `brainx:read` authority; policy/budget/source registration and other administrative actions require human-only `brainx:admin` authority. Worker activity is scoped to its least-privilege service identity.

| Route group | Purpose |
| --- | --- |
| `GET /api/enterprise-brain/overview` | Read the workspace’s policy, budget, DecisionX, AIX, ResearchX, and AgenticX projection. |
| `GET/POST /api/enterprise-brain/applications/:applicationId/binding` | Read or immutably bind an application to an enterprise scope. `GET /applications/bindings` lists allowed bindings. |
| `GET/POST /api/enterprise-brain/policies` and `GET /policies/:policyId` | Read/create immutable policy snapshots. |
| `GET/POST /api/enterprise-brain/budgets` and `GET /budgets/:budgetId` | Read/create budget envelopes; reservations are created only by governed service operations. |
| `GET /api/enterprise-brain/decision-contexts` and `/model-route-receipts` | Read DecisionX and AIX receipts. |
| `GET /api/enterprise-brain/agenticx/reuse-receipts`; `POST /agenticx/knowledge` | Inspect reuse access or register sanitized knowledge. |
| `GET/POST /api/enterprise-brain/research/sources`; `GET /research/runs` | Manage approved research sources and inspect run evidence. A manual source-run request in the API process cannot fetch; only the profile worker has a source-fetch adapter. |

The existing `/api/brainx/*` model registry APIs remain in place. The legacy `/api/enterprise-portfolio` route remains a non-authoritative compatibility projection and cannot grant access or make an enterprise decision.

## Activation checklist

1. Apply migration `011_enterprise_brainx_governance.sql` with the controlled PostgreSQL migration job.
2. Provision OIDC principals/memberships and separate high-impact human approvers from service workers.
3. Bind each application to the correct tenant/workspace enterprise scope.
4. Create an immutable policy snapshot, fresh evidence, budget envelope, and required approval records.
5. Register reviewed model candidates; keep `BRAINX_ENABLED=false`, `AIX_GOVERNED_ROUTING_ENABLED=false`, and `PLUTONIX_HF_AUTO_DOWNLOAD=false` until the tenant rollout is approved.
6. Enable only named tenants, then verify denied, no-eligible-model, budget-exhaustion, stale-evidence, cross-tenant, and retry/idempotency paths.
7. If ResearchX is needed, separately enable its three flags, source allowlist, worker profile, budget, and network egress policy.

Relevant safe defaults are documented in [`.env.example`](../.env.example), the base BrainX boundary is in [BrainX governed model registry](brainx-model-registry.md), and identity/RBAC requirements are in [Decision Continuity identity and authorization](decision-continuity-identity-security.md).

## Operating limits

This rollout is a governed control-plane foundation. It does not provide a compliance certification, replace legal/privacy review, perform autonomous policy changes, download or execute arbitrary models, make provider-spend claims without usage evidence, or authorize deployment. Retention/deletion, legal holds, external audit sinks, production egress controls, and provider-specific live-inference adapters remain deployment-owned follow-on work.
