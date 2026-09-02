import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { TenantGovernanceError, TenantGovernanceService, tenantInstanceKey } from "../../src/tenantGovernance.js";
import { IdentityAccessStore } from "../../src/identityAccess.js";

const databaseUrl = process.env.DECISION_CONTINUITY_TEST_DATABASE_URL;
const options = databaseUrl ? {} : { skip: "Set DECISION_CONTINUITY_TEST_DATABASE_URL to run tenant-governance integration tests." };

async function removeFixture(pool, tenantIds, principalIds) {
  for (const tenantId of tenantIds) {
    await pool.query("DELETE FROM tenant_team_invitations WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM tenant_applications WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM tenant_enterprises WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM identity_tenant_memberships WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM tenant_instances WHERE tenant_id = $1", [tenantId]);
  }
  for (const principalId of principalIds) await pool.query("DELETE FROM identity_principals WHERE principal_id = $1", [principalId]);
}

test("enforces two enterprises atomically, isolates tenant applications, and permits delete-then-create", options, async (context) => {
  const runId = `${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const tenantA = `tenant-governance-a-${runId}`;
  const tenantB = `tenant-governance-b-${runId}`;
  const ownerId = `tenant-owner-${runId}`;
  const identities = new IdentityAccessStore({ databaseUrl });
  const service = new TenantGovernanceService({ databaseUrl });
  const pool = await service.database();
  context.after(async () => {
    await removeFixture(pool, [tenantA, tenantB], [ownerId]);
    await pool.end();
    if (identities.pool && identities.pool !== pool) await identities.pool.end();
  });

  await identities.provisionPrincipal({ id: ownerId, issuer: "test", subject: ownerId, displayName: "Tenant owner" });
  await identities.provisionMembership({ principalId: ownerId, tenantId: tenantA, roles: ["tenant_admin"] });

  const created = await Promise.all([
    service.resolveEnterprise({ label: "Commerce" }, { tenantId: tenantA, principalId: ownerId }),
    service.resolveEnterprise({ label: "Research" }, { tenantId: tenantA, principalId: ownerId })
  ]);
  assert.deepEqual(new Set(created.map((item) => item.enterprise.label)), new Set(["Commerce", "Research"]));
  assert.equal(created[0].tenant.instanceKey, tenantInstanceKey(tenantA));
  await assert.rejects(
    service.resolveEnterprise({ label: "Operations" }, { tenantId: tenantA, principalId: ownerId }),
    (error) => error instanceof TenantGovernanceError && error.code === "enterprise_limit_reached" && error.status === 409
  );

  const commerce = created.find((item) => item.enterprise.label === "Commerce").enterprise;
  const application = await service.registerApplication({ applicationId: `app-${runId}`, applicationName: "Commerce app", enterpriseId: commerce.id, agentSource: "enterprise", ownerPrincipalId: ownerId }, { tenantId: tenantA });
  assert.equal(application.instanceKey, tenantInstanceKey(tenantA));
  assert.equal(application.agentSource, "enterprise");
  assert.equal((await service.overview({ tenantId: tenantB })).applications.length, 0);
  await assert.rejects(
    service.deleteEnterprise(commerce.id, { tenantId: tenantA }),
    (error) => error instanceof TenantGovernanceError && error.code === "enterprise_not_empty"
  );

  await service.removeApplication(application.id, { tenantId: tenantA });
  await service.deleteEnterprise(commerce.id, { tenantId: tenantA });
  const replacement = await service.resolveEnterprise({ label: "Operations" }, { tenantId: tenantA, principalId: ownerId });
  assert.equal(replacement.enterprise.label, "Operations");
  const overview = await service.overview({ tenantId: tenantA });
  assert.equal(overview.limits.enterpriseCount, 2);
  assert.equal(overview.limits.canCreateEnterprise, false);
});

test("tenant-wide invitations become inherited memberships only for a verified matching identity", options, async (context) => {
  const runId = `${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const tenantId = `tenant-invite-${runId}`;
  const ownerId = `invite-owner-${runId}`;
  const memberEmail = `member-${runId}@example.test`;
  const service = new TenantGovernanceService({ databaseUrl });
  const identities = new IdentityAccessStore({ databaseUrl });
  const pool = await service.database();
  let memberPrincipalId = "";
  context.after(async () => {
    await removeFixture(pool, [tenantId], [ownerId, memberPrincipalId].filter(Boolean));
    await pool.end();
    if (identities.pool && identities.pool !== pool) await identities.pool.end();
  });

  await identities.provisionPrincipal({ id: ownerId, issuer: "test", subject: ownerId, displayName: "Invite owner" });
  await identities.provisionMembership({ principalId: ownerId, tenantId, roles: ["tenant_admin"] });
  await service.resolveEnterprise({ label: "Primary enterprise" }, { tenantId, principalId: ownerId });
  const invitation = await service.inviteTeamMember({ email: memberEmail }, { tenantId, principalId: ownerId });
  assert.equal(invitation.status, "pending");
  await assert.rejects(
    service.acceptInvitations({ issuer: "https://issuer.test", subject: `member-${runId}`, email: memberEmail, emailVerified: false }),
    (error) => error instanceof TenantGovernanceError && error.code === "verified_email_required"
  );
  const accepted = await service.acceptInvitations({ issuer: "https://issuer.test", subject: `member-${runId}`, displayName: "Team member", email: memberEmail.toUpperCase(), emailVerified: true });
  memberPrincipalId = accepted.principalId;
  const principal = { id: memberPrincipalId, type: "human" };
  const membership = await identities.membershipFor({ principal, tenantId });
  assert.equal(membership.workspaceId, "*");
  assert.deepEqual(membership.roles, ["team_member"]);
  assert.equal((await service.overview({ tenantId })).invitations[0].status, "accepted");
});

test("platform portfolio requires the configured verified administrator email", options, async (context) => {
  const runId = `${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const tenantId = `tenant-platform-${runId}`;
  const ownerId = `platform-owner-${runId}`;
  const service = new TenantGovernanceService({ databaseUrl });
  const identities = new IdentityAccessStore({ databaseUrl });
  const pool = await service.database();
  context.after(async () => {
    await removeFixture(pool, [tenantId], [ownerId]);
    await pool.end();
    if (identities.pool && identities.pool !== pool) await identities.pool.end();
  });
  await identities.provisionPrincipal({ id: ownerId, issuer: "test", subject: ownerId });
  await identities.provisionMembership({ principalId: ownerId, tenantId, roles: ["tenant_admin"] });
  const membershipOverview = await service.platformOverview({ email: "jhilam.astro@gmail.com", displayName: "Jhilam", emailVerified: true });
  assert.equal(membershipOverview.tenants.find((tenant) => tenant.id === tenantId)?.instanceKey, tenantInstanceKey(tenantId));
  await service.resolveEnterprise({ label: "Admin visible enterprise" }, { tenantId, principalId: ownerId });

  assert.equal(await service.isPlatformAdmin({ email: "jhilam.astro@gmail.com", emailVerified: false }), false);
  await assert.rejects(
    service.platformOverview({ email: "other@example.test", emailVerified: true }),
    (error) => error instanceof TenantGovernanceError && error.code === "platform_admin_required"
  );
  const overview = await service.platformOverview({ email: "JHILAM.ASTRO@GMAIL.COM", displayName: "Jhilam", emailVerified: true });
  assert.ok(overview.tenants.some((tenant) => tenant.id === tenantId));
  assert.equal(overview.administrator.email, "jhilam.astro@gmail.com");
});
