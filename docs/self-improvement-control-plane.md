# Self-Improvement Control Plane

PlutoniX includes a safe self-improvement control plane for platform-level improvement work. It is additive to Gotham project generation and does not replace the generated-project registry, project-local orchestrators, QAgentic support, vector memory, Neo4j/D3 visualization, hosting, auth, runtime logs, or existing provider-neutral Codex/Claude execution paths.

## Safety Model

The control loop is:

```text
Observe -> Detect -> Diagnose -> Propose -> Isolate -> Validate -> Review -> Stage -> Monitor -> Roll back
```

The running platform is not rewritten directly from a log entry or a model response. Signals are normalized, grouped into patterns, converted into bounded evidence packages, and then turned into `ImprovementProposal` records. In the default `sandbox` mode, proposals may create isolated candidate metadata under `runtime/self-improvement/candidates`, but they do not mutate live source or deploy externally.

Every autonomous improvement must preserve the baseline feature inventory at `runtime/self-improvement/baselines/feature-inventory.json`. Feature removal is blocked unless compatibility, tests, replacement behavior, reviewer approval, and rollback proof are recorded.

## Runtime Components

- Improvement Observer: reads bounded runtime events, instruction timeline rows, token economy summaries, orchestrator health reports, and Gotham system-target instructions. It emits normalized `ImprovementSignal` events and treats log text as untrusted input.
- Investigator Agent: receives every logged runtime event asynchronously, checks key quality and efficiency parameters, records a bounded investigation decision, and sends a problem statement to the orchestrator only when evidence, repetition, severity, confidence, or random-audit policy justifies it.
- Signal Aggregator: groups related signals by kind, component, fingerprint, severity, and time window. It suppresses duplicate triggers during cooldown windows.
- Trigger Engine: creates threshold, severity, manual, and Gotham system-target triggers with evidence refs, severity, confidence, impact, and investigation cost.
- Evidence Builder: creates bounded, redacted evidence packages with relevant feature, API, instruction, metric, security, and cost context.
- Analyst: currently uses a safe rule-based structured analysis path. Model-call routing is explicitly gated behind configuration and must produce structured JSON before it can be used.
- Planner: creates validated `ImprovementProposal` records and rejects speculative, untestable, duplicate, or unsafe proposals.
- Candidate Worker: creates isolated candidate workspaces and rollback artifacts without mutating live source.
- Validation and Review: verifies candidate isolation, rollback readiness, test-plan presence, feature-inventory preservation, and independent reviewer separation.
- Promotion Controller: deterministic policy gate. `sandbox` stages only; `controlled_auto` can promote low-risk approved candidates; `advanced_auto` can promote up to the configured max risk. High-risk changes stay staged unless a stronger explicit policy exists.
- Rollback Controller: records rollback events and blocks unchanged retries when post-promotion metrics regress.
- Improvement Memory: stores investigator decisions, research usage logs, signals, patterns, triggers, evidence, analyses, proposals, candidates, validations, reviews, promotions, rollbacks, dead letters, and latest status in deterministic JSONL/JSON files under `runtime/self-improvement` and `observability/self-improvement`.
- Instruction Change Guard: produces semantic diffs, version refs, capability additions/removals, deletion checks, reviewer decisions, and rollback refs before any instruction file can be changed.
- Research Agents: optional competitive-tool, research-paper, and marketplace exploration agents can prepare bounded research plans. External network exploration is disabled by default and must stay within orchestrator-enforced call, token, and cost limits.
- Tool Capability Agent: detects missing-tool, sluggishness, resource-waste, and workflow-complexity signals. It can create no-cost internal generated-tool candidates and feed their output into the normal proposal pipeline.
- Monetary Approval Gate: blocks paid tools, SaaS subscriptions, cloud/GPU usage, paid APIs, licensed dependencies, and marketplace resources until an admin accepts the spend or requests a cheaper internal solution.

## Gotham System Target

Gotham Chat has an explicit target named `PlutoniX System`.

When selected, the frontend sends:

```json
{
  "target": {
    "type": "system",
    "systemId": "plutonix"
  }
}
```

The backend routes the instruction into the self-improvement control plane, creates an evidence-backed proposal, and uses candidate isolation before any implementation stage. System-target requests do not select or mutate generated project workspaces. Existing project target behavior remains unchanged.

## Administrative UI

The `PlutoniX Graphical Model` tab includes a Self-Improvement Control Plane panel with:

- Current status, autonomy mode, event-driven state, and latest cycle
- Global top-bar indicator for ad hoc ready, starting, running, blocked, and completed cycle states
- Event-driven investigator checks for logged activity, plus Gotham system-target and health-finding triggers
- Recent signal and pattern counts
- Recent investigator decisions and problem statements
- Recent proposals with risk and status
- Research-agent usage and budget status
- Generated tool and optimization plans
- Monetary approval alerts with accept, cheaper-solution, and reject controls
- Recent self-improvement run logs
- Pause, resume, emergency stop, and refresh controls

