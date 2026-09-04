import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { TenantGovernanceError, TenantGovernanceService, tenantInstanceKey } from "../../src/tenantGovernance.js";
import { IdentityAccessStore } from "../../src/identityAccess.js";

const databaseUrl = process.env.DECISION_CONTINUITY_TEST_DATABASE_URL;
const options = databaseUrl ? {} : { skip: "Set DECISION_CONTINUITY_TEST_DATABASE_URL to run tenant-governance integration tests." };

async function removeFixture(pool, tenantIds, principalIds) {
  for (const tenantId of tenantIds) {
    await pool.query("DELETE FROM identity_access_audit WHERE tenant_id = $1", [tenantId]);
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
  const service = new TenantGovernanceService({ databaseUrl, env: {} });
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

test("Google JIT onboarding provisions least privilege and binds platform administration to the exact identity", options, async (context) => {
  const runId = `${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const tenantId = `tenant-jit-${runId}`;
  const adminEmail = `admin-${runId}@example.test`;
  const adminSubject = `${Date.now()}01`;
  const memberSubject = `${Date.now()}02`;
  const concurrentSubject = `${Date.now()}03`;
  const revokedSubject = `${Date.now()}04`;
  const disabledSubject = `${Date.now()}05`;
  const legacyIssuerSubject = `${Date.now()}06`;
  const environment = {
    PLUTOMIX_GOOGLE_JIT_ONBOARDING_ENABLED: "true",
    PLUTOMIX_GOOGLE_JIT_TENANT_ID: tenantId,
    PLUTOMIX_GOOGLE_JIT_TENANT_INSTANCE_KEY: tenantInstanceKey(tenantId),
    PLUTOMIX_GOOGLE_JIT_ADMIN_ISSUER: "https://accounts.google.com",
    PLUTOMIX_GOOGLE_JIT_ADMIN_SUBJECT: adminSubject,
    PLUTOMIX_GOOGLE_JIT_ADMIN_EMAIL: adminEmail
  };
  const service = new TenantGovernanceService({ databaseUrl, env: environment });
  const identities = new IdentityAccessStore({ databaseUrl });
  const pool = await service.database();
  const principalIds = [];
  context.after(async () => {
    await removeFixture(pool, [tenantId], principalIds);
    await pool.query("DELETE FROM platform_admin_identities WHERE email_key = $1", [adminEmail]);
    await pool.end();
    if (identities.pool && identities.pool !== pool) await identities.pool.end();
  });

  const member = await service.onboardGoogleIdentity({
    issuer: "https://accounts.google.com",
    subject: memberSubject,
    email: `member-${runId}@example.test`,
    emailVerified: true,
    displayName: "JIT member"
  });
  principalIds.push(member.principalId);
  assert.equal(member.provisioned, true);
  assert.equal(member.platformAdmin, false);
  assert.deepEqual(member.roles, ["team_member"]);
  assert.deepEqual(member.tenantIds, [tenantId]);

  const repeated = await service.onboardGoogleIdentity({
    issuer: "https://accounts.google.com",
    subject: memberSubject,
    email: `member-${runId}@example.test`,
    emailVerified: true,
    displayName: "JIT member"
  });
  assert.equal(repeated.principalId, member.principalId);
  assert.equal(repeated.provisioned, false);
  const memberAudit = await pool.query(
    "SELECT count(*)::int AS count FROM identity_access_audit WHERE principal_id = $1 AND action = 'identity.google_jit_onboard' AND outcome = 'allowed'",
    [member.principalId]
  );
  assert.equal(memberAudit.rows[0].count, 1);

  const concurrentIdentity = {
    issuer: "https://accounts.google.com",
    subject: concurrentSubject,
    email: `concurrent-${runId}@example.test`,
    emailVerified: true,
    displayName: "Concurrent JIT member"
  };
  const concurrent = await Promise.all([
    service.onboardGoogleIdentity(concurrentIdentity),
    service.onboardGoogleIdentity(concurrentIdentity)
  ]);
  principalIds.push(concurrent[0].principalId);
  assert.equal(new Set(concurrent.map((item) => item.principalId)).size, 1);
  assert.deepEqual(concurrent.map((item) => item.provisioned).sort(), [false, true]);

  const legacyIssuerPrincipalId = `principal-legacy-issuer-${runId}`;
  principalIds.push(legacyIssuerPrincipalId);
  await identities.provisionPrincipal({
    id: legacyIssuerPrincipalId,
    issuer: "accounts.google.com",
    subject: legacyIssuerSubject,
    displayName: "Legacy issuer member",
    email: `legacy-${runId}@example.test`
  });
  const migratedLegacyIssuer = await service.onboardGoogleIdentity({
    issuer: "https://accounts.google.com",
    subject: legacyIssuerSubject,
    email: `legacy-${runId}@example.test`,
    emailVerified: true
  });
  assert.equal(migratedLegacyIssuer.principalId, legacyIssuerPrincipalId);
  assert.equal((await pool.query("SELECT issuer FROM identity_principals WHERE principal_id = $1", [legacyIssuerPrincipalId])).rows[0].issuer, "https://accounts.google.com");

  const revokedPrincipalId = `principal-revoked-${runId}`;
  principalIds.push(revokedPrincipalId);
  await identities.provisionPrincipal({
    id: revokedPrincipalId,
    issuer: "accounts.google.com",
    subject: revokedSubject,
    displayName: "Revoked JIT member",
    email: `revoked-${runId}@example.test`
  });
  await identities.provisionMembership({
    principalId: revokedPrincipalId,
    tenantId,
    workspaceId: `workspace-${runId}`,
    roles: ["team_member"],
    status: "revoked"
  });
  await assert.rejects(
    service.onboardGoogleIdentity({
      issuer: "https://accounts.google.com",
      subject: revokedSubject,
      email: `revoked-${runId}@example.test`,
      emailVerified: true
    }),
    (error) => error instanceof TenantGovernanceError && error.code === "membership_revoked"
  );
  assert.equal((await pool.query(
    "SELECT 1 FROM identity_tenant_memberships WHERE principal_id = $1 AND tenant_id = $2 AND workspace_id = '*'",
    [revokedPrincipalId, tenantId]
  )).rowCount, 0);

  const disabledPrincipalId = `principal-disabled-${runId}`;
  principalIds.push(disabledPrincipalId);
  await identities.provisionPrincipal({
    id: disabledPrincipalId,
    issuer: "accounts.google.com",
    subject: disabledSubject,
    displayName: "Disabled JIT member",
    email: `disabled-${runId}@example.test`,
    status: "disabled"
  });
  await assert.rejects(
    service.onboardGoogleIdentity({
      issuer: "https://accounts.google.com",
      subject: disabledSubject,
      email: `disabled-${runId}@example.test`,
      emailVerified: true
    }),
    (error) => error instanceof TenantGovernanceError && error.code === "principal_disabled"
  );

  const administrator = await service.onboardGoogleIdentity({
    issuer: "https://accounts.google.com",
    subject: adminSubject,
    email: adminEmail.toUpperCase(),
    emailVerified: true,
    displayName: "JIT administrator"
  });
  principalIds.push(administrator.principalId);
  assert.equal(administrator.platformAdmin, true);
  assert.deepEqual(administrator.roles, ["tenant_admin"]);

  const portfolio = await service.platformOverview({
    issuer: "https://accounts.google.com",
    subject: adminSubject,
    email: adminEmail,
    emailVerified: true,
    displayName: "JIT administrator"
  }, { limit: 1, offset: 0 });
  assert.equal(portfolio.tenants[0]?.id, tenantId);
  assert.equal(portfolio.tenants[0]?.memberCount >= 3, true);
  assert.equal("members" in portfolio.tenants[0], false);
  assert.equal("administrator" in portfolio, false);
  assert.equal(portfolio.pagination.limit, 1);
  await assert.rejects(
    service.platformOverview({
      issuer: "https://accounts.google.com",
      subject: memberSubject,
      email: adminEmail,
      emailVerified: true
    }),
    (error) => error instanceof TenantGovernanceError && error.code === "platform_admin_required"
  );
  const platformAudits = await pool.query(
    `SELECT outcome, code FROM identity_access_audit
      WHERE action = 'platform_admin.overview' AND tenant_id = $1
      ORDER BY audit_id`,
    [tenantId]
  );
  assert.deepEqual(platformAudits.rows.map((row) => [row.outcome, row.code]), [
    ["allowed", "authorized"],
    ["denied", "platform_admin_required"]
  ]);

  const mismatchedGuard = new TenantGovernanceService({
    databaseUrl,
    env: { ...environment, PLUTOMIX_GOOGLE_JIT_TENANT_INSTANCE_KEY: "tenant-ffffffffffffffff" }
  });
  await assert.rejects(
    mismatchedGuard.onboardGoogleIdentity({
      issuer: "https://accounts.google.com",
      subject: `${Date.now()}07`,
      email: `guard-${runId}@example.test`,
      emailVerified: true
    }),
    (error) => error instanceof TenantGovernanceError && error.code === "google_jit_configuration_invalid"
  );
  if (mismatchedGuard.pool && mismatchedGuard.pool !== pool) await mismatchedGuard.pool.end();
});

test("platform portfolio requires the configured verified administrator email", options, async (context) => {
  const runId = `${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const tenantId = `tenant-platform-${runId}`;
  const ownerId = `platform-owner-${runId}`;
  const service = new TenantGovernanceService({ databaseUrl, env: {} });
  const identities = new IdentityAccessStore({ databaseUrl });
  const pool = await service.database();
  const auditFloor = (await pool.query("SELECT COALESCE(max(audit_id), 0)::text AS audit_floor FROM identity_access_audit")).rows[0].audit_floor;
  context.after(async () => {
    await pool.query("DELETE FROM identity_access_audit WHERE audit_id > $1 AND action = 'platform_admin.overview'", [auditFloor]);
    await removeFixture(pool, [tenantId], [ownerId]);
    await pool.end();
    if (identities.pool && identities.pool !== pool) await identities.pool.end();
  });
  await identities.provisionPrincipal({ id: ownerId, issuer: "test", subject: ownerId });
  await identities.provisionMembership({ principalId: ownerId, tenantId, roles: ["tenant_admin"] });
  await service.overview({ tenantId });
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
  assert.equal("administrator" in overview, false);
});
