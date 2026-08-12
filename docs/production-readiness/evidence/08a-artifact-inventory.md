# 08A1D artifact inventory

This evidence is derived from the checked-in Docker Compose build contexts, `.dockerignore` allowlist, and repository-owned runtime/export roots. It records metadata and redacted scanner evidence only; no credential value is copied here.

- 08A1B source run: `20260811T214249Z`
- Generated scan run: `20260811T214249Z`
- Roots: 10; special or oversized artifacts: 7
- States: CLEAN=11, FINDINGS_RECONCILED=0, FINDINGS_MAPPED_PENDING_DISPOSITION=8, UNSCANNED=0, UNSUPPORTED=0, OUT_OF_SCOPE_APPROVED=0
- Unmapped observations: 0
- Approved exclusions: 0

## Read-only method

Discovery uses `lstat`, never follows links, and skips prior scanner-report directories. ZIP inputs are listed and preflighted for traversal, links, encryption, entry count, declared size, and expansion ratio before isolated temporary extraction. Oversized regular/binary files are streamed through bounded static-string extraction without a raw temporary copy. Pinned Gitleaks root reports and every 08A1D report are structurally redacted before use.

| ID | Path | Format | Bytes | Reachability | Observations | Logical items | Unmapped | State | Sanitized evidence |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- |
| ROOT-B746588257D25F0B2BEF | . | DIRECTORY_OR_BUILD_CONTEXT | — | GIT, BUILD_CONTEXT, DEPLOYMENT_INPUT | 15 | 15 | 0 | FINDINGS_MAPPED_PENDING_DISPOSITION | runtime/secret-scan/20260811T214249Z/worktree.gitleaks.json |
| ROOT-C6554F9E344ADA49B18C | apps/backend | DIRECTORY_OR_BUILD_CONTEXT | — | BUILD_CONTEXT, RUNTIME, DEPLOYMENT | 3 | 3 | 0 | FINDINGS_MAPPED_PENDING_DISPOSITION | runtime/secret-scan/20260811T214249Z/worktree.gitleaks.json |
| ROOT-5822EA26D61AF538341F | apps/frontend | DIRECTORY_OR_BUILD_CONTEXT | — | BUILD_CONTEXT, FRONTEND_DOWNLOAD | 0 | 0 | 0 | CLEAN | runtime/secret-scan/20260811T214249Z/worktree.gitleaks.json |
| ROOT-45299A4F3066FF7138E7 | apps/generated-site | DIRECTORY_OR_BUILD_CONTEXT | — | BUILD_CONTEXT, EXPORT | 0 | 0 | 0 | CLEAN | runtime/secret-scan/20260811T214249Z/worktree.gitleaks.json |
| ROOT-D92C6A81B2FF50096BCD | runtime | DIRECTORY_OR_BUILD_CONTEXT | — | RUNTIME, EXPORT, BACKUP | 14840 | 14807 | 0 | FINDINGS_MAPPED_PENDING_DISPOSITION | runtime/secret-scan/20260811T214249Z/runtime.gitleaks.json |
| ROOT-C064FBCA9D9DE8DD9BB0 | memory | DIRECTORY_OR_BUILD_CONTEXT | — | RUNTIME | 22 | 6 | 0 | FINDINGS_MAPPED_PENDING_DISPOSITION | runtime/secret-scan/20260811T214249Z/memory.gitleaks.json |
| ROOT-58EE00072EFBFF714350 | observability | DIRECTORY_OR_BUILD_CONTEXT | — | RUNTIME | 2 | 2 | 0 | FINDINGS_MAPPED_PENDING_DISPOSITION | runtime/secret-scan/20260811T214249Z/observability.gitleaks.json |
| ROOT-E35C32BB5ED8BF06F364 | deliverables | DIRECTORY_OR_BUILD_CONTEXT | — | EXPORT, DEPLOYMENT | 0 | 0 | 0 | CLEAN | runtime/secret-scan/20260811T214249Z/deliverables.gitleaks.json |
| ROOT-F3A918E98D3E1BD24FF7 | apps/frontend/dist | DIRECTORY_OR_BUILD_CONTEXT | — | BUILD, FRONTEND_DOWNLOAD | 0 | 0 | 0 | CLEAN | runtime/secret-scan/20260811T214249Z/apps-frontend-dist.gitleaks.json |
| ROOT-E2669D9B08DA0746705D | apps/generated-site/dist | DIRECTORY_OR_BUILD_CONTEXT | — | BUILD, EXPORT | 0 | 0 | 0 | CLEAN | runtime/secret-scan/20260811T214249Z/apps-generated-site-dist.gitleaks.json |
| ART-79777335AD0ED354975C | observability/orchestrator-health/health-report.timeline.jsonl | REGULAR_FILE | 128127570 | RUNTIME | 0 | 0 | 0 | CLEAN | runtime/secret-scan/20260811T214249Z/artifact-coverage-08a1d-v12/large-79777335AD0ED354975C.gitleaks.json |
| ART-7B337A16E0C2E65D9103 | runtime/exports/generated-site-app.zip | ZIP | 308587 | RUNTIME, EXPORT, BACKUP | 0 | 0 | 0 | CLEAN | runtime/secret-scan/20260811T214249Z/artifact-coverage-08a1d-v12/archive-7B337A16E0C2E65D9103.gitleaks.json |
| ART-D2DE7F69ACB2FCFCD361 | runtime/projects/_exports/generated-site-app.zip | ZIP | 307156 | RUNTIME, EXPORT, BACKUP | 0 | 0 | 0 | CLEAN | runtime/secret-scan/20260811T214249Z/artifact-coverage-08a1d-v12/archive-D2DE7F69ACB2FCFCD361.gitleaks.json |
| ART-56449502166E5A1A8568 | runtime/projects/_exports/imported-smoke-app-app.zip | ZIP | 307338 | RUNTIME, EXPORT, BACKUP | 0 | 0 | 0 | CLEAN | runtime/secret-scan/20260811T214249Z/artifact-coverage-08a1d-v12/archive-56449502166E5A1A8568.gitleaks.json |
| ART-925AA18A9B8DB695D5D3 | runtime/staged-project-media/anonymous/media-reference-1785269531421-archive.zip | ZIP | 2885931 | RUNTIME, EXPORT, BACKUP | 2 | 1 | 0 | FINDINGS_MAPPED_PENDING_DISPOSITION | runtime/secret-scan/20260811T214249Z/artifact-coverage-08a1d-v12/archive-925AA18A9B8DB695D5D3.gitleaks.json |
| ART-A7DC4245920B994BF2CF | runtime/staged-project-media/anonymous/media-reference-1785363766182-archive.zip | ZIP | 2885931 | RUNTIME, EXPORT, BACKUP | 2 | 1 | 0 | FINDINGS_MAPPED_PENDING_DISPOSITION | runtime/secret-scan/20260811T214249Z/artifact-coverage-08a1d-v12/checksum-reuse-A7DC4245920B994BF2CF.gitleaks.json |
| ART-BCA6E8373F6A4FD7B6D5 | runtime/staged-project-media/anonymous/media-reference-1785364348251-archive.zip | ZIP | 2885931 | RUNTIME, EXPORT, BACKUP | 2 | 1 | 0 | FINDINGS_MAPPED_PENDING_DISPOSITION | runtime/secret-scan/20260811T214249Z/artifact-coverage-08a1d-v12/checksum-reuse-BCA6E8373F6A4FD7B6D5.gitleaks.json |
