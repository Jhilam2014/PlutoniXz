# PlutoniX Graphical Model Design Workshop

> Superseded for the PlutoniX Analysis workspace on 2026-08-19. The former
> Overview, Dependencies, Functionality Flow, Explore, BrainX, and decision
> canvases were replaced by the enterprise/application analysis contract in
> `docs/plutonix-analysis-workshop.md`. This document remains as historical
> design evidence for the standalone mandatory Agentic System D3 artifact.

Status: Active living plan  
Last reviewed: 2026-07-24  
Workflow: `plutonix-agentic-d3-market-ready-001`

## Product Position

The Agentic System page is an agent operations workbench. Its primary job is to help an operator answer three questions quickly:

1. Where does the system need attention?
2. What depends on the selected agent or capability?
3. What evidence is available to diagnose the problem?

The graph is a navigation and reasoning surface, not a decorative inventory.

## Workshop Inputs

The workshop combined four perspectives:

- Enterprise product design: hierarchy, density, typography, and product coherence.
- Observability UX: health semantics, causality, data freshness, and investigation workflows.
- Accessibility and interaction: keyboard navigation, screen-reader alternatives, responsive behavior, and focus management.
- Implementation feasibility: preserving the current APIs, D3 rendering, Dagre layouts, graph schema, and runtime actions.

The first desktop and mobile audits found two release blockers: the toolbar forced the inspector off-screen at desktop widths, and the mobile filter stack plus empty inspector prevented users from reaching the graph. Both were corrected in the current implementation.

## Design Principles

- Health and causality first; full-graph exploration second.
- Start at project level, then progressively reveal capabilities and agents.
- Keep one committed selection. Hover may preview a tooltip but must never replace pinned details.
- Be explicit about data provenance. A static fallback is labeled as a fallback, and lifecycle state is not presented as live execution.
- Use semantic health color sparingly. Purple identifies product and selection state; red, amber, and green are reserved for operational meaning.
- Keep the graph visible on every supported viewport. Details open only after selection.
- Every graph workflow needs a keyboard and HTML-list equivalent.
- Preserve stable positions. Expanding one branch must not randomly rearrange unrelated branches.

## 2026-08-18 Canvas Representation Contract

An architecture review, data-visualization review, and Apple Human Interface
Guidelines review aligned on a clearer division of responsibility between the
four canvases:

| Canvas | Operator question | Default representation | Truth boundary |
| --- | --- | --- | --- |
| Overview | What projects exist and where should I go next? | Finder-style project folders and capability disclosure | Portfolio counts are source inventory, not runtime execution. |
| Dependencies | What does this selected capability use and affect? | Directed upstream → focus → downstream impact lens | Discovery order is not an execution timeline. Ownership is context, not causality. |
| Functionality Flow | What source-backed application structure is recorded for this feature? | One selected, left-to-right application map | Render an end-to-end control transition only when its relationship is recorded. |
| Explore architecture | How is the selected application composed? | Source-derived architecture map with details on demand | Surface source evidence and unresolved relationships without inventing behavior. |

The current topology is dominated by containment, ownership, and API-to-data
relationships. It does not by itself prove UI-to-API-to-service runtime paths.
The Functionality Flow canvas therefore labels source-only projections as an
**application map** and places implementing agents as contextual annotations,
not causal stages. An execution/control timeline is permitted only when the
source contributes an explicit `controlFlowSequence` or recorded control
relationship.

Interaction rules:

- Overview opens as the high-level project folder grid; no project selection is
  required to understand the portfolio.
- Detailed canvases require a project scope, preventing cross-project visual
  noise and arbitrary default journeys.
- Selection is committed by click or keyboard; hover remains a preview and
  details stay in the Inspector or accessible outline.
- On compact screens, Explore preserves the full canvas width and relies on
  the existing bottom-sheet Inspector rather than reserving a permanent
  architecture sidebar.

## Current Information Architecture

