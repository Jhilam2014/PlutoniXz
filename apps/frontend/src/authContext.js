export function onboardingTenantId(user = {}) {
  const tenantIds = [...new Set(
    (Array.isArray(user?.onboarding?.tenantIds) ? user.onboarding.tenantIds : [])
      .map((tenantId) => String(tenantId || "").trim())
      .filter((tenantId) => tenantId && tenantId.length <= 160)
  )];
  return tenantIds.length === 1 ? tenantIds[0] : "";
}

export function tenantContextHeaders(user = {}) {
  const tenantId = onboardingTenantId(user);
  return tenantId ? { "x-plutomix-tenant-id": tenantId } : {};
}
