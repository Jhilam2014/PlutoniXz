import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGoogleJitOnboardingConfiguration,
  googleJitRoleForIdentity,
  resolveGoogleJitOnboardingPolicy,
  TenantGovernanceError,
  TenantGovernanceService
} from "../src/tenantGovernance.js";

const admin = {
  issuer: "https://accounts.google.com",
  subject: "100200300400500600",
  email: "admin@example.test",
  emailVerified: true,
  displayName: "Platform administrator"
};

function enabledEnvironment(overrides = {}) {
  return {
    PLUTOMIX_GOOGLE_JIT_ONBOARDING_ENABLED: "true",
    PLUTOMIX_GOOGLE_JIT_TENANT_ID: "example-production",
    PLUTOMIX_GOOGLE_JIT_TENANT_INSTANCE_KEY: "tenant-0123456789abcdef",
    PLUTOMIX_GOOGLE_JIT_ADMIN_ISSUER: admin.issuer,
    PLUTOMIX_GOOGLE_JIT_ADMIN_SUBJECT: admin.subject,
    PLUTOMIX_GOOGLE_JIT_ADMIN_EMAIL: admin.email,
    ...overrides
  };
}

test("Google JIT onboarding is opt-in and validates its server-owned policy", () => {
  assert.deepEqual(resolveGoogleJitOnboardingPolicy({}), { enabled: false });
  assert.doesNotThrow(() => assertGoogleJitOnboardingConfiguration(enabledEnvironment()));
  assert.equal(resolveGoogleJitOnboardingPolicy(enabledEnvironment({
    OIDC_ISSUER: "accounts.google.com",
    PLUTOMIX_GOOGLE_JIT_ADMIN_ISSUER: "accounts.google.com"
  })).adminIssuer, "accounts.google.com");
  assert.throws(
    () => resolveGoogleJitOnboardingPolicy(enabledEnvironment({ OIDC_ISSUER: "accounts.google.com" })),
    (error) => error instanceof TenantGovernanceError && error.code === "google_jit_configuration_invalid"
  );
  assert.throws(
    () => resolveGoogleJitOnboardingPolicy(enabledEnvironment({ PLUTOMIX_GOOGLE_JIT_ADMIN_SUBJECT: "oauth-client.apps.googleusercontent.com" })),
    (error) => error instanceof TenantGovernanceError && error.code === "google_jit_configuration_invalid" && error.status === 503
  );
});

test("only the exact verified Google administrator triple receives administrator authority", () => {
  const policy = resolveGoogleJitOnboardingPolicy(enabledEnvironment());
  assert.deepEqual(
    googleJitRoleForIdentity(admin, policy),
    {
      issuer: admin.issuer,
      subject: admin.subject,
      email: admin.email,
      displayName: admin.displayName,
      role: "tenant_admin",
      platformAdmin: true
    }
  );

  const differentSubject = googleJitRoleForIdentity({ ...admin, subject: "100200300400500601" }, policy);
  assert.equal(differentSubject.role, "team_member");
  assert.equal(differentSubject.platformAdmin, false);

  const differentEmail = googleJitRoleForIdentity({ ...admin, email: "member@example.test" }, policy);
  assert.equal(differentEmail.role, "team_member");
  assert.equal(differentEmail.platformAdmin, false);

  assert.throws(
    () => googleJitRoleForIdentity({ ...admin, issuer: "accounts.google.com" }, policy),
    (error) => error instanceof TenantGovernanceError && error.code === "google_identity_required"
  );
});

test("verified Google users receive least-privilege membership and unverified identities fail closed", () => {
  const policy = resolveGoogleJitOnboardingPolicy(enabledEnvironment());
  const member = googleJitRoleForIdentity({
    issuer: "https://accounts.google.com",
    subject: "1234567890",
    email: "member@example.test",
    emailVerified: true,
    displayName: "Team member"
  }, policy);
  assert.equal(member.role, "team_member");
  assert.equal(member.platformAdmin, false);

  assert.throws(
    () => googleJitRoleForIdentity({ ...admin, emailVerified: false }, policy),
    (error) => error instanceof TenantGovernanceError && error.code === "verified_email_required" && error.status === 403
  );
});

test("platform pagination rejects unbounded or malformed requests before database access", async () => {
  const service = new TenantGovernanceService({ env: enabledEnvironment() });
  await assert.rejects(
    service.platformOverview(admin, { limit: 101 }),
    (error) => error instanceof TenantGovernanceError && error.code === "invalid_pagination" && error.status === 400
  );
  await assert.rejects(
    service.platformOverview(admin, { offset: "not-a-number" }),
    (error) => error instanceof TenantGovernanceError && error.code === "invalid_pagination" && error.status === 400
  );
});
