---
description: Implement PlutoniX enterprise decision continuity, BrainX, Qagents, governed evolution, and constraint-triggered branch reactivation
---

# PlutoniX Enterprise Evolution — Master Implementation Instruction

You are the principal architect and implementation engineer for **PlutoniX**. Work inside the currently opened PlutoniX repository. This is an implementation task, not a brainstorming exercise.

The intended runtime is **Codex with `gpt-5.6-terra` and `xhigh` reasoning**. Do not spend output claiming that you changed the runtime model; simply execute with the model selected by the operator.

## Outcome

Evolve the existing PlutoniX codebase into a vendor-neutral enterprise control plane for governed agent evolution and constraint-aware decision continuity.

The defining behavior is:

> PlutoniX preserves materially distinct decision branches, the evidence and constraints that shaped them, and the reason each branch was selected, deferred, rejected, or superseded. When a relevant constraint, resource, policy, dependency, cost, or item of evidence changes, PlutoniX can safely reconsider the affected branches, re-evaluate them using current evidence, and propose promotion only through deterministic validation, policy checks, human approval, canary execution, monitoring, and rollback.

Implement this as one coherent system. Qagents, PlutoniX-BrainX, Intel nodes, Suggested Next Instruction, model routing, prompt similarity, agent scores, and neuroevolution must use the same branch, evidence, evaluation, governance, and audit foundations. Do not create disconnected demonstrations with separate truths.

## Execution contract

- Read and obey every applicable `AGENTS.md`, repository policy, architecture document, and existing provider-specific instruction before editing.
- Do not replace, truncate, or broadly rewrite existing `AGENTS.md` or provider prompt files. Change them only if the repository explicitly requires a narrow reference update, and preserve all existing capabilities.
- Inspect the repository before choosing technologies, paths, services, schemas, or commands. Reuse the current stack, naming conventions, persistence layer, event system, test framework, UI system, and deployment approach where they are sound.
- Preserve backward compatibility unless a documented migration is necessary. Use additive migrations, adapters, and feature flags for risky behavior.
- Do not stop after producing a plan. After discovery, implement the highest-priority incomplete vertical slice and continue through the phases that can be completed safely in the available environment.
- Prefer a finished, tested vertical slice over many empty interfaces. Do not claim a capability exists when it is only a schema, route stub, mock, static screen, or TODO.
- Never fabricate benchmark results, model availability, GPU execution, enterprise controls, integrations, or successful validation. Clearly distinguish implemented, simulated, configured, and blocked behavior.
- Treat all model output as untrusted input. A model may propose, investigate, summarize, or generate candidates; it must not be the sole authority for policy, security, approval, or production promotion.
- Run safe local reads, edits, migrations in test environments, and non-destructive validation without asking. Stop before destructive operations, external writes, production deployment, paid compute, credential changes, or material scope expansion.
- If the repository has unrelated user changes, preserve them and work around them.

## Product boundary

Build PlutoniX first for enterprise AI platform, software-engineering, and R&D teams managing multiple agents, models, prompts, tools, repositories, and environments.

The first-class workflow is:

> Propose → preserve alternatives → investigate uncertainty → compare → validate → approve → canary → deploy → monitor → record outcomes → reconsider when conditions change.

Do not turn this implementation into a generic executive, supply-chain, financial, or business decision platform. Do not lead with autonomous app generation. Do not expose unrestricted “self-improvement.” The enterprise promise is **governed continuous optimization with complete decision provenance**.

## Phase 0 — Repository discovery and gap map

Before editing, inspect at minimum:

- application and service boundaries;
- current Qagent, BrainX, Intel, next-instruction, agent-registry, scoring, vector, graph, orchestration, and runtime implementations;
- database schemas, migrations, queues/events, caches, object storage, Neo4j or other graph usage, and vector-store usage;
- API and frontend conventions;
- authentication, tenants/workspaces, authorization, secrets, audit, and deployment configuration;
- provider adapters for OpenAI, Claude, Hugging Face, local models, and any other existing providers;
- tests, fixtures, CI, observability, feature flags, and failure-handling conventions;
- existing instruction versioning, correction history, reuse decisions, token accounting, model-call ceilings, and Qagent loop limits.

