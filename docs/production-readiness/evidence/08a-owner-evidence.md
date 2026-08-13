# 08A1A Apify owner-evidence record

Incident: `SEC-2026-08-10-APIFY-001`  
Evidence boundary: this record contains only approved aliases, locations, timestamps, and non-secret assertions. It contains no credential value, token fragment, replacement value, reversible representation, request header, authorization header, provider response body, or secret-bearing command output.

## Owner evidence status

The Apify owner-evidence record is complete and ready for subgate closure. It closes only `08A1A`; it does not close the incident, all credentials, `08A1`, or Step 08A.

## OWNER_ASSERTED

| Field | Owner-approved fact |
| --- | --- |
| Incident ID | `SEC-2026-08-10-APIFY-001` |
| Provider | Apify |
| Discovery date | `2026-08-10` |
| Credential purpose | Apify actor execution |
| Credential owner / authority | Jhilam Bera / Admin |
| Affected environment | Development only |
| Evidence owner and approver | Jhilam Bera (Admin) |
| Safe alias | `APIFY-DEV-PERSONAL-TOKEN-2026-08-11` |
| Complete credential values recorded in evidence | No |
| Rotation action | Regenerated/rotated in the Apify provider console |
| Action performed by | Jhilam Bera (Admin) |
| Entered rotation timestamp | `2026-08-11T10:41:00Z` |
| Timezone | UTC |
| Canonical rotation timestamp | `2026-08-11T10:41:00Z` |
| Replacement created | Yes |
| Old credential confirmed unusable | Yes — owner asserted |
| Invalidation verification method | Provider console |
| Invalidation verification result | Provider console confirms the old token is revoked/inactive and no 24-hour grace period remains |
| Invalidation verification timestamp | `2026-08-11T11:07:55Z` |
| Invalidation occurred after rotation | Yes |
| Sanitized image reference | `docs/production-readiness/evidence/apify-revocation-sanitized.png` |
| Image exists and is legible | Yes — owner asserted |
| Image contains no token value | Confirmed — owner asserted |
| Sanitized text record | `docs/production-readiness/evidence/apify-revocation-sanitized.md` |
| Replacement storage reference | Local gitignored `.env` — variable `APIFY_API_TOKEN` |
| Replacement stored in Git or documentation | No |
| Service restarted | Yes — owner asserted |
| Post-rotation Development health status | Passed — owner asserted |
| Health-check timestamp | `2026-08-11T11:08:55Z` |
| Health check occurred after rotation | Yes |
| Sanitized health record | `docs/production-readiness/evidence/apify-post-rotation-health-check.md` |
| Evidence confirms the replacement worked without exposing it | Yes — owner asserted |
| Canonical rotation timestamp confirmed | Yes |
| Old Apify token confirmed unusable | Yes — owner asserted |
| Development health check passed | Yes — owner asserted |
| No credential value appears in the evidence | Yes — owner asserted, subject to repository scanning |
| Information approved as accurate | Yes |
| Approved by | Jhilam Bera (Admin) |
| Approval timestamp | `2026-08-11T11:11:26Z` |

Required chronology: `2026-08-11T10:41:00Z < 2026-08-11T11:07:55Z < 2026-08-11T11:08:55Z < 2026-08-11T11:11:26Z`.

## REPOSITORY_VERIFIED

| Fact | Repository evidence |
| --- | --- |
| Local `.env` is ignored | `git check-ignore -v .env` identifies the `.gitignore` rule. The file contents were not opened. |
| Sanitized evidence records | The owner-evidence record, revocation Markdown record, and health-check Markdown record are present at their documented paths. |
| Revocation PNG metadata | `docs/production-readiness/evidence/apify-revocation-sanitized.png` is a 2876 × 1362 PNG with SHA-256 `686f64afd5851e5c7b6671cb484a06bd5e47e5cfe3c567bfad5c1b005bd4f00a`. |
| PNG content inspection | `IMAGE_INSPECTION_NOT_AVAILABLE`: local metadata inspection was available, but no local OCR or visual-content inspection was available for a safe independent assessment. The PNG is supplemental only. |
| Reconciliation scope | The immutable R2 inventory records 14,984 observations, 14,937 canonical occurrences, and 1,068 exact candidate-equivalence classes. R4 retains one deterministic Path A closure and 1,067 pending Path B classes. Scanner rule labels are not treated as provider, owner, validity, or Apify linkage. |

## PROVIDER_VERIFIED

None. The repository does not independently establish provider-console state, and this record does not use a live old-token test.

## Downstream scope carried forward

These non-Apify remediation items do not block `08A1A` and remain open for the next remediation subgate.

| Field | Status |
| --- | --- |
| Latest scanner observations | 14,984 |
| Latest logical items | 1,068 exact R2 candidate-equivalence classes |
| Remaining unresolved logical items | 1,067 R2 Path B classes; one deterministic, non-provider test fixture is closed by current R2 Path A evidence. |
| Authorized to review GCP, OpenAI, and unidentified findings | No |
| Assigned authorized owner | Not yet assigned |
| Authorized owner assignment completed | No |
| Owner-assignment evidence | Pending per-item assignment |
| Evidence-backed dispositions completed | Partially — one Path A repository-fact closure; no external owner/provider closure. |
| Additional carried-forward coverage | 08A1D artifact coverage is complete and remains independent; remote exact-commit CI evidence remains outside this owner-evidence subgate. |

## R4 linkage boundary

The 08A1A Apify record remains valid only at its documented `OWNER_ASSERTED` evidence level. It remains **unlinked to every current R2 logical item** because no exact safe R2 alias, project, account, or environment linkage is available. It is not provider-verified terminal evidence for any R4 Path B item.
