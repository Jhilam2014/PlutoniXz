import { getProvider } from "./provider-catalog.service.js";

export function buildPermissionPreview(providerId, credentialMethod) {
  const provider = getProvider(providerId);
  return {
    provider_id: provider.id,
    provider_name: provider.name,
    credential_method: credentialMethod || "oidc",
    least_privilege_roles: provider.permissions,
    warnings: [
      "Do not use root, owner, billing administrator, or unrestricted credentials.",
      "Prefer OIDC/Workload Identity Federation or short-lived delegated credentials.",
      "PlutoMix stores only encrypted references and sanitized metadata."
    ],
    sensitive_actions: ["Build image", "Push image", "Create or update runtime service", "Attach deployment-time secrets", "Run health check"],
    approved: false
  };
}
