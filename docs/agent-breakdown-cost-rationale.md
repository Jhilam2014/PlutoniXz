# Agent Breakdown Cost Rationale

The initial build uses one fullstack agent rather than separate frontend, backend, DevOps, and MCP agents.

This keeps coordination cost low while the system is still a compact product scaffold. The high-risk areas are controlled with explicit boundaries: prompts are treated as text, generated files are written only under `apps/generated-site/src/generated/`, and external model integration is not enabled yet.