Create or update a concise repository-owned implementation document under the existing documentation convention. It must contain:

1. current capabilities with file-level evidence;
2. gaps against this instruction;
3. the target component and data-flow map;
4. the ordered migration plan;
5. risks, compatibility constraints, and decisions that genuinely require the owner;
6. an acceptance checklist whose items can be tied to tests or observable behavior.

Do not ask questions that repository inspection can answer. If an ambiguity does not block a safe reversible choice, record the assumption and proceed. Ask only when different answers would materially change data ownership, security, destructive migration, external cost, or the public contract.

## Architecture invariants

### One system of record

- Use a durable transactional store and append-only domain events as the authoritative decision record.
- A graph database is a query and visualization projection, not the only source of truth.
- A vector database is a similarity and retrieval index, not the source of truth for identity, status, authorization, evidence, constraints, or history.
- Object storage may hold large immutable artifacts, with content hashes and references in the authoritative ledger.
- Derived graph, search, vector, score, and Pareto/QD views must be rebuildable from authoritative records and events.

### Tenant safety

Every persisted entity, event, cache key, vector namespace, graph node/edge, job, metric, and artifact reference must be tenant/workspace scoped. Authorization must be enforced server-side. Never rely on a UI filter for isolation.

### Immutability with compliant deletion

“Never discard a branch” means preserve the branch semantically and historically while its retention policy permits it. It does not override legal deletion, customer retention, data-residency, or right-to-erasure obligations.

- Do not overwrite historical branch content, evidence, decisions, constraints, scores, or approvals.
- Record revisions and status transitions as new versions/events.
- Use tombstones, cryptographic erasure, or the repository’s compliant deletion mechanism when retention policy requires removal.
- Preserve non-sensitive audit metadata only where policy permits.

### Safe execution

- No generated instruction, capability node, prompt, tool, model, or branch may grant itself permission.
- No Qagent, BrainX model, or originating agent may be the sole verifier of its own proposal.
- Prefer deterministic validators before model-based graders.
- All promotion paths require explicit policy evaluation; production-impacting paths require human approval unless an administrator has configured a narrow, auditable low-risk exception.
- All side-effecting operations require idempotency, concurrency protection, retry limits, and auditable outcomes.

## Capability 1 — Immutable Branch Ledger and Decision Continuity Graph (P0)

Implement a canonical branch model that preserves materially distinct options and their lineage. Adapt names to the repository, but preserve these semantics.

Each branch must be able to represent:

- stable branch ID, tenant/workspace, objective/decision ID, root lineage ID, parent branch ID, and child lineage;
- branch kind, lifecycle status, origin, creation time, revision, and content/artifact hash;
- structured objective and decision signature;
- candidate implementation, plan, instruction, model/tool configuration, or artifact reference;
- producing agent, model/provider, model revision, prompt/instruction version, tool versions, code revision, and environment;
- evidence references with source, provenance, observation time, freshness/expiry, confidence, and access policy;
- assumptions and unresolved uncertainties;
- the complete constraint expression and the constraint snapshot used at decision time;
- fitness vector, evaluation runs, validator results, policy results, approvals, and decision rationale;
- expected outcome, actual outcome, business impact, correction effort, cost, latency, regressions, and rollback data;
- why it was selected, deferred, rejected, superseded, archived, reactivated, or retired;
- revisit triggers and whether automatic reconsideration is permitted.

At minimum, distinguish these meanings:

- **active/candidate**: currently being investigated or evaluated;
- **selected**: chosen for the current context, not declared universally optimal;
- **deferred**: potentially valid but blocked by one or more constraints; must retain revisit criteria;
- **rejected**: presently invalid, unsafe, non-compliant, or disproven; retained for provenance but not automatically revived unless authorized evidence or policy conditions change;
- **superseded**: replaced in the active view while retained historically;
- **reactivated/reconsidering**: reopened because a relevant condition changed;
- **retired/archived**: inactive under policy, still queryable while retention allows.

Do not collapse branch quality into one score. Implement a versioned fitness vector that can include:

