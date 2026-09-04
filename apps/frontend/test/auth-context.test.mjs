import assert from "node:assert/strict";
import test from "node:test";
import { onboardingTenantId, tenantContextHeaders } from "../src/authContext.js";

test("a single server-issued onboarding tenant becomes authenticated request context", () => {
  const user = { onboarding: { tenantIds: ["plutomix-production"] } };
  assert.equal(onboardingTenantId(user), "plutomix-production");
  assert.deepEqual(tenantContextHeaders(user), { "x-plutomix-tenant-id": "plutomix-production" });
});

test("missing, malformed, or ambiguous onboarding tenants fail closed", () => {
  assert.equal(onboardingTenantId({}), "");
  assert.equal(onboardingTenantId({ onboarding: { tenantIds: ["tenant-a", "tenant-b"] } }), "");
  assert.equal(onboardingTenantId({ onboarding: { tenantIds: [""] } }), "");
  assert.deepEqual(tenantContextHeaders({ onboarding: { tenantIds: ["tenant-a", "tenant-b"] } }), {});
});
