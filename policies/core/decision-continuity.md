# Decision Continuity

- Canonical workflow, checkpoint, path, branch, approval, reconsideration, and terminal outcome records are authoritative.
- Read a fresh canonical decision snapshot for every instruction. Never cache decisions, branch dispositions, approvals, user instructions, or project-state digests as static policy.
- Preserve `selected`, `rejected`, and `deferred` dispositions exactly, with rationale and evidence references.
- Source-observed implementation proves only what exists; it does not prove a branch was historically selected.
- Graphs, D3, vector memory, summaries, receipts, and observability are derived projections and never activate a branch.
- Rejected or deferred work requires a governed reconsideration and, when required, human-approved activation before implementation.
- Store decisions synchronously; publish their representations asynchronously.
