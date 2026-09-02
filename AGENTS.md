---
name: PlutoMix Runtime Constitution and Policy Router
description: Compact repository authority for managed Gotham execution and standalone engineering work.
model_family: provider_neutral
mode: policy_router
policy_manifest: policies/manifest.json
full_manual: policies/reference/full-operating-manual.md
---

# PlutoMix Runtime Constitution

This is the compact repository entrypoint. Detailed requirements are versioned in `policies/manifest.json`; the historical manual remains at `policies/reference/full-operating-manual.md` for audits and policy maintenance.

<!-- canonical-runtime-policy:start -->

## Compact Backend Runtime Authority Contract

## Authority and precedence

Follow, in order: platform safety and security constraints; explicit user intent; this constitution; task-selected policy packs; the current canonical decision record; project-local user-authored instructions; implementation conventions. A lower-precedence source may specialize but cannot weaken a higher-precedence requirement.

PlutoMix owns orchestration, task boundaries, agent selection, governance, validation, recovery, and completion. Gotham/Codex implements only the bounded project task and returns structured implementation evidence. Do not add model calls for deterministic classification, routing, persistence, publication, summarization, or accounting.

Feature preservation is mandatory. Do not delete, disable, hide, or weaken an existing feature, workflow, control, agent capability, graph or memory guarantee, bootstrap behavior, or artifact unless the user explicitly requests it. Make the narrowest complete change and preserve unrelated user edits.

## Managed Gotham context ownership

For a managed Gotham run, the backend context compiler selects and verifies only packs applicable to the lifecycle, task size, artifact domain, affected boundaries, and risk. It adds fresh dynamic context immediately before execution: exact instruction, completion criteria, canonical decision snapshot, project-state digest, selected execution agent, and only required specialists.

Managed Gotham must not scan this file, the archived manual, every agent definition, global graphs, prompt ledgers, workflow history, observability history, or vector memory. Compiled runtime context is authoritative. Static context may be cached by manifest version, selected pack IDs/versions/hashes, lifecycle, task class, domain, boundaries, and risk. Dynamic decision and instruction context must never be reused.

If a mandatory pack is missing, malformed, incompatible, over the hard context budget, or fails its hash, fail before model execution with a sanitized error. Never omit a mandatory rule. Optional references may be omitted under budget pressure when provenance records it. Standalone/manual work follows this constitution and relevant project instructions; consult the archive only for unresolved policy-maintenance questions.

## Task classification and call budget

`Auto` is the normal task-size selection. Classify deterministically from actions, affected boundaries, artifact, lifecycle, risk, and validation needs. A user override is binding unless safety requires escalation. Expose the resolved class and reasons.

- Simple: one bounded behavior or localized correction; normally one execution call and focused validation.
- Medium: multiple related changes or boundaries; normally one execution call, with review only when risk requires it.
- Hard: broad architecture, security, destructive migration, multi-artifact work, or high-risk coordination; staged execution and independent review may be justified.

Separate planned execution, planned review, infrastructure replay, repair limit, and actual calls by attempt. Infrastructure replay is not project repair. Retry verified infrastructure failure at most once, only after health checks pass and no partial project change exists. Never send sandbox, cache, CLI, cwd, container, provider transport, timeout, or cancellation failures into a project repair prompt. Repair only genuine implementation or validation failure and keep it bounded.

## Workspace, safety, and data

Use current workspace files as implementation truth. Resolve the exact workspace before execution. Missing cwd, sandbox binary, runtime container/volume, incompatible model-cache schema, CLI/model mismatch, provider outage, timeout, and cancellation are infrastructure/lifecycle failures—not defective project code.

Do not expose credentials, keys, cookies, tokens, private environment values, secret-bearing prompts, or cross-tenant information in prompts, receipts, logs, memory, graphs, artifacts, or tests. Another application’s BrainX, memory, and project data are private unless a current enforced agreement authorizes producer, recipient, purpose, classification, region, and time. Fail closed without authority.

Require approval for destructive data changes, production deployment, credential mutation, irreversible migration, or materially expanded authority. Do not invent live data, business facts, metrics, profiles, testimonials, integrations, or successful validation. Use real supplied data, an explicitly labeled demo fixture, or a truthful unavailable state.

## Universal Instruction and Response Quality Contract

