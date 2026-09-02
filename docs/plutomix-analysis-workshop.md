# PlutoMix Enterprise And Application Analysis Workshop

Status: Implemented product contract  
Workshop date: 2026-08-19  
Participants: enterprise product design, Apple HIG review, data-visualization review, and system architecture review

## Product objective

PlutoMix helps enterprise developers build complex applications and then operate the resulting application portfolio at account scope. The Builder remains the creation surface. The Analysis workspace explains what applications exist, how their knowledge boundaries are governed, what each application currently implements, and which recorded choices may deserve review.

The page has two complementary brains:

- **PlutoMix Enterprise Brain** is a curated portfolio layer. It may hold only agreement-authorized publications, redacted decision summaries, reusable patterns, and portfolio relationships.
- **Application BrainX** is private to one application. It manages that application's evidence, decisions, constraints, and reconsideration suggestions. It cannot read another application's BrainX directly.

The existing BrainX model registry remains model governance. It does not become a cross-application authorization system.

## Workshop decisions

### One analysis workspace, two levels

Replace the former Overview, Dependencies, Functionality Flow, Explore, BrainX canvas, and freeform decision timeline with one master-detail Analysis workspace:

1. **Portfolio** answers which applications exist, which enterprise owns each application, what evidence coverage is available, and which explicit cross-application relationships are recorded.
2. **Application decisions** answers what is observed now, which options have an authoritative selected/deferred/rejected disposition, which constraints were recorded, and which real condition events have opened reconsideration.

The workspace keeps standard HTML, CSS grid, tables, disclosure controls, and branch summaries as its primary reading layer. Portfolio Intelligence and Delivery Decision Graph additionally provide bounded, explicitly opened popup canvases for spatial exploration. No relationship fact is canvas-only: search, filters, keyboard selection, adjacent inspectors, Fit/Reset controls, and the document-native summaries retain an accessible reading path.

### Truthful portfolio relationships

Current topology contains project ownership, feature containment, agent ownership, and within-project API-to-data links. It does not contain evidenced application-to-application runtime dependencies. Therefore:

- `creates_project`, `implements`, common agent ownership, and same tenant are never rendered as application dependencies.
- A causal portfolio edge is shown only when its source and target resolve to different managed applications and the relationship is an allowed runtime, API, service, or data dependency with evidence.
- The correct current empty state is **No recorded app dependencies**. Application cards remain useful without invented connector lines.
- Information-sharing edges are separate from dependencies and require the policy gate below.

### Agreement-gated information sharing

Cross-application information access is default-deny. It is permitted only when all of these are true:

1. Both applications have the same explicit enterprise ID.
2. A current, active agreement names the producer and recipient direction.
3. Source, recipient, and account approvals are recorded.
4. The agreement covers the requested purpose and has not expired, been suspended, or been revoked.

A shared project flag, shared user, common agent, or same tenant does not grant access. The orchestrator records the agreement revision or access receipt in downstream decision provenance. Missing agreement data is shown as unavailable; it is never replaced with fabricated shared context.

The file-backed integration hook is configured with `ENTERPRISE_SHARING_AGREEMENTS_PATH`; records follow `schemas/enterprise-sharing-agreement.schema.json`. It is a read-only analysis input, not a production cross-application content channel. Missing or malformed records fail closed. Any future content-retrieval path must enforce tenant RBAC and issue an access receipt in addition to this agreement check.

### Decision checkpoint grammar

Read each decision board left to right:

```text
Application objective -> capability checkpoint -> recorded outcome branches -> evidence / constraints -> next governed action
```

Outcome states are semantically distinct:

- **Observed implementation** means source analysis found code. It is not proof of a historic selection.
- **Selected** appears only for an authoritative selected lifecycle disposition.
- **Deferred** preserves an option, reason, constraints, and revisit triggers.
- **Rejected** appears only when a rejected disposition and reason were actually recorded.
- **Under review** represents an unresolved candidate without inventing a decision.

Constraints are annotations on a branch, not causal path nodes. A reconsideration marker appears only when a real recorded condition event/request exists. `autoReconsideration: true` by itself means the branch is eligible to be watched; it is not an active suggestion.

### Constraint changes and reconsideration

The existing Decision Continuity ledger remains the source of truth. A trusted condition observation can re-evaluate a deferred branch. The analysis workspace surfaces the resulting recorded reconsideration request. A future V2 checkpoint model should make suggestions independently reviewable before moving a branch to `reconsidering`; it must never silently activate a choice or rewrite the original checkpoint.

