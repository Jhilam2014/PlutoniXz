# Step 8 operational hardening handoff

## Implemented boundary controls

`operationalSecurity.js` redacts authorization, cookies, passwords, secret/token/key fields, database URLs, known provider-key patterns, and caller-configured protected fields before structured telemetry. API telemetry is an OpenTelemetry-log-compatible JSON bridge: it emits service resource attributes, a 32-hex `traceId`, a 16-hex `spanId`, stable HTTP semantic attributes, and bounded metadata. The API echoes `x-request-id` for trace propagation. It hashes a tenant only after membership authorization resolves it; client-provided tenant selectors are never recorded as a tenant identity. This is not an OTLP exporter or a substitute for lifecycle spans/metrics.

Production startup refuses file authority, non-durable workflows, development authentication, the explicitly insecure `env`/`plaintext`/`local`/`none` secrets-provider modes, missing secrets-provider reference, missing encryption-key reference, or empty/wildcard egress allowlist. API JSON bodies default to 256 KiB.

Production secrets must be injected by the configured provider; `.env.example` contains blank placeholders only. The previous example contained an Apify credential-shaped value: treat it as exposed, rotate/revoke it outside this repository, and apply history-remediation policy before release. The local `.env` and nested submodule `.env` are ignored rather than tracked, but still require owner-managed rotation/access controls. Never store credentials in prompts, ledger events, graph/vector projections, fixtures, browser bundles, exceptions, or telemetry.

Initial local inventory used redacted pattern matching only: the checked-in example was remediated; ignored operator configuration remains at the root and nested submodule; and token-shaped strings were found in a backend test fixture plus existing memory/runtime artifacts. Those data-bearing artifacts and binary deliverables were not rewritten because their ownership/provenance is unknown. They require a secret-manager migration and an authorized data-owner review before production; a proper repository/image secret scanner must make this inventory repeatable in CI.

## Threat/data flow coverage

The Decision Continuity ledger is the authority for branches, condition events, QAgent, BrainX, suggestions, and Intel. OIDC membership scopes tenant/workspace access; event/outbox records preserve lifecycle traceability. QAgent and BrainX remain bounded/disabled by default and cannot approve/policy/promote. Suggested Next/Intel records are non-executing and link only to the Step 4 promotion lifecycle.

Data flow: `OIDC bearer → membership authorization → tenant/workspace-scoped API → authoritative PostgreSQL event/current-state/outbox → bounded worker and advisory components → redacted correlation telemetry`. Browser and advisory/model outputs never become authority without the existing deterministic evaluation, policy, and human-approval paths. The Decision Continuity event ledger chains canonical event hashes to its predecessor; this is tamper-evident within the database, not immutable external anchoring. Identity-access audit rows and exported operational logs still need a managed immutable/WORM audit sink and periodic integrity-anchor verification before a production claim.

Residual reviewed threats: cross-tenant selectors, prompt/retrieval injection, confused deputy/tool escalation, unsafe model artifacts/datasets, vector poisoning, replay/stale events, evaluation gaming, proposer-as-judge, secret leakage, licence/egress errors, and QAgent/BrainX/reactivation loops. Controls are documented in the Decision Continuity, BrainX, QAgent, and identity threat/runbook documents; gaps below prevent production readiness.

## Required before production gate

- Configure a provider-backed secrets manager, encryption-key reference, egress allowlist, staging/production-separated database/object-store/queue identities, and non-owner database role.
- Implement and exercise encrypted authoritative-artifact backup/restore in an isolated environment; verify event hashes, lineage, approval/promotion state, and rebuild projections.
- Add deployment-specific OTel exporter, metrics/alerts-as-code, retention/deletion propagation, SBOM/container scan, image provenance/signing, non-root/read-only container compatibility, and incident runbooks for DB/outbox/queue/audit/canary/rollback/provider/deletion.
- Define configuration-owned RPO/RTO and SLO thresholds. Do not report achieved SLOs until telemetry is exported and measured.
- Resolve or accept with an owner and expiry the current backend production dependency audit finding: one low-severity transitive `body-parser` denial-of-service advisory. Frontend production dependencies currently report no findings.

The production-profile Decision Continuity worker and migration job now run as `node` with a read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`, and a noexec/nosuid temporary filesystem. The general API service is intentionally not declared hardened: its current development composition mounts a writable workspace, Codex home, and Docker socket. Do not use that composition as a production deployment pattern; split project-runtime administration from the API before release.