- Product bar: source, freshness, agent count, visible count, failures, warnings, and refresh.
- Persistent views: Overview, Dependencies, Functionality Flow, and Explore.
- Primary commands: search, project scope, runtime status, progressive filters, graph actions.
- Overview: collapsed project clusters ordered by operational severity.
- Project drill-down: capability clusters with stable parent placement.
- Focus mode: selected agent with one-hop or two-hop upstream and downstream context.
- Inspector: Overview, Relationships, Activity, and Configuration tabs with persistent logs and agent-inspection actions.
- Entity navigator: HTML list alternative for graph discovery and assistive technology.
- Mobile: graph-first layout with a selection-driven bottom sheet.

## Completed Release Blockers

- Replaced the wide form-like toolbar with a compact command surface.
- Removed the default empty inspector and graph overlap.
- Added project-first overview navigation.
- Added bounded runtime fetches with static fallback.
- Added source and freshness messaging.
- Corrected search so selection retains dependency context.
- Separated temporary hover preview from committed selection.
- Added responsive graph sizing with `ResizeObserver`.
- Added keyboard directional navigation and an accessible entity list.
- Added loading, empty, no-live-signal, and runtime-error states with recovery actions.
- Added local pinned D3, Dagre, and Lucide browser assets.
- Added reduced-motion handling and mobile sheet controls.
- Connected Open Logs to an agent-focused Activity log route.
- Connected Inspect Agent to the Agents workspace with immediate topology-backed details and memory-index enrichment.
- Reorganized agent details into task-oriented inspector tabs.
- Added progressive rendering for large node sets and hybrid Canvas relationship rendering when density or frame time exceeds the SVG budget.
- Added visible render-engine, object-count, path-count, and frame-time telemetry.
- Bounded OpenAI agent-memory reads and cached the global agent index.

## Continuous Improvement Backlog

### Next Release

- Add explicit backend fields for lifecycle, runtime, health, freshness, and relationship family.
- Add a mobile overflow menu for the full action set.
- Add live refresh cadence and pause controls.
- Make health counters clickable filters.

### Production Polish

- Add execution trace and timeline data when the backend exposes run records.
- Add interactive minimap viewport dragging.
- Add collision-aware expansion for very large capability groups.
- Add saved views and removable filter chips.
- Bundle a tested font asset only if the system stack proves inconsistent across target platforms.

### Scale And Reliability

- Extend the verified progressive/Canvas gate from 160 nodes and 280 relationships to 500 and 1,000 visible entities.
- Add viewport culling measurements above the progressive-render threshold.
- Add stale-cache age thresholds and reconnect behavior.
- Add route and permission error handling for logs and agent inspection.

## Iteration 2 Evidence

- Seven model tests pass, including render-strategy thresholds.
- The production bundle compiles 2,164 modules.
- Desktop and mobile default views retain nine visible objects with no horizontal overflow or browser errors.
- Exact-agent search opens the correct dependency focus and four-tab inspector.
- Open Logs opens PlutoniX with the requested agent filter active.
- Inspect Agent opens an immediate topology-backed profile, then resolves against the global agent-memory index.
- The global agent index returns fresh cached data over HTTP in 0.76 seconds and stale data in 2.8ms while refreshing in the background.
- A synthetic 160-node, 280-relationship browser test selected `progressive-hybrid`, emitted zero SVG relationship paths, drew 7,628 sampled nontransparent Canvas pixels, and measured 19.5ms with no browser errors.

## Experience Measures

Measure these with real sessions; do not fabricate baseline values:

- Search-to-focused-agent completion time.
- First-click success for locating a failing or waiting agent.
- Time to identify one upstream and one downstream dependency.
- Stale-data recognition rate.
- Keyboard-only task completion rate.
- Mobile project-to-agent drill-down completion rate.
- Inspector action success rate.
- Graph render time at 100, 500, and 1,000 visible entities.

## Review Cadence

Run a workshop review whenever one of these changes:

- topology schema or entity semantics,
- runtime execution data,
- relationship types,
- graph size threshold,
- inspector actions or navigation routes,
- supported viewport or accessibility requirements.

Each review should capture desktop and mobile screenshots, run the model tests and production build, record unresolved findings in the improvement plan, and update this document only with verified evidence.