## Information architecture

### Portfolio

- Searchable application directory
- Batch enterprise-assignment panel with application search, multi-select, existing-enterprise selection, new-enterprise labels, explicit removal, and per-application results
- Enterprise grouping and unassigned-enterprise state
- PlutoMix Enterprise Brain card with agreement boundary explanation
- Application BrainX cards with product type, source freshness, functionality/API/data counts, and review posture
- Evidence-backed relationship table or precise empty state
- Explicit sharing-agreement status, separate from causal dependencies
- Lightweight preview that opens a dedicated Portfolio Intelligence popup
- Enterprise-centered perimeter layout using each BuildX application's own recorded icon
- Separated and visibly marked unassigned applications without inventing membership

### Application decisions

- Breadcrumb and selected application summary
- Enterprise tag editor
- App BrainX privacy and Enterprise Brain eligibility status
- Objective and capability/checkpoint directory
- One focused decision board at a time
- Selected/deferred/rejected/observed lanes generated only from recorded state
- Branch detail panel for rationale, evidence, constraints, provenance, and real reconsideration events
- Lightweight Delivery Decision Graph preview and a dedicated detail popup
- Non-overlapping build, functionality, decision, Global Agent Memory, and service nodes
- Storyboard-style chronology and service segues with explicit historical/anticipated semantics
- Wheel, double-click, and button zoom; background pan; collision-aware node drag; Fit; Reset view; and Reset layout

## Accessibility and responsive contract

- Native buttons, lists, tables, inputs, `details`, and headings are the primary interaction model.
- Click or Enter commits a selection; no required information is hover-only.
- Detail canvases provide keyboard node navigation and visible Zoom, Fit, Reset, search, filter, and Close controls; geometry is never the only carrier of meaning.
- State always uses text and an icon/pattern in addition to color.
- Touch targets are at least 44px where controls are primary.
- At narrow widths the application directory becomes a compact picker and decision branches stack vertically; the detail panel follows the selected branch in document order.
- Focus rings remain visible, text supports 200% zoom, and reduced-motion preferences disable nonessential transitions.

## Data-quality findings and migration direction

The current snapshot includes observed-current and deferred branch records but does not establish rejected histories, constraint reasons for every branch, or a cross-app dependency network. The replacement UI names those gaps explicitly.

The next expand-only backend migration should introduce stable enterprise/application IDs, versioned sharing agreements and access receipts, decision checkpoints, checkpoint-specific dispositions, independently versioned constraints, and reviewable reconsideration suggestions. Legacy records must be backfilled without converting source observations into selections.

## Acceptance criteria

- Retired all-in-one graph views remain unmounted. The current Portfolio Intelligence and Delivery Decision Graph canvases mount only inside their explicitly opened detail popups.
- Portfolio and application summaries and evidence remain reachable without pan or zoom; optional canvases provide additional exploration rather than exclusive facts.
- Enterprise tags persist on managed projects.
- Portfolio operators can assign or remove one or more application memberships without creating a dependency or sharing permission; moves and removals require explicit confirmation.
- Cross-app sharing remains denied unless the same-enterprise and active-agreement gate passes.
- Current source observation is never labelled Selected.
- Deferred and rejected branches show only recorded reasons and constraints.
- Real reconsideration records are visible; eligibility alone is not presented as an active signal.
- Empty states explain missing topology, enterprise tags, agreements, decisions, and evidence without inventing production facts.

## Interactive intelligence canvas extension

Extension date: 2026-08-23
Participants: product design, data visualization, frontend architecture, Global Agent Memory, and BuildX application identity

The bounded popup canvases follow these additional implementation rules:

