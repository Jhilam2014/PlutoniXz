# Tenant governance

Migration `014_tenant_governance.sql` adds the authoritative tenant portfolio used by BrainX project creation. Migration `015_tenant_governance_instance_backfill.sql` materializes isolated instances for memberships that existed before tenant governance. Both are additive: existing project registry records remain compatible, while every new or imported tenant application requires an enterprise and an agent catalog.

## Authority and isolation

- A verified OIDC identity must resolve to an active `identity_principals` record and an active `identity_tenant_memberships` row. Tenant owners use role `tenant_admin` with workspace `*`.
- `tenant_instances.instance_key` is a deterministic, non-secret tenant namespace. New workspaces live under `PROJECTS_ROOT/tenants/<instance-key>/<project-folder>`; project reads also require the matching tenant ID.
- `tenant_enterprises` permits two rows per tenant. A transaction-scoped advisory lock plus trigger prevents concurrent requests from exceeding the limit.
- `tenant_applications` owns the project-to-enterprise relationship and records `global_community` or `enterprise` agent source. Enterprise agent definitions carry a tenant/enterprise namespace and are filtered before reuse.
- Team invitations are email-keyed. Acceptance requires a signed bearer identity whose `email_verified` claim is `true` and whose normalized email matches the invitation. The resulting workspace-`*` membership is inherited across all current and future enterprises in that tenant.
- `platform_admin_identities` seeds `jhilam.astro@gmail.com`. The cross-tenant portfolio endpoint re-verifies the bearer identity and never trusts browser user headers or an unverified email claim.

## API surface

- `GET /api/tenant-governance/overview` — tenant instance, enterprise limit, applications, members, and invitations.
- `POST /api/tenant-governance/enterprises` — create or reuse an enterprise label.
- `DELETE /api/tenant-governance/enterprises/:enterpriseId` — delete an empty enterprise.
- `POST /api/tenant-governance/team-invitations` — invite a tenant-wide team member.
- `POST /api/tenant-governance/invitations/accept` — accept invitations using a verified matching identity.
- `GET /api/platform-admin/overview` — configured platform administrator portfolio across tenant instances.

Project listing, creation, import, selection, mutation, media, and deletion now pass through tenant membership resolution. Project creation accepts `enterpriseId` when selecting an existing enterprise, always requires `enterpriseLabel`, and requires `agentSource`.

## Deployment and rollback

Run `npm --prefix apps/backend run tenant-governance:migrate` using the controlled migration role before deploying the API. The migration is expand-only and recorded by checksum. Roll back application binaries without dropping the new tables; do not delete tenant governance records to roll back code. The migration can be validated with `--dry-run` and the focused PostgreSQL suite in `test/integration/tenantGovernance.integration.test.js`.
