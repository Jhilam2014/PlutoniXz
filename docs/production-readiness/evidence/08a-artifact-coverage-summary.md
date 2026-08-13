# 08A1D artifact coverage summary

> Current status: **NOT RUN — semantic gate blocked.** This document records the historical pre-R3 coverage run only. See `08a1d-r3-semantic-gate.sanitized.json`; a full 08A1D rerun is prohibited until R3 has zero semantically unresolved classes.

## Scope derivation

The complete in-repository surface is determined from Docker Compose's root build context with the checked-in `.dockerignore` whitelist; backend, frontend, and generated-site build inputs; runtime export/staged-media directories; generated memory and observability data; and packaged deliverables. The CI secret-scan workflow has no upload/download-artifact step, so it adds no separate CI artifact object. External mounts such as `$HOME/.codex` are not repository-owned and are not included.

| Root | Purpose | Decision | Reachability | Observations | Logical items | State |
| --- | --- | --- | --- | ---: | ---: | --- |
| . | Docker Compose build context and tracked worktree | REPOSITORY_CONFIGURATION_DERIVED | GIT, BUILD_CONTEXT, DEPLOYMENT_INPUT | 15 | 15 | FINDINGS_MAPPED_PENDING_DISPOSITION |
| apps/backend | Docker Compose backend build input permitted by .dockerignore | REPOSITORY_CONFIGURATION_DERIVED | BUILD_CONTEXT, RUNTIME, DEPLOYMENT | 3 | 3 | FINDINGS_MAPPED_PENDING_DISPOSITION |
| apps/frontend | Docker Compose frontend build input permitted by .dockerignore | REPOSITORY_CONFIGURATION_DERIVED | BUILD_CONTEXT, FRONTEND_DOWNLOAD | 0 | 0 | CLEAN |
| apps/generated-site | Docker Compose generated-site build input permitted by .dockerignore | REPOSITORY_CONFIGURATION_DERIVED | BUILD_CONTEXT, EXPORT | 0 | 0 | CLEAN |
| runtime | Runtime exports, staged media, and repository-owned runtime state | REPOSITORY_CONFIGURATION_DERIVED | RUNTIME, EXPORT, BACKUP | 14840 | 14807 | FINDINGS_MAPPED_PENDING_DISPOSITION |
| memory | Repository-owned generated memory artifacts | REPOSITORY_CONFIGURATION_DERIVED | RUNTIME | 22 | 6 | FINDINGS_MAPPED_PENDING_DISPOSITION |
| observability | Repository-owned observability artifacts | REPOSITORY_CONFIGURATION_DERIVED | RUNTIME | 2 | 2 | FINDINGS_MAPPED_PENDING_DISPOSITION |
| deliverables | Packaged deliverables | REPOSITORY_CONFIGURATION_DERIVED | EXPORT, DEPLOYMENT | 0 | 0 | CLEAN |
| apps/frontend/dist | Published frontend build output | REPOSITORY_CONFIGURATION_DERIVED | BUILD, FRONTEND_DOWNLOAD | 0 | 0 | CLEAN |
| apps/generated-site/dist | Generated-site build output | REPOSITORY_CONFIGURATION_DERIVED | BUILD, EXPORT | 0 | 0 | CLEAN |

## Format coverage

ZIP archives receive bounded preflight plus isolated static extraction. Oversized regular/binary files are scanned as streamed printable strings; smaller regular files are already covered by the structurally redacted 08A root scans. The following special records prove the discovered archive and oversized-file surface:

| Artifact | Format | Bytes | SHA-256 | Observations | Mapped logical items | State |
| --- | --- | ---: | --- | ---: | ---: | --- |
| observability/orchestrator-health/health-report.timeline.jsonl | REGULAR_FILE | 128127570 | ba579e1a0ab6c0a1a068efe113fcd38812b22ed7cbfcb42832b3e43533aa2723 | 0 | 0 | CLEAN |
| runtime/exports/generated-site-app.zip | ZIP | 308587 | ea9156064af26313bdffd202154c71f4799adb4bce69e98f1cfe06191ff5f1c4 | 0 | 0 | CLEAN |
| runtime/projects/_exports/generated-site-app.zip | ZIP | 307156 | 5471d1148062e275e767914363c5376b5ddb6fd97fcc391cf64ff00da8d35fac | 0 | 0 | CLEAN |
| runtime/projects/_exports/imported-smoke-app-app.zip | ZIP | 307338 | 44c8d83c2b971f1f47490438a9504bed8aa92d56064361d1a463c2ca807504c5 | 0 | 0 | CLEAN |
| runtime/staged-project-media/anonymous/media-reference-1785269531421-archive.zip | ZIP | 2885931 | a89246c0adc588b65aa5a8fc90fbf1bbe3e554c9f3e2c788d1b29eaf7d9e6cde | 2 | 1 | FINDINGS_MAPPED_PENDING_DISPOSITION |
| runtime/staged-project-media/anonymous/media-reference-1785363766182-archive.zip | ZIP | 2885931 | a89246c0adc588b65aa5a8fc90fbf1bbe3e554c9f3e2c788d1b29eaf7d9e6cde | 2 | 1 | FINDINGS_MAPPED_PENDING_DISPOSITION |
| runtime/staged-project-media/anonymous/media-reference-1785364348251-archive.zip | ZIP | 2885931 | a89246c0adc588b65aa5a8fc90fbf1bbe3e554c9f3e2c788d1b29eaf7d9e6cde | 2 | 1 | FINDINGS_MAPPED_PENDING_DISPOSITION |

## Mapping and disposition boundary

Gitleaks-native observations map through the full 08A1B canonical identity. The bounded static-string fallback can map only when the normalized location and rule identify exactly one existing canonical item; it never asserts credential equality or creates a terminal owner disposition. A scan finding may be `FINDINGS_MAPPED_PENDING_DISPOSITION` because 08A1C has not yet obtained authorized terminal owner disposition; that is distinct from coverage failure. No `UNSCANNED`, `UNSUPPORTED`, unmapped, expired, or out-of-scope records are acceptable for 08A1D pass.

- State totals: CLEAN=11, FINDINGS_RECONCILED=0, FINDINGS_MAPPED_PENDING_DISPOSITION=8, UNSCANNED=0, UNSUPPORTED=0, OUT_OF_SCOPE_APPROVED=0
- Unmapped observations: 0
- Invalid or expired exclusions: 0
- Approved exclusions: 0 (none are used in this run)