- task quality and acceptance;
- monetary and compute cost;
- latency and throughput;
- reliability and regression risk;
- security and privacy risk;
- compliance and licence compatibility;
- required people, hardware, data, and dependencies;
- reversibility and rollback cost;
- evidence freshness and uncertainty;
- expected and realized business impact.

Document normalization, directionality, missing-value handling, and evaluator version. A scalar ranking may be a derived view, but the vector and its provenance remain available.

### Decision signatures and diversity

Implement separate, inspectable signals for:

1. lexical similarity;
2. semantic similarity;
3. structural or implementation similarity;
4. behavioral diversity under evaluation;
5. outcome diversity and trade-off position.

Textual prompt novelty alone is not valuable. A differently worded branch that behaves the same should be recognized as near-duplicate. A textually similar branch that produces a materially different behavior or trade-off must remain distinguishable.

Use explicit similarity thresholds, evaluator versions, and explanations. Do not silently delete duplicates; link them with duplicate/derived/equivalent relations and retain provenance.

### Graph projection and UI

Project the ledger into the existing graph layer and frontend. The operator must be able to:

- inspect branch lineage and status;
- see why a branch was deferred or rejected;
- compare constraints, evidence, fitness dimensions, and implementation differences;
- see the exact event that triggered reconsideration;
- view evidence and decisions as they existed at a historical point;
- distinguish authoritative data from derived scores and model-generated explanations;
- navigate from a suggested instruction or capability proposal to its evidence, affected branches, approvals, executions, and outcomes.

## Capability 2 — Declarative Constraint Engine and Branch Reactivation (P0)

Represent constraints as safe declarative data, never arbitrary code or `eval`. Support leaf predicates and compound expressions such as `all`, `any`, and `not`.

A constraint must include:

- stable ID and version;
- type and scope;
- field/metric/resource being evaluated;
- operator and expected condition;
- observed value and evidence source;
- state such as active, cleared, unknown, stale, expired, or invalid;
- observation and expiry times;
- confidence or reliability where applicable;
- responsible owner or integration;
- sensitivity and access policy.

Unknown, stale, missing, or failed-to-fetch evidence must not be interpreted as a cleared constraint.

Implement a reactivation engine that:

1. consumes trusted condition/resource/evidence/policy events;
2. identifies affected deferred or eligible rejected branches through indexed triggers;
3. recomputes the constraint expression with current, authorized evidence;
4. creates an idempotent reconsideration request instead of directly promoting the branch;
5. re-runs required evaluations using current model, policy, environment, and dependency versions;
6. records why reconsideration was or was not started;
7. routes successful candidates into the governed promotion lifecycle;
8. preserves failures and updated blockers without losing earlier history.

Add deduplication, debouncing, cooldowns, per-tenant budgets, loop detection, optimistic concurrency, and dead-letter/recovery behavior. Replaying the same event must not create duplicate evaluations or promotions.

Examples the implementation and tests must support:

- a branch deferred for insufficient GPU capacity becomes eligible when approved capacity increases;
- a cost-blocked branch is reconsidered after a verified price decrease;
- one resource blocker clears but a security blocker remains, so the branch stays deferred;
- new evidence invalidates an earlier rejected assumption, but policy requires a human to authorize reconsideration;
- an event contains stale or unauthorized evidence and does not reactivate anything;
- the same event arrives twice and produces one reconsideration workflow;
- a previously selected branch remains selected because the reopened alternative fails current validation.

## Capability 3 — Independent Evaluation and Governed Self-Improvement (P0)

Implement the complete change-control lifecycle for agents, prompts, instructions, models, tools, routes, and capabilities:

> proposal → isolated branch → benchmark → deterministic validation → independent evaluation → security/policy review → approval → canary → promotion → monitoring → outcome capture → rollback or retention

Required behavior:

