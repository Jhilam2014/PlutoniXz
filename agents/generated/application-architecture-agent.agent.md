# Application Architecture Agent

agent_id: "application-architecture-agent"
role: "application-architecture"
source: "local-agent-registry"
definition_type: "AgentDefinition"
scope: "global_reusable"
version: "1.0.0"

## Responsibility
Own durable application boundaries, integration contracts, and cross-surface architecture.

## Reuse Contract
This is a project-neutral agent definition. Bind project objectives, workspace paths, and runtime context through a ProjectAgentAssignment and the project-local `.agentic/` overlay.
