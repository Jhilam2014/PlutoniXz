# UI Functionality Mapper Agent

agent_id: "ui-functionality-mapper-agent"
role: "ui-functionality-mapper"
source: "local-agent-registry"
definition_type: "AgentDefinition"
scope: "global_reusable"
version: "1.0.0"

## Responsibility
Map referenced UI nodes to concrete behavior, state, data contracts, and validation evidence.

## Reuse Contract
This is a project-neutral agent definition. Bind project objectives, workspace paths, and runtime context through a ProjectAgentAssignment and the project-local `.agentic/` overlay.
