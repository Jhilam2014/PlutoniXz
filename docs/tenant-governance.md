# Tenant governance

Migration `014_tenant_governance.sql` adds the authoritative tenant portfolio used by BrainX project creation. Migration `015_tenant_governance_instance_backfill.sql` materializes isolated instances for memberships that existed before tenant governance. Both are additive: existing project registry records remain compatible, while every new or imported tenant application requires an enterprise and an agent catalog.

## Authority and isolation

- A verified OIDC identity must resolve to an active `identity_principals` record and an active `identity_tenant_memberships` row. Tenant owners use role `tenant_admin` with workspace `*`.
- `tenant_instances.instance_key` is a deterministic, non-secret tenant namespace. New workspaces live under `PROJECTS_ROOT/tenants/<instance-key>/<project-folder>`; project reads also require the matching tenant ID.
- `tenant_enterprises` permits two rows per tenant. A transaction-scoped advisory lock plus trigger prevents concurrent requests from exceeding the limit.
- `tenant_applications` owns the project-to-enterprise relationship and records `global_community` or `enterprise` agent source. Enterprise agent definitions carry a tenant/enterprise namespace and are filtered before reuse.
- Team invitations are email-keyed. Acceptance requires a signed bearer identity whose `email_verified` claim is `true` and whose normalized email matches the invitation. The resulting workspace-`*` membership is inherited across all current and future enterprises in that tenant.
- `platform_admin_identities` seeds `jhilam.astro@gmail.com`. The cross-tenant portfolio endpoint re-verifies the bearer identity and never trusts browser user headers or an unverified email claim.

## Google just-in-time onboarding

Google JIT onboarding is opt-in. When enabled, `POST /api/auth/google` verifies Google's signed ID token, extracts the trusted issuer, subject, and verified email, and atomically provisions an active human principal plus a workspace-`*` membership in one server-configured tenant. The browser cannot choose the tenant or its role.

Every verified Google identity receives the least-privilege `team_member` role. One configured administrator is matched by the complete issuer + subject + email triple and receives `tenant_admin`; matching the email alone is insufficient. Disabled principals and any revoked membership in the configured tenant stay blocked and are never bypassed or reactivated by JIT login. Google issuer aliases are resolved as one principal identity, while new and active records use the configured issuer.

```env
PLUTOMIX_GOOGLE_JIT_ONBOARDING_ENABLED=true
PLUTOMIX_GOOGLE_JIT_TENANT_ID=your-logical-tenant-id
PLUTOMIX_GOOGLE_JIT_TENANT_INSTANCE_KEY=tenant-0123456789abcdef
PLUTOMIX_GOOGLE_JIT_ADMIN_ISSUER=https://accounts.google.com
PLUTOMIX_GOOGLE_JIT_ADMIN_SUBJECT=your-numeric-google-sub
PLUTOMIX_GOOGLE_JIT_ADMIN_EMAIL=admin@example.com
```

`PLUTOMIX_GOOGLE_JIT_TENANT_ID` may resolve an existing logical tenant ID or instance key. Prefer the logical ID and set the expected instance key as a deployment guard. Enabling open JIT onboarding grants every verified Google account membership in the configured tenant; deployments that need restricted admission should leave it disabled and use the invitation flow. Login is bounded per verified subject, provisioning is idempotent, and only actual grants create onboarding audit rows.

Google may represent the same verified subject with either `https://accounts.google.com` or `accounts.google.com`. During JIT onboarding, two active human principal rows for those aliases are transactionally reconciled into the configured issuer. Memberships and foreign-key references are retained, roles are combined, and a revoked membership remains revoked. Reconciliation fails closed when an alias is disabled, belongs to a non-human principal, or carries a different stored email.

The frontend retains the signed credential and onboarding result in memory only. When onboarding resolves exactly one tenant, authenticated API requests include that server-issued tenant as `X-PlutoMix-Tenant-ID`; missing or ambiguous tenant results do not produce a tenant header.

The application limit runs after signature verification so its key is a trusted Google subject. The public reverse proxy must additionally rate-limit `POST /api/auth/google` by source before it reaches Node, which bounds invalid-token signature work without trusting caller-supplied forwarding headers.

Changing the configured administrator prevents the former identity from using the platform-admin endpoint, but does not silently remove an existing tenant role. Rotate administrators as an explicit deprovisioning operation: revoke the former principal's wildcard membership or remove `tenant_admin` according to your tenant ownership policy, disable its platform-admin record, then deploy the new exact identity triple.

## API surface

- `GET /api/tenant-governance/overview` — tenant instance, enterprise limit, applications, members, and invitations.
- `POST /api/tenant-governance/enterprises` — create or reuse an enterprise label.
- `DELETE /api/tenant-governance/enterprises/:enterpriseId` — delete an empty enterprise.
- `POST /api/tenant-governance/team-invitations` — invite a tenant-wide team member.
- `POST /api/tenant-governance/invitations/accept` — accept invitations using a verified matching identity.
- `GET /api/platform-admin/overview?limit=25&offset=0` — configured platform administrator's audited, paginated tenant summary. It returns counts rather than cross-tenant member identities or application records and is consumed by the admin-only tenant table.

Project listing, creation, import, selection, mutation, media, and deletion now pass through tenant membership resolution. Project creation accepts `enterpriseId` when selecting an existing enterprise, always requires `enterpriseLabel`, and requires `agentSource`.

## Deployment and rollback

Run `npm --prefix apps/backend run tenant-governance:migrate` using the controlled migration role before deploying the API. The migration is expand-only and recorded by checksum. Roll back application binaries without dropping the new tables; do not delete tenant governance records to roll back code. The migration can be validated with `--dry-run` and the focused PostgreSQL suite in `test/integration/tenantGovernance.integration.test.js`.