- version every agent, prompt, instruction, model configuration, tool contract, evaluator, policy, dataset, and threshold used in a decision;
- use representative evaluation suites and protected holdouts where appropriate;
- keep the proposer separate from the final evaluator and approval authority;
- prevent evaluation contamination and record dataset versions;
- compare against the current production baseline and relevant alternatives, not only against an absolute threshold;
- capture quality, cost, latency, correction effort, regressions, security results, and confidence intervals when sample size permits;
- require canary limits, success/failure thresholds, monitoring windows, and a tested rollback path;
- automatically stop or roll back on configured severe regressions without allowing a model to override policy;
- record expected versus actual outcomes and use actual outcomes for future routing and scores;
- make all policies, overrides, approvals, and emergency actions auditable.

Self-improvement must create a proposed new version. It must never silently mutate the current production prompt, agent, model, tool, policy, evaluator, or instruction.

Retain and integrate existing `capabilityScore`, `deliverableAccuracyScore`, `reliabilityScore`, proficiency, correction history, reuse decisions, instruction versions, score events, token usage, and upgrade history. Clarify definitions and prevent circular scoring. Scores are derived evidence, not authorization.

## Capability 4 — Qagents as Bounded Evidence and Experiment Planners (P1)

Upgrade Qagents from generic follow-up-question generators into branch-aware uncertainty reducers.

The role of a Qagent is:

> Detect material uncertainty, choose the most useful next question or bounded experiment, collect or request evidence, and record whether that evidence changed a branch evaluation. A Qagent is not the judge and cannot approve its own recommendation.

For each Qagent action, persist at minimum:

- run ID, tenant, objective, affected branch IDs, and triggering evaluation;
- uncertainty or evidence gap being addressed;
- question, hypothesis, or experiment;
- why it is relevant to each affected branch;
- expected information gain or an explicitly documented calibrated proxy;
- requested evidence, source, tool, owner, and freshness requirement;
- estimated cost, latency, risk, and token/model-call budget;
- semantic/behavioral deduplication fingerprint;
- stop condition and maximum iterations;
- answer/evidence received with provenance;
- resulting change in uncertainty, fitness vector, ranking, or status;
- whether the question materially changed the decision and how that attribution was determined.

Qagent policy:

- generate different investigations for materially different branches;
- prioritize high-value uncertainty whose resolution could change the decision;
- deduplicate semantically equivalent questions;
- stop when evidence is sufficient, expected information gain is too low, the budget is exhausted, the answer is unavailable, or policy forbids further investigation;
- cap time, tokens, model calls, tool calls, recursion, and fan-out;
- never ask another Qagent merely to continue a loop without a new evidence gap;
- expose uncertainty and abstain rather than converting missing evidence into confidence;
- send conclusions to independent evaluators and deterministic validators.

Build an evaluation harness comparing at least:

- current single-agent baseline;
- single-agent reflection;
- best-of-N where applicable;
- Qagent-assisted workflow.

Measure accepted-task or accepted-decision improvement, human correction reduction, latency, total cost, model/tool calls, regression rate, and cost per accepted improvement. Qagents are successful only when their incremental value justifies their incremental cost.

## Capability 5 — Intel Nodes and Suggested Next Instruction (P1)

### Intel capability-gap nodes

Intel may propose a new functionality node only from grounded evidence such as repeated failures, blocked tasks, observed customer demand, policy changes, missing integration coverage, or a measurable performance gap.

Every capability proposal must include:

- the observed gap and supporting evidence;
- affected customers, tasks, branches, agents, or workflows;
- frequency and severity;
- expected business and engineering value;
- required dependencies, data, models, tools, permissions, and infrastructure;
- security, privacy, compliance, licence, operational, and vendor risks;
- estimated implementation and operating cost;
- acceptance tests and success metrics;
- rollout, approval, monitoring, and rollback requirements;
- duplicate/similar existing capabilities and the reuse-versus-create decision.

Intel must search the existing local registry, structured records, graph, and authorized vector index before proposing a new node. Reuse or upgrade a suitable capability. Do not create capability sprawl from model imagination.

An Intel proposal cannot install, activate, grant permissions to, or deploy itself. It enters the same governed lifecycle as any other change.

### Suggested Next Instruction

Make Suggested Next Instruction the human control surface for evidence-backed action, not a generic continuation sentence.

Each suggestion must identify:

