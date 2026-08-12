# Decision Continuity identity and authorization

Decision Continuity is a bearer-token API. Every one of its 19 lifecycle routes authenticates before reading a route body, resolves the verified external identity to a PostgreSQL principal, and resolves tenant/workspace authority from an active PostgreSQL membership. Client-provided tenant and workspace values are selectors only; they never create authority.

## Request and worker flow

```text
Browser / service bearer token
  -> OIDC issuer + JWKS signature verification
  -> issuer/sub principal lookup (active only)
  -> active tenant/workspace membership lookup
  -> route permission + principal-type + separation-of-duties check
  -> Decision Continuity read or durable job submission
  -> authorization audit (allowed / denied, no token or claims)

Durable job -> scoped worker service identity -> job authorization envelope
  -> submitter membership recheck + worker tenant/job capability recheck
  -> effect, inbox, and completion transaction
```

The verifier accepts only asymmetric `RS256/384/512` or `ES256/384/512` JWTs with a `kid`, configured `typ`, exact issuer, configured audience, valid `exp`, and active `nbf`. It fetches signing keys through an explicit `OIDC_JWKS_URL` or validated standard issuer discovery, refreshes an unknown key once for rotation, caches fresh keys for five minutes by default, and uses a bounded stale-key grace only during a provider outage. `alg=none`, symmetric algorithms, ambiguous keys, unsigned claims, and malformed tokens are rejected.

SAML is not parsed at this API boundary. A SAML-capable identity broker must issue the same configured OIDC token contract; the broker, its SAML metadata lifecycle, and IdP-initiated login policy remain broker-owned controls.

## PostgreSQL authority and revocation

`006_decision_continuity_identity_access.sql` creates:

- `identity_principals`: immutable external `(issuer, subject)` mapping, type (`human` or `service`), and active/disabled state.
- `identity_tenant_memberships`: tenant/workspace memberships, human roles, service scopes, and active/revoked state.
- `identity_access_audit`: allowed and denied authentication/authorization records without raw bearer tokens or claims.

There is intentionally no HTTP endpoint that provisions a principal, changes a role, adds a service scope, or reactivates a membership. Those changes are controlled database-administration actions, subject to the deployment's normal approval and audit process. A client cannot promote itself by asserting a role or a tenant in a token/header/body/query string.

Memberships are re-read for every API request and every worker effect. Principal disabling or membership revocation therefore takes effect on the next authorization decision (bounded by the in-flight request/effect already past its authorization check). Worker leases are short-lived; a revoked submitter cannot be retried into a domain effect after the worker recheck.

A wildcard workspace membership may omit `workspaceId`. A workspace-specific membership must supply a matching workspace selector; omission is denied rather than broadened to the entire tenant.

The schema adds foreign keys, active-status constraints, service-scope restrictions (a service scope cannot include `decision:approve`), nonempty tenant/workspace constraints on Decision Continuity tables, and transaction-local tenant context setup for audit writes. The current deployment uses the PostgreSQL owner role, so its application-layer tenant predicates remain the live row-access enforcement. Before moving application traffic to a non-owner database role, enable and test the staged RLS policy using `decision_continuity_current_tenant()`; do not enable RLS under the owner role and assume it protects current traffic.

## Permission matrix

Human permissions are role-derived. A service ignores human roles and can receive only explicit scopes. `tenant_admin` is a human role, not a service shortcut.

| Role / identity | Granted Decision Continuity permissions |
| --- | --- |
| `tenant_admin` | All human permissions within its membership scope |
| `operator` | `decision:read`, `decision:operate`, `decision:canary`, `workflow:read`, `workflow:redrive`, `brainx:read` |
| `proposer` | `decision:read`, `decision:propose` |
| `evaluator_reviewer` | `decision:read`, `decision:evaluate` |
| `approver` | `decision:read`, `decision:approve` |
| `auditor` | `decision:read`, `workflow:read`, `brainx:read` |
| `service` | Only its explicit scopes, for example `decision:condition_ingest`, `decision:evaluate`, `decision:policy`, `decision:readiness`, `workflow:execute`, and `workflow:execute:<job-type>` |

`qagent:investigate` is a narrowly separate service scope for the Step 5 evidence planner. It is meaningful only to a server-registered, read-only collector integration; it does not imply any `decision:*` or `promotion:*` scope. Migration 008 rejects a membership that combines it with policy, approval, canary, or promotion lifecycle authority.

`brainx:read` is available to reviewed human operator/auditor roles; `brainx:admin` is human-only and governs registrations, policy, health, and kill controls; `brainx:execute` is a separately provisioned service scope for the isolated fixture boundary. Migration 009 rejects service `brainx:admin` and rejects `brainx:execute` combined with final Decision Continuity/promotion evaluation, policy, approval, canary, or operation authority. BrainX has no browser execution route and does not grant model output lifecycle authority. See [the BrainX registry policy](brainx-model-registry.md).

