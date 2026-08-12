# Credential Security Model

Plaintext credentials must not be stored in files, logs, vector memory, graph artifacts, docs, or observability.

Preferred methods are OAuth, OIDC, and Workload Identity Federation with short-lived credentials. Manual credentials should be limited to vault references. The local development implementation returns sanitized credential metadata and a mock encrypted-reference URI.

Production integrations should use Google Secret Manager with KMS, AWS Secrets Manager with KMS, Azure Key Vault, HashiCorp Vault, or an equivalent encrypted vault.