The D3 graph includes self-improvement relationships such as observer -> aggregator -> planner -> validation and recent proposal/pattern/validation/promotion/rollback nodes. Large logs and detailed diffs stay outside the graph.

## Relationship to Enterprise BrainX

Enterprise BrainX is a separate, additive control plane for tenant/application decisions. ResearchX may emit a bounded, reviewable observation or reconsideration request, but it cannot create a self-improvement candidate, alter this control plane’s policy, change code, or deploy. Likewise, self-improvement research settings do not enable ResearchX network access. Each system retains its own explicit opt-in, budget, source/evidence, and approval gates.

AIX model-route records can be referenced as decision evidence, but model selection is not a self-improvement promotion. No BrainX output or route receipt may promote a self-improvement candidate without the existing isolation, deterministic validation, independent review, policy, approval, and rollback lifecycle.

## API Endpoints

- `GET /api/self-improvement/status`
- `GET /api/self-improvement/proposals?limit=50`
- `GET /api/self-improvement/signals?limit=100`
- `GET /api/self-improvement/patterns?limit=100`
- `GET /api/self-improvement/run-logs?limit=100`
- `GET /api/self-improvement/investigations?limit=100`
- `GET /api/self-improvement/research-logs?limit=100`
- `GET /api/self-improvement/tool-plans?limit=100`
- `GET /api/self-improvement/monetary-approvals?limit=100`
- `POST /api/self-improvement/monetary-approvals/:approvalId`
- `GET /api/self-improvement/feature-inventory`
- `POST /api/self-improvement/cycle` for admin/debug use only; normal operation is event-driven.
- `POST /api/self-improvement/control`

Control actions:

```json
{ "action": "pause" }
{ "action": "resume" }
{ "action": "emergency_stop" }
{ "action": "configure", "mode": "sandbox" }
```

## Configuration

The default mode is `sandbox`.

```bash
SELF_IMPROVEMENT_ENABLED=true
SELF_IMPROVEMENT_MODE=sandbox
# One baseline cycle is attempted at backend startup by default. Set false for
# an event/manual-only local process.
SELF_IMPROVEMENT_STARTUP_CYCLE_ENABLED=true
PLUTONIX_SELF_IMPROVEMENT_RUNTIME_EVENTS=false
PLUTONIX_ORCHESTRATOR_SELF_HEAL=false
SELF_IMPROVEMENT_SCHEDULE_MS=0
SELF_IMPROVEMENT_MODEL_PROFILE=
SELF_IMPROVEMENT_MAX_CALLS_PER_CYCLE=2
SELF_IMPROVEMENT_MAX_TOKENS_PER_CYCLE=12000
SELF_IMPROVEMENT_MAX_COST_PER_DAY=1
SELF_IMPROVEMENT_MIN_SIGNAL_COUNT=3
SELF_IMPROVEMENT_MIN_CONFIDENCE=0.65
SELF_IMPROVEMENT_AUTO_PROMOTE_MAX_RISK=low
SELF_IMPROVEMENT_POST_PROMOTION_WINDOW_MS=1800000
SELF_IMPROVEMENT_AUTO_ROLLBACK=true
SELF_IMPROVEMENT_RETENTION_DAYS=30
SELF_IMPROVEMENT_STORE_INSTRUCTION_SAMPLES=false
SELF_IMPROVEMENT_ADMIN_USER_IDS=
SELF_IMPROVEMENT_EVENT_CHECK_ENABLED=true
SELF_IMPROVEMENT_EVENT_TRIGGER_MIN_SCORE=0.78
SELF_IMPROVEMENT_EVENT_WINDOW_MS=600000
SELF_IMPROVEMENT_EVENT_MIN_RELATED_SIGNALS=3
SELF_IMPROVEMENT_EVENT_TRIGGER_COOLDOWN_MS=900000
SELF_IMPROVEMENT_RANDOM_AUDIT_RATE=0.01
SELF_IMPROVEMENT_RESEARCH_ENABLED=false
SELF_IMPROVEMENT_RESEARCH_ALLOW_NETWORK=false
SELF_IMPROVEMENT_RESEARCH_MAX_CALLS_PER_DAY=2
SELF_IMPROVEMENT_RESEARCH_MAX_TOKENS_PER_DAY=8000
SELF_IMPROVEMENT_RESEARCH_MAX_COST_PER_DAY=0.5
SELF_IMPROVEMENT_RESEARCH_SOURCES=
SELF_IMPROVEMENT_TOOL_BUILD_ENABLED=true
SELF_IMPROVEMENT_TOOL_PLAN_AUTO_TRIGGER=true
SELF_IMPROVEMENT_TOOL_PLAN_COOLDOWN_MS=1800000
SELF_IMPROVEMENT_MAX_TOOL_BUILDS_PER_DAY=4
SELF_IMPROVEMENT_MONETARY_APPROVAL_REQUIRED=true
SELF_IMPROVEMENT_MONETARY_APPROVAL_THRESHOLD_USD=0
```