- the exact objective and branch/capability/change it affects;
- the event, evidence, or cleared constraint that caused the suggestion;
- what changed since the last decision;
- remaining blockers and required approvals;
- expected benefit, cost, risk, and reversibility;
- the proposed bounded action and success condition;
- evidence and audit links;
- expiry/freshness and deduplication key;
- whether the suggestion is informational, ready for approval, or executable after approval.

Good behavior: “Re-evaluate branch B17 because approved GPU capacity increased and its infrastructure blocker is cleared. Expected inference-cost improvement: measured estimate from evaluation E42. Security review remains required.”

Bad behavior: “Consider adding another evaluation agent.”

Suggested instructions must be editable, reviewable, and rejectable. They must not execute merely because a user viewed them.

## Capability 6 — PlutoniX-BrainX Model Portfolio (P1)

Implement BrainX as the experimental intelligence and model-portfolio layer behind the governed control plane.

Support a small initial portfolio—normally three to five models or model roles—well before expanding breadth. Discover the existing provider architecture and implement adapters rather than hard-coding a single provider.

The model registry must capture:

- provider, model ID, immutable revision/commit/digest, task role, tokenizer, quantization, and runtime;
- licence, acceptable-use restrictions, commercial-use status, attribution, and data-governance constraints;
- required hardware, memory, storage, expected throughput, latency, and operating cost;
- local/private/remote execution mode and data-sensitivity eligibility;
- context limits and supported inputs/outputs;
- evaluation results by task, tenant policy, agent, prompt, and instruction version;
- known failure modes, calibration limits, and operational health;
- artifact integrity/checksum and supply-chain provenance.

BrainX may provide specialized roles such as candidate generation, embeddings, semantic similarity, reranking, classification, critique, test generation, or research. Route by measured task outcomes, policy eligibility, data sensitivity, cost, latency, health, and hardware availability—not by provider preference or a universal static ranking.

Requirements:

- separate model selection from model execution;
- make routing decisions reproducible and explainable from versioned evidence;
- provide deterministic fallback behavior and explicit failure when no eligible model exists;
- enforce per-tenant budgets and model-call ceilings;
- capture token/compute usage, latency, queue time, failures, and accepted outcomes;
- never let a generating model be its only grader;
- keep model-specific soft prompts, adapters, and embeddings explicitly versioned and non-portable unless compatibility is proven;
- support private/local deployment patterns without claiming enterprise privacy solely because a model is open source.

Do not download large models, allocate paid GPU resources, or launch external jobs without explicit authorization. When the local environment lacks suitable hardware, implement and test the provider contract, metadata, policy routing, deterministic fixtures, and feature flags; report real execution as blocked rather than faking it.

## Capability 7 — Selective Quality-Diversity and Neuroevolution (P2)

Add a pluggable, feature-flagged research subsystem inspired by **Parameter-Efficient Neuroevolution for Diverse LLM Generation** (arXiv:2605.09781). It must not be the default path for routine requests.

Use it only for high-value tasks where a repertoire of genuinely different high-quality solutions is useful, such as architecture alternatives, migration strategies, security hypotheses, incident hypotheses, test/edge-case generation, synthetic R&D data, or agent/prompt variants.

Keep two layers strictly separate:

1. **Immutable Branch Ledger** — authoritative history of every materially distinct candidate, lineage, evidence, constraints, evaluations, and disposition.
2. **Active QD/Pareto View** — a replaceable working view of currently useful candidates across behavior and fitness regions.

If a QD cell replaces an incumbent, the prior branch remains in the ledger. Never use archive replacement as historical deletion.

Required design points:

- version behavior descriptors, feature extraction, distance metrics, fitness evaluators, mutation operators, seeds, budgets, and archive rules;
- preserve parentage from base instruction through mutations and evaluations;
- use behavioral and outcome diversity, not prompt wording alone;
- support multi-objective/Pareto analysis rather than a single universal fitness score;
- enforce strict compute, token, time, and population budgets;
- allow pause/resume and reproducible experiment manifests;
- keep generated candidates isolated from production;
- require the same independent evaluation, policy, approval, canary, and rollback lifecycle before promotion;
- compare QD/neuroevolution against simpler baselines to prove that additional compute has value;
- expose feature flags and kill switches.