Route permission is declared in [the lifecycle registry](../apps/backend/src/decisionContinuityLifecycleRegistry.js). Human routes accept human principals; condition ingestion, policy, canary outcomes, and readiness require service principals. Evaluation permits either a service with `decision:evaluate` or an independently provisioned human `evaluator_reviewer`. A service principal can never approve. Identifiers associated with QAgent or BrainX cannot administer policy even if an erroneous scope is provisioned.

The QAgent operator endpoint is read-only and uses existing `decision:read`. It returns only tenant/workspace-scoped, redacted run metadata. It cannot use an HTTP body to activate a tenant, select a collector, supply a tool, or execute an investigation.

Separation of duties is server-side and independent of the role matrix:

- A branch originator cannot perform its final evaluation or approval.
- An evaluator cannot name itself as reviewer.
- The domain state machine additionally rejects approval by the branch producer or evaluation actor.
- Services do not acquire human roles, cannot self-provision, and cannot approve.

## Browser and API client handling

The frontend keeps the bearer token only in module memory and sends it as `Authorization: Bearer …` with `credentials: "omit"`. It does not put bearer credentials into localStorage, sessionStorage, IndexedDB, or a client-readable cookie; a reload requires a new identity-provider login. Production CORS requires an exact comma-separated `PLUTONIX_CORS_ORIGINS` allowlist and does not enable credentialed requests. Since this API does not use ambient session cookies, CSRF is not an authentication mechanism for these routes; normal XSS defenses, CSP, dependency controls, and short token lifetimes remain essential.

`PLUTONIX_DEV_AUTH_ENABLED=true` is the only development identity bypass. It accepts only `x-plutonix-dev-subject`, is omitted from the normal frontend unless `VITE_PLUTONIX_DEV_AUTH_ENABLED=true`, and production startup refuses it. Legacy user and service headers are not an authorization path for Decision Continuity.

## Required production configuration

```dotenv
NODE_ENV=production
DECISION_CONTINUITY_ADAPTER=postgres
DECISION_CONTINUITY_DATABASE_URL=postgresql://... # deployment secret reference
DECISION_CONTINUITY_DURABLE_WORKFLOWS=true

PLUTONIX_AUTH_MODE=oidc
OIDC_ISSUER=https://issuer.example
OIDC_AUDIENCE=plutonix-decision-continuity
# Set one explicit endpoint or use issuer discovery through OIDC_ISSUER.
OIDC_JWKS_URL=https://issuer.example/keys
OIDC_ALLOWED_ALGORITHMS=RS256,RS384,RS512,ES256,ES384,ES512
OIDC_ACCEPTED_TOKEN_TYPES=JWT,at+jwt
OIDC_JWKS_CACHE_MS=300000
OIDC_JWKS_STALE_GRACE_MS=300000
OIDC_CLOCK_SKEW_SECONDS=60
PLUTONIX_CORS_ORIGINS=https://app.example
PLUTONIX_DEV_AUTH_ENABLED=false

DECISION_CONTINUITY_WORKER_PRINCIPAL_ID=workflow-worker-prod-01
```

Production startup fails closed when the PostgreSQL authority, OIDC issuer/audience, browser origin allowlist, or worker principal requirement is absent, when the development bypass is enabled, or when test-only `OIDC_JWKS_JSON` is supplied. `OIDC_JWKS_JSON` exists solely for non-production deterministic tests.

Provision the API-facing service principals and the worker principal before rollout. The worker needs both a tenant membership containing `workflow:execute` and a job-specific scope such as `workflow:execute:condition_event`; the original submitting principal's active permission is checked again immediately before the effect.

## Audit, operations, and validation

Audit records include principal ID, tenant/workspace, route/action, outcome, safe code, request ID, and minimal non-secret metadata. They intentionally exclude bearer tokens, authorization headers, credentials, and claims. Alerts should cover issuer/JWKS unavailability, repeated authentication/authorization denials, unknown principals, revocation activity, worker scope denials, and authorization dead letters.

The executable HTTP test covers every registered route with unauthenticated, insufficient-role/scope, cross-tenant, conflicting tenant selector, authorized, header/query/body tenant-tampering, and resource-path cross-tenant cases. Additional cases verify human evaluator access, auditor read-only behavior, self-approval denial, QAgent policy denial, service approval schema rejection, revocation, audit redaction, worker capability scoping, and worker-time revocation rechecks. See [the threat model](threat-model-decision-continuity-identity.md) for residual risks and owners.
