# Sanitized task prompt

Goal: redesign the D3 Architecture Branches view so the hierarchy is professional and calm rather than visually clumsy.

Context: the live Architecture projection contains project roots, major functionalities, nested child functionalities, branches, and an unusually dense unmapped-evidence fallback. The prior presentation drew each relationship as an independent long curve.

Scope: update the existing D3 model, renderer, styling, and tests only. Preserve all nodes, source relationships, inspector behavior, selection context, and drag behavior.

Constraints: do not invent parentage, hide child nodes, remove topology, add a route or backend, or use fake data. A visual aggregate is a routing treatment only and must expose the original relationship IDs.

Requirements: introduce labelled source-zone rails for repeated root containment, retain local child/branch twigs, make a high-fanout unmapped-evidence rail explicit, avoid selection-driven fading, validate relationship conservation and production build behavior.

Done when: Architecture reads as a deliberate transit-map hierarchy and every source relationship remains represented exactly once in the visual routing plan.