- **Application identity:** use only the matching BuildX project record's `appIcon` or `app-icon` media resolved against that application's preview origin. A deterministic monogram is the safe fallback.
- **Agent identity:** resolve an exact agent ID against `/api/agents/global` and use the shared Global Agent Memory avatar derivation. If the record is unavailable, use structured topology/assignment category metadata and do not claim memory availability.
- **Functionality identity:** choose the glyph from the recorded functionality category, while keeping the full source label in the inspector.
- **Collision:** use full rectangular node bounds with clearance during force settling and drag placement. Wide cards must not overlap even though D3's native collision helper is circle-based.
- **Chronology segue:** solid directional connectors represent recorded chronology; dashed directional connectors represent explicit anticipated source order and never history.
- **Service segue:** supporting-service relationships use a thin line, circular service badge, and open destination chevron. A service connector is not chronology unless its record explicitly says so.
- **Interaction:** scrolling and double-clicking zoom, visible buttons zoom, dragging empty space pans, and dragging a node repositions and pins it until Reset layout.
- **Recovery:** Fit graph restores the whole graph; Reset view clears focus and restores fit; Reset layout clears manual pins and restarts the governed layout.
- **Truthfulness:** visual proximity, common icons, colors, enterprise perimeter placement, or shared agents cannot create ownership, authorization, dependency, chronology, or decision disposition.

## Decision-lineage workshop extension

Workshop date: 2026-08-20  
Participants: Apple HIG design review, data-visualization review, system architecture review, and frontend implementation review

The follow-up workshop tested the requested chronological, multi-path application graph against the stored project and decision data. It found that source-analysis summaries and real decision-ledger records must be presented through two visibly separate graph lenses.

### Durable application origin

Every newly created or imported project records provenance independently of runtime status:

- `plutomix_created` means the project creation workflow recorded PlutoMix as its origin.
- `imported` means the import workflow recorded an external application baseline.
- `unknown_legacy` means a legacy project has no durable origin evidence.

Starting, stopping, or rebuilding an application never changes its origin. Legacy `running` or `stopped` status is not treated as proof that PlutoMix created the app.

### Recorded lineage lens

The Recorded lineage lens answers: **Which choices and branch relationships are actually recorded?**

- A connector is drawn only from a stored `parentBranchId` between compatible records.
- Stored root and parent lineage IDs define the branching structure; matching functionality names never create an edge.
- Valid decision-ledger timestamps determine record order. Missing timestamps remain visibly unavailable.
- Missing parents, cross-functionality parents, root conflicts, and cycles are moved into an unlinked-record lane with no causal connector.
- Selected, deferred, and rejected labels require a governed ledger disposition. Static source analysis cannot create these dispositions.

### Source choice-map lens

The Source choice map answers: **What exists, and which future alternatives are supportable from current source evidence?**

- Each source-backed major functionality is one checkpoint.
- The current implementation is labelled source-observed, never historically selected.
- Source-analysis alternatives are labelled anticipated, never historically deferred.
- For an explicitly imported application, each checkpoint receives a deterministic compatibility alternative and a constraint-backed anticipated rejection when the report does not already provide one. Unknown-legacy applications receive the same source-only aid while retaining an explicit unknown-origin badge; the UI never silently calls them imported.
- Anticipated rejection constraints are category-specific (for example API compatibility, data migration and rollback, integration failure isolation, authorization, accessibility, or repeatable testing).
- Every anticipated branch carries `historicalClaim: false`; it is a review aid, not a reconstructed decision.

Static dependency-aware delivery order may arrange source checkpoints left to right, but the UI labels it **anticipated implementation order**. It is never described as historical chronology.

If the current project folder has no readable application source but a prior local source-analysis snapshot exists, the map may use that snapshot only as an explicitly stale fallback. The UI states that the current source is unavailable and never presents the snapshot as current or historical decision proof.

### Graph interaction contract

- Show one recorded root or one source checkpoint at a time.
- Provide previous/next controls and a native selector for checkpoint navigation.
- Use a stable left-to-right application root → checkpoint → outcome flow on wide screens and a top-to-bottom flow on narrow screens.
- Keep outcome state, record basis, timestamp availability, reasons, constraints, evidence, ledger events, and real reconsideration signals in the adjacent inspector.
- `autoReconsideration` without a dated condition event is described only as monitoring eligibility; it does not create an active signal.
- The semantic list and buttons remain usable without the graphical connector styling.

### Extended acceptance criteria

- PlutoMix-created, imported, and unknown-legacy origins are visibly distinguishable and never inferred from runtime state.
- A PlutoMix-created application can plot recorded selected/deferred/rejected lineage when those ledger records exist.
- An imported or unknown-legacy application plots source-observed current, anticipated alternatives, and constraint-backed anticipated rejections for every discovered major functionality without claiming historical knowledge.
- Recorded and source-derived choices are never mixed under one historical chronology.
- Shuffled input produces the same root, branch, and checkpoint ordering.
- Source digest changes remove stale source-derived choices while retaining genuine governed decisions.
