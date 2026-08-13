# 08A1D R4 mapping status

## Outcome

**FULL RERUN REQUIRED.** Every retained 08A1D artifact record was projected against current R2 IDs using safe structural location/rule/line correlation only. The old bounded artifact coverage cannot be claimed current because it predates R2 and has no R2-bound content-identity/configuration attestation.

- R2 run: `20260812T190840Z`
- Artifact records revalidated: 23
- Mapped pending disposition: 3
- Reconciled findings: 0
- No R2 logical findings: 15
- Unmapped R2 records: 5
- Unmapped R2 observations: 31
- Active stale predecessor IDs: 0

## Retention decision

The bounded artifact coverage predates the R2 inventory and lacks an R2-bound content-identity and scanner-configuration attestation; R4 may not claim that the old full scan remains current.

No retained record is marked `FINDINGS_RECONCILED` unless all of its mapped current R2 logical items are terminal. Current mapped plausible items remain `FINDINGS_MAPPED_PENDING_DISPOSITION`.
