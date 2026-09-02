# BrainX governed model registry

BrainX is an optional model-governance layer inside the existing Decision Continuity authority. It is not a general Hugging Face downloader, model marketplace, accelerator scheduler, cloud-job launcher, prompt store, coding agent, policy engine, or promotion path. With its feature flag unset, every tenant remains on the established baseline. The Enterprise BrainX rollout composes this registry with immutable enterprise policy, budget, DecisionX, ResearchX, and AgenticX receipts; it does not replace the registry boundary.

## Boundary and roles

Each immutable registration records a provider/model ID, registration version, immutable revision, artifact SHA-256 and provenance, adapter/tokenizer/quantization version, limits, health evidence, licence/data-use terms, sensitivity/region/egress/tenant policy, resource envelope, pricing/performance evidence, known failures, and evaluation evidence. Changing any field requires a new registration version; the original record remains audit evidence.

The allowed task roles are deliberately narrow:

- `generation`
- `evidence_question_planning`
- `semantic_similarity`
- `classification_reranking`
- `independent_critique`

Registration, eligibility, routing, isolated execution, and independent evaluation are separate operations. A `brainx:execute` service identity can route/execute only after an eligible route is stored; it cannot administer the registry, evaluate a Decision Continuity lifecycle, set policy, approve, promote, run shell/SQL, invoke tools, or change constraints. Independent critique excludes the generation provider/model/registration and is checked again before accepting the evaluator relation.

## Provider/artifact and licence policy

Hugging Face registrations must use a 40–64 hexadecimal commit revision, a SHA-256 artifact checksum, `trustRemoteCode: false`, and only `safetensors`, ONNX, GGUF, tokenizer JSON, or configuration JSON formats. Moving refs (`main`, `master`, `latest`), unpinned artifacts, and executable repository artifacts are rejected. This implementation performs no download or remote repository execution.

Routing evaluates tenant allowlist, task role, data sensitivity, licence/commercial-use/attribution/data-use term, region, egress destination, immutable artifact, health/circuit state, available fixture hardware, latency objective, cost budget, and independent-critique separation. It stores all eligible candidates, exclusions with typed reason codes, policy/evaluation/adapter versions, selected/fallback IDs, and routing time. If none are eligible it stores and returns `no_eligible_model`; it does not silently choose an arbitrary provider.

No production model is pre-approved by this repository. Licence, attribution, region/egress, benchmark provenance, and provider data-use evidence are operator-owned inputs that must be reviewed before a tenant registration is accepted.

## Execution, safety, and accounting

Only an `isolated_fixture` adapter is usable here. The adapter receives a bounded request plus cancellation signal, never browser credentials or a Decision Continuity authority. Timeout, cancellation, bounded fallback, circuit breaker, tenant concurrency quota, cost/latency limits, and registration/provider/tenant kill switches fail closed. Effect claims are persisted before an adapter call, so duplicate/restart delivery cannot bill or invoke the isolated adapter twice.

Model output must satisfy the strict `brainx-output/v1` schema and pass the deterministic boundary validator. The ledger retains digest, byte count, schema/validator result, aggregate token/latency/cost metadata, and pricing provenance—not prompt/output text or credentials. Output is always marked untrusted and has no wired path to QAgent tools, code execution, constraints, policy, approval, or promotion. Append-only Decision Continuity events provide the auditable usage history; dashboard totals are explicitly operational attribution, never a causal quality claim.

## Enterprise Core routing

AIX is the policy-aware selection seam for registered candidates. Before it considers an OpenAI/Codex or Hugging Face registration, it requires the calling application’s immutable enterprise binding, a current policy snapshot, matching fresh evidence, and an available budget envelope/reservation. It evaluates task role, classification, region, egress, licence, immutable artifact/provenance, health, hardware, latency, and estimated cost. Each selected or denied route writes a reviewable receipt with candidate exclusions, policy/budget references, and estimated cost separated from actual usage evidence.

When BrainX is disabled, existing executor behavior remains unchanged. When a governed tenant has no eligible model, the route ends with `no_eligible_model`; it never silently falls back around policy. AIX itself does not call a provider. A selected OpenAI/Codex registration may describe the existing executor’s approved model configuration, while Hugging Face candidates are intentionally recorded as unavailable for live inference in this rollout.

Automatic Hugging Face downloads remain disabled (`PLUTOMIX_HF_AUTO_DOWNLOAD=false`). Any future local inference adapter needs a separate immutable revision, checksum, provenance, licence, hardware, and human-approval gate. No provider spend is asserted until the separate execution adapter supplies actual usage evidence. See [Enterprise BrainX governance](enterprise-brainx-governance.md) for the full cross-domain contract.

## API and access

Read-only human `brainx:read` endpoints are `GET /api/brainx/overview`, `/registrations`, `/routes`, and `/controls`. Human `brainx:admin` endpoints create an immutable registration, set tenant policy, change health, and set a scoped kill control. There is intentionally no browser/API model-execution endpoint. The separate service-only execution interface is internal and requires `brainx:execute`.

All APIs use the existing OIDC principal/membership lookup, tenant/workspace selector rules, and authorization audit. Migration `009_brainx_model_registry.sql` rejects `brainx:execute` service scope combined with final Decision Continuity/promotion evaluation, policy, approval, canary, or operation scope, and rejects service `brainx:admin` scope.

## Deployment and activation

1. Apply migrations through `009_brainx_model_registry.sql` using the deployment migration role.
2. Provision reviewed human administrator/read roles and a separate `brainx:execute` service principal. Do not grant it final lifecycle or promotion scope.
3. Keep the defaults below until a tenant-specific fixture registration, licence review, health source, budget/latency objective, monitoring, cancellation drill, circuit/kill drill, and recovery owner have been approved.
4. Enable only named tenants with `BRAINX_ENABLED=true` and `BRAINX_ENABLED_TENANTS=tenant-a,...`. Retain `BRAINX_LIVE_PROVIDER_ENABLED=false`.

```dotenv
BRAINX_ENABLED=false
BRAINX_ENABLED_TENANTS=
BRAINX_AVAILABLE_HARDWARE=fixture
BRAINX_MAX_CONCURRENCY=1
BRAINX_MAX_FALLBACKS=1
BRAINX_MAX_RETRIES=0
BRAINX_MAX_ELAPSED_MS=30000
BRAINX_MAX_INPUT_BYTES=32768
BRAINX_MAX_OUTPUT_BYTES=32768
BRAINX_MAX_COST_USD=0.25
BRAINX_CIRCUIT_FAILURE_THRESHOLD=2
BRAINX_LIVE_PROVIDER_ENABLED=false
BRAINX_LIVE_PROVIDER_MAX_COST_USD=0
PLUTOMIX_HF_AUTO_DOWNLOAD=false
AIX_GOVERNED_ROUTING_ENABLED=false
AIX_MAX_ROUTE_COST_USD=1
AIX_MAX_LATENCY_MS=60000
AIX_PERMITTED_TASK_ROLES=generation
```

The optional live-provider preflight is a pinned, budget-capped planning check only. It does not perform a network call; live evaluation requires a separately approved implementation and deployment review.
