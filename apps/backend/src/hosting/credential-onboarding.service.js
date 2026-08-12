export function credentialSecurityGuidance(method = "oidc") {
  return {
    method,
    preferred: ["oidc", "oauth", "workload_identity"].includes(method),
    guidance: "Use short-lived identity federation whenever possible. Never paste secrets into chat.",
    disallowed: ["root credentials", "billing owner", "unrestricted admin", "raw .env files"]
  };
}