Do not overclaim the paper’s benchmark results as evidence for PlutoniX or enterprise long-horizon decisions. Treat the method as an R&D engine to validate empirically on representative PlutoniX tasks.

## Capability 8 — Enterprise controls and threat model (P0, cross-cutting)

Implement or harden enterprise foundations in the same increments as the features above:

- OIDC/SAML-compatible identity architecture where appropriate to the stack;
- tenant/workspace isolation;
- server-enforced RBAC and, where necessary, policy/attribute-based controls;
- service identities for agents and jobs;
- least-privilege tool and model permissions;
- secrets-manager integration boundaries; no secrets in prompts, logs, events, graphs, vectors, fixtures, or client bundles;
- encryption in transit and at rest through the deployment architecture;
- immutable or tamper-evident audit events with actor, action, target, reason, policy, request/correlation ID, time, and outcome;
- configurable retention, deletion, data residency, export, and legal hold boundaries;
- private deployment and network-egress controls where supported;
- quotas, rate limits, cost budgets, timeouts, circuit breakers, and kill switches;
- model, dataset, prompt, tool, and dependency supply-chain provenance;
- licence policy enforcement for Hugging Face and other third-party artifacts;
- structured observability without sensitive prompt/evidence leakage;
- backup, restore, migration, disaster-recovery, and projection-rebuild procedures.

Threat-model at least:

- cross-tenant access and confused-deputy failures;
- prompt injection and malicious retrieved evidence;
- tool escalation and self-granted permissions;
- poisoned models, adapters, datasets, or vector content;
- untrusted model output reaching code, shell, SQL, policies, or production;
- score/evaluation gaming and proposer-as-judge bias;
- stale evidence, replayed triggers, race conditions, and duplicate promotion;
- secrets or personal data entering prompts, telemetry, graphs, or model-training data;
- insecure model licences or unapproved data transfer;
- runaway Qagent, Intel, reactivation, or neuroevolution loops.

Where a full enterprise integration depends on unavailable infrastructure, implement a secure interface and denial-by-default behavior, document the integration requirement, and do not label it production-ready.

## Capability 9 — APIs, operator experience, and observability

Use existing API and UI conventions. Provide typed contracts for:

- objectives/decisions and branches;
- lineage, evidence, assumptions, constraints, and triggers;
- branch comparison and historical views;
- reconsideration requests and reactivation events;
- Qagent investigations and evidence outcomes;
- Intel capability proposals and reuse decisions;
- Suggested Next Instructions and their review state;
- BrainX model registry, routing decisions, health, and task-level evaluation;
- evaluation runs, policies, approvals, canaries, promotions, monitoring, outcomes, and rollback;
- usage, budgets, costs, metrics, audit, and projection health.

Use pagination, filtering, stable identifiers, optimistic concurrency, idempotency keys, error schemas, and authorization checks. Generate or update OpenAPI/schema documentation if the project supports it.

The operator experience must clearly separate:

- facts and retrieved evidence;
- model-generated hypotheses and explanations;
- deterministic validator results;
- policy decisions;
- human approvals;
- current state versus historical state;
- authoritative records versus projections;
- implemented capability versus planned or unavailable integration.

Add observability for request/correlation IDs, branch and evaluation IDs, state transitions, model/tool usage, queue latency, retries, budgets, policy denials, canary results, rollback, projection lag, and failed reactivation. Logs must be useful without exposing sensitive content.

## Required metrics

Instrument and document definitions for:

- accepted improvement rate;
- cost per accepted improvement or decision;
- human correction effort and reduction over repeated use;
- time from proposal to approved deployment;
- agent/branch reuse rate;
- deferred-branch reactivation precision;
- false or wasteful reconsideration rate;
- value recovered from previously deferred branches;
- regression, canary failure, and rollback rates;
- provenance completeness;
- Qagent incremental quality versus incremental compute/cost;
- branch semantic and behavioral diversity;
- duplicate-branch and duplicate-question rates;
- routing performance by model, task, agent, prompt, and policy;
- budget overruns, blocked executions, and policy denials.

