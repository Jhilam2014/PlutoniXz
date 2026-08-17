# Dependencies And Explore Representation Workshop

Status: implemented and regression-verified

Scope: Agentic System D3 Dependencies, Explore, Architecture hierarchy, and the right-side inspector.

## Goal

Make service, agent, dependency, and functionality relationships understandable without fabricating ownership, performance, or runtime facts. A selection must reveal context without hiding, collapsing, or fading recorded descendants.

## Participants and evidence

### Data-science review

The graph is directed relational data. The current snapshot contains 793 nodes and 737 links, including 6 services, 181 agents, and 116 application functionalities. It has no recorded subfunctionalities and does not establish an agent or functionality association for every service. Missing evidence must remain explicit rather than inferred.

- `source → target` is the only direction rule.
- Direct service relationships are complete only when their recorded links are shown; a missing relationship is labelled **Not recorded**, never **Unassigned**.
- Efficiency is shown only when a source-provided value and freshness are available. Otherwise the inspector says **Efficiency not reported**.

### Product-design review

The two views need separate grammars, while selection becomes an outline-and-link emphasis rather than a visibility filter.

- **Dependencies:** upstream providers on the left, selected focus in the centre, and downstream consumers plus hierarchy descendants on the right. Cycle/shared nodes occupy a labelled centre sublane instead of overlapping the focus.
- **Explore:** a project × operating-role matrix. Position expresses those two categories only; links remain contextual and never imply unrecorded proximity.
- Every node type gets a deterministic shape, colour, icon, accessible name, and legend entry. Runtime status is a separate small mark.
- The inspector reads: purpose → hierarchy → connected agents → services and dependencies → verified efficiency/telemetry → agent profile link.

### Systems-architecture review

The runtime endpoint is authoritative: `GET /api/agentic-system/graph` merges project topology with global agent analysis. It already records agent-to-functionality `implements` and project-to-functionality containment, but service ownership is only available where an actual edge exists.

- Deduplicate links by `source + target + type` before computing counts, lanes, or inspector rows.
- Full transitive containment closure is mandatory for any selected parent or child, independent of the non-hierarchy hop depth control.
- Layout spacing must use visual bounds, grow the virtual canvas, and prevent drag-induced collisions.
- Agent deep links target the existing `/?workspace=agents&agent=<id>` route and retain a topology fallback when global memory does not resolve the agent.

## Final representation contract

| View | Question answered | Position | Always shown | Selection behavior |
| --- | --- | --- | --- | --- |
| Dependencies | What does this entity use, who operates it, and what does it enable? | Left: recorded upstream providers; centre: focus/shared cycle; right: recorded downstream consumers and full hierarchy descendants. | All direct recorded relationships and all containment descendants. | Outline focus and strengthen incident links; retain full opacity for every node. |
| Explore | How are responsibilities distributed across projects and operating roles? | Columns: project; rows: operating role. | All filtered nodes and links. | Keep matrix membership unchanged; outline selected paths only. |
| Architecture branches | What functionality hierarchy exists below a project? | Project root → functionality → every recorded child/code unit/branch. | Complete descendant chains. | Never use preview truncation; grow and pan instead. |

## Data contract and safe fallbacks

The renderer normalizes these source facts without rewriting provenance:

- node identity, source type, label, project, description/responsibility, lifecycle/runtime status, risk, and evidence;
- directed links and their original relationship types;
- containment links, agent ownership/implementation links, and direct service relationships;
- source-provided performance fields such as `efficiencyScore`, `accuracyValue`, and `abilityScore`.

When data is absent, the UI uses one of:

- **No direct agent relationship recorded**
- **No recorded child functionality**
- **No live telemetry**
- **Efficiency not reported**

## Acceptance criteria

1. Each service lens includes every deduplicated direct agent/service/dependency relationship and labels absent associations safely.
2. A selected parent or child retains all descendants at full opacity in Dependencies, Explore, and Architecture.
3. Every present node type has a stable visual encoding and accessible type label.
4. Production-snapshot and dense-fixture layouts have no intersecting visual bounds, including after drag.
5. A functionality/service inspector contains description, hierarchy, connected agents, typed relationships, and verified efficiency fallback.
6. Agent-specific inspector actions navigate to the matching Agents workspace profile.

## Verification record — 2026-08-14

The static topology is kept source-faithful (793 input nodes, 737 input links). During normalization, 125 cited source units become explicitly labelled `sourceBackedProjection` child nodes rather than fabricated business functionality. The rendered model therefore contains 918 nodes, 812 links, and 125 `contains_subfunctionality` relationships.

- Explore retains all 918 nodes and all 812 links after a functionality selection; desktop and narrow virtual layouts have zero intersecting visual bounds.
- Every recorded service dependency lens retains all of its link endpoints, includes chains deeper than two hops, and has zero visual-bound collisions.
- Architecture renders all 125 child units with no duplicates or collisions. A regression fixture covers a major functionality → child → grandchild → branch chain.
- The inspector regression contract verifies the visible hierarchy, factual `Efficiency not reported` fallback, profile-link label, and bounds-aware drag handling.