With the checked-in defaults, the backend attempts one bounded baseline cycle at startup (`SELF_IMPROVEMENT_STARTUP_CYCLE_ENABLED=true`). It does not run a periodic timer (`SELF_IMPROVEMENT_SCHEDULE_MS=0`), and runtime-event cycles plus orchestrator self-healing are disabled by default. Set `SELF_IMPROVEMENT_STARTUP_CYCLE_ENABLED=false` when an event/manual-only local process is required. Every logged event can still be checked by the investigator; a later full cycle requires an evidence-backed problem statement, a Gotham `PlutoniX System` target, an enabled runtime-event path, or a forwarded orchestrator-health finding. The manual cycle endpoint remains for local/admin debugging and regression testing.

When a logged event indicates a tool gap, sluggish sub-application, resource waste, or workflow complexity, the Tool Capability Agent records a `ToolIncorporationPlan`. Zero-cost internal tools are built as generated-tool artifacts under `runtime/self-improvement/tools/generated` and then used only against bounded evidence. Tool output can trigger an `ImprovementProposal`, but platform code changes still require candidate isolation, validation, review, promotion policy, and rollback.

When the plan requires money, the system records a monetary approval request and emits an app alert. Approval means the paid path may be considered by a later bounded workflow; it does not silently spend money by itself. Choosing the cheaper option creates a no-cost internal alternative tool plan.

Set `SELF_IMPROVEMENT_ENABLED=false` for a global kill switch. The admin `emergency_stop` action pauses cycles persistently through `runtime/self-improvement/state/control-state.json`.

Set `SELF_IMPROVEMENT_ADMIN_USER_IDS` to a comma-separated list of PlutoniX user IDs or emails to restrict manual cycle and control actions. When the allowlist is empty, local development remains permissive outside `NODE_ENV=production`.

## Data Handling

Logs, model output, generated-project content, and tool output are treated as untrusted input. The observer redacts common tokens, JWTs, private keys, secret assignments, and email addresses. Prompt-injection-like log text is neutralized before it can enter an evidence package.

Evidence packages are bounded and do not include complete logs, complete environment files, secrets, credentials, or unrelated user data. Instruction samples are not stored unless `SELF_IMPROVEMENT_STORE_INSTRUCTION_SAMPLES=true`.

Cycle lifecycle logs are stored at `runtime/self-improvement/run-logs/run-logs.jsonl`, with the latest lifecycle record mirrored at `observability/self-improvement/latest-run-log.json`. These records include only bounded cycle metadata such as phase, reason, mode, cycle ID, summary, and trigger context.

Investigator decisions are stored at `runtime/self-improvement/investigations/investigator-decisions.jsonl`, with the latest decision mirrored at `observability/self-improvement/latest-investigation.json`. Research-agent budget decisions are stored at `runtime/self-improvement/research/research-agent-usage.jsonl`, with the latest record mirrored at `observability/self-improvement/latest-research-log.json`.

Research agents never receive unlimited repository or log content. Network exploration is off unless `SELF_IMPROVEMENT_RESEARCH_ENABLED=true` and `SELF_IMPROVEMENT_RESEARCH_ALLOW_NETWORK=true`; even then, daily call, token, and cost limits are enforced before research can proceed.

Tool plans, generated tools, tool runs, and monetary approvals are stored under `runtime/self-improvement/tools` and `runtime/self-improvement/approvals`. Generated tools are deterministic runtime artifacts; they are not allowed to override root instructions, execute untrusted log commands, modify secrets, or mutate live platform source directly.

## Local Operation

```bash
npm --prefix apps/backend run test
npm --prefix apps/frontend run build
npm run validate
./run.sh
```

Admin/debug cycle:

```bash
curl -X POST http://localhost:8080/api/self-improvement/cycle \
  -H 'Content-Type: application/json' \
  -d '{"reason":"manual-local-check"}'
```

Emergency stop:

```bash
curl -X POST http://localhost:8080/api/self-improvement/control \
  -H 'Content-Type: application/json' \
  -d '{"action":"emergency_stop"}'
```

## Deployment Notes

The control plane uses file-backed JSONL state and a lock file, so it survives backend restarts and avoids concurrent cycles inside a shared filesystem. It is not a replacement for a production queue or database. If multiple backend instances do not share the same runtime volume, configure a durable queue/lock before enabling autonomous promotion.

Existing generated projects do not require migration. They inherit updated orchestrator behavior through the backend route and project-local handoff path when selected or generated again.

## Current Limitations

- Coding-capable live patch generation is intentionally not enabled in the default vertical slice.
- Model analysis is structured and gated, but the current implementation uses a rule-based analyst unless a provider-neutral model adapter is explicitly added.
- Promotion remains staged in `sandbox`; external deployment is not automatic.
- Benchmark comparison records the plan and hard gates, but before/after runtime metrics require a real candidate patch and healthy baseline suite.
- Enterprise BrainX adds reviewable policy/budget/research/route/reuse receipts, but it is not legal certification and does not enable autonomous policy changes, unrestricted research, live provider inference, or automatic model downloads.