Do not invent business value. Support explicit value estimates with provenance and distinguish estimated from realized outcomes.

## Delivery order

Implement in this order unless repository evidence shows a dependency requires a small adjustment:

1. repository gap map and architecture decisions;
2. tenant-scoped immutable Branch Ledger and domain events;
3. Decision Continuity Graph projection and branch comparison;
4. declarative constraints and idempotent reactivation;
5. independent evaluation and governed promotion/rollback lifecycle;
6. enterprise authorization, audit, policy, budgets, and threat-model controls for the completed slice;
7. Qagents as bounded experiment planners;
8. Intel capability proposals and evidence-backed Suggested Next Instruction;
9. BrainX model registry, policy routing, Hugging Face adapters, and model evaluation;
10. selective QD/neuroevolution behind a feature flag;
11. operator UI, metrics, runbooks, projection rebuilds, and enterprise hardening across all completed capabilities.

For each stage, complete persistence, service logic, authorization, API, minimal operator visibility, telemetry, tests, migration/rollback, and documentation before calling the stage implemented.

## Minimum validation scenarios

Add unit, integration, migration, authorization, and end-to-end tests appropriate to the repository. Include these behaviors where applicable:

1. Create two materially distinct child branches and preserve lineage and provenance.
2. Mark one branch deferred by a compound constraint and retain the selected alternative.
3. Clear only one leaf constraint and prove no reconsideration starts while another blocker remains.
4. Clear the full constraint with fresh authorized evidence and create exactly one reconsideration request.
5. Replay the triggering event and prove idempotency.
6. Re-evaluate against the current baseline; fail validation and retain both the failure and prior selection.
7. Pass evaluation, require approval, run a bounded canary, promote, then record the actual outcome.
8. Trigger a regression and prove rollback and audit behavior.
9. Deny cross-tenant branch, evidence, vector, graph, job, and artifact access.
10. Prove a stale, unknown, or unauthorized constraint observation cannot clear a blocker.
11. Prove Qagent semantic deduplication, iteration limits, budget limits, and no self-approval.
12. Record whether Qagent evidence changed the decision and compare with the baseline.
13. Prevent an Intel proposal or Suggested Next Instruction from executing without approval.
14. Route BrainX only to models eligible for the tenant’s data, licence, budget, hardware, and task policy.
15. Fail safely when no model is eligible or a model/provider is unhealthy.
16. Replace an active QD/Pareto cell while preserving the displaced branch in the immutable ledger.
17. Rebuild graph/vector/score projections from authoritative records and compare integrity.
18. Apply retention/deletion policy without silently leaving forbidden content in logs, graphs, vectors, caches, or artifacts.

Use deterministic fixtures for routine CI. Keep live-provider and GPU tests opt-in, separately labelled, budget-capped, and non-blocking unless the deployment environment explicitly requires them.

## Completion bar

Before finishing:

- run the most relevant tests, type checks, lint, build, migration checks, security checks, and a minimal smoke test available;
- inspect the diff for accidental deletions, unrelated changes, unsafe defaults, secrets, dead code, and compatibility regressions;
- verify denial-by-default paths, idempotency, tenant isolation, audit coverage, feature flags, and rollback behavior;
- update architecture, API/schema, operator, deployment, and recovery documentation;
- include configuration examples without real credentials;
- leave explicit tracked gaps for infrastructure-dependent enterprise features and do not describe them as complete.

Return a concise implementation report containing:

1. current-state findings;
2. completed capabilities mapped to this instruction;
3. migrations, configuration, and feature flags;
4. tests and validation actually run, with results;
5. security and enterprise controls completed;
6. benchmark or metric evidence actually measured;
7. remaining gaps, risks, blockers, and the next highest-value implementation slice.

The task is complete only when the implemented slice demonstrates the core invariant end to end:

> A materially distinct branch can be preserved with its reasons and blockers, reconsidered exactly when trusted current conditions justify it, independently evaluated, governed through approval and canary controls, and either promoted or retained without losing history.