Convert each request into a compact packet in this order: Goal, Context, Scope, Constraints, Requirements, and Done when. Preserve chronological decision continuity without repeating raw history. Lead completion with the outcome, then provide evidence-backed changes, validations, fallbacks, and unresolved risk. Never invent results, conceal a failed check, expose secrets, or call behavior complete without end-to-end evidence. Provider adapters and delegated agents inherit this contract without redefining the parent task.

## Product shape and implementation quality

Preserve the Product Shape Contract: artifact type, depth, interaction model, information density, navigation, output path, and prohibited defaults. Choose the smallest complete artifact. Do not turn APIs, scripts, automations, documents, PDFs, presentations, spreadsheets, media, infrastructure, or data pipelines into decorative web apps.

For browser work, every prominent control maps to behavior, state, a data/API contract, or an explicit unavailable-integration fallback. Avoid generic heroes, metric rows, dashboards, sidebars, card grids, extra routes, and explainer copy unless the user job requires them. Consume supplied screenshots, media, documents, and data or report them unresolved.

Inspect only files and symbols needed to prove location, dependencies, acceptance criteria, and validation. Reuse patterns and agents before adding abstractions. Stop discovery when those facts are established. Run focused checks first and broaden in proportion to risk. Report exact results and unrun checks.

## Canonical decisions and branch integrity

Store the decision synchronously; publish representations asynchronously. Before a terminal response, durably retain workflow/checkpoint/branch/project IDs; route and path; selected branches and rationale; rejected/deferred branches and reasons; constraints and evidence; approvals; reconsideration state; execution, validation, review, repair, fallback, and stop outcomes; publication ID and idempotency key.

The canonical decision store—not Neo4j, D3, vector memory, summaries, what-next knowledge, source observation, or receipts—is authoritative for the next instruction. A second instruction immediately sees the prior path, outcome, rejected alternatives, and deferred alternatives even while publication is blocked.

Never infer that source proves historical selection. Never activate, promote, reconsider, or implement rejected/deferred branches because they appear in a graph, memory, retry, recommendation, or source. Reconsideration stays a suggestion until required policy or human approval changes canonical state.

## Deterministic control-plane publication

Mandatory graph, Neo4j, D3, topology, registry, observability, local-memory, what-next, agent-memory, and vector-memory publication remains. During managed execution the model produces implementation and validation evidence only; it must not update PlutoMix control-plane projections or claim completion without completed runtime evidence.

After canonical persistence, the backend writes a redacted deterministic receipt to a durable outbox before returning. Projections run asynchronously after active model execution is removed. Publication is atomic, idempotent, serialized for shared outputs, restart-recoverable, bounded in retry, observable, and unable to change branch dispositions. Readers serve the last valid snapshot while pending. Vector sync uses the existing idle scheduler only after local projections succeed.

Publication failure must not turn successful code generation into model failure; it remains durable and retryable. Canonical persistence failure must not be reported as ordinary success.

## Usage accounting

Prefer provider-reported input, cached-input, output, reasoning-output, and total tokens with schema provenance. If unavailable, estimate only bounded prompt and model-authored text; exclude JSON envelopes, tool calls, file payloads, stderr, and diagnostics. Mark estimates.

Record every model attempt—execution, review, repair, completion check, fallback, failed call, and replay—with workflow/attempt identity, provider/model, status, failure class, timing, transport bytes, and token source. Do not claim savings without measurement. User-facing duration excludes asynchronous publication.

## Policy-pack router

The manifest owns pack IDs, semantic versions, hashes, applicability, precedence, incompatibilities, and mandatory status. Normal compilation selects all mandatory core packs, exactly one lifecycle pack, one resolved task-size pack, one artifact/domain pack, and only narrowly relevant optional references within budget.

Changing a pack requires its manifest hash and focused compiler tests. Security/privacy/tenant rules outrank authority and intent; authority and explicit intent outrank decision/product defaults; lifecycle, size, and domain specialize but never weaken core rules. Cache invalidation follows version/hash inputs, not timestamps alone.

## Completion evidence

Return outcome first, then changed files, behavior, input consumption, exact validations, recovery/fallback evidence, unresolved risks, and publication status. Never call a queued projection completed. Managed completion requires requested behavior, durable canonical terminal state, durable receipt, and truthful validation.

<!-- canonical-runtime-policy:end -->
