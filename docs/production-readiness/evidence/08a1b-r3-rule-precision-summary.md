# 08A1B-R3 scanner-rule precision summary

Each row reports current R2 equality classes that contain the rule. A rule may contribute to more than one observation in the same class; this document does not treat a scanner match as secret semantics.

| Rule | Detection contract | Semantic assertion | Strict parser | Deterministic non-secret | Positive candidate | Unresolved | Classes | Observations | Contextual hardening |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| aws-access-token | Provider-shaped access-key material; scanner match alone does not establish authentication use. | PROVIDER_STRUCTURE_ONLY | STRICT_AWS_ACCESS_KEY_ID | 0 | 0 | 1 | 1 | 6 | Require a strict parser plus a repository authentication-client or credential-store consumption trace. |
| gcp-api-key | Google API-key-shaped string; scanner match alone does not establish use or scope. | PROVIDER_STRUCTURE_ONLY | STRICT_GOOGLE_API_KEY | 0 | 0 | 6 | 6 | 50 | Require a strict parser plus a repository authentication-client or secret-configuration consumption trace. |
| generic-api-key | Broad key/value string shape; it makes no secret, provider, or authentication-semantic assertion. | BROAD_STRING_SHAPE_ONLY | NO_GENERIC_CREDENTIAL_PARSER | 1 | 0 | 1057 | 1058 | 14917 | Require a source schema that marks the field secret-bearing and a privileged-use consumption trace. |
| linkedin-client-id | Client/application identifier shape; it is not a client secret assertion. | PUBLIC_IDENTIFIER_OR_STRUCTURE_ONLY | STRICT_LINKEDIN_CLIENT_IDENTIFIER | 0 | 0 | 1 | 1 | 6 | Require a schema/consumer distinction between a public client ID and a client secret before positive routing. |
| openai-api-key | OpenAI-key-shaped string; scanner match alone does not establish authentication use, account, or project scope. | PROVIDER_STRUCTURE_ONLY | STRICT_OPENAI_KEY | 0 | 0 | 2 | 2 | 5 | Require a strict parser plus a repository authentication-client, secret configuration, or credential-store consumption trace. |

## Synthetic precision suite

`scripts/test-08a1b-r3-semantic-triage.mjs` verifies synthetic generated identifiers, a generic key-like value without a producer contract, a provider-shaped value without authentication context, and a provider-shaped value with a strict parser plus secret-bearing authentication context. It also verifies that every contributing scanner rule has an explicit semantic contract. No real credential is used or persisted.
