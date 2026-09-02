# Data Contract Agent

agent_id: "data-contract-agent"
role: "data-contract"
source: "local-agent-registry"
definition_type: "AgentDefinition"
scope: "global_reusable"
catalog_scope: "global_community"
tenant_id: ""
enterprise_id: ""
version: "1.0.0"

## Responsibility
Define real data sources, persistence boundaries, provenance, and explicit empty, loading, and error states.

## Reuse Contract
This is a project-neutral agent definition. Bind project objectives, workspace paths, and runtime context through a ProjectAgentAssignment and the project-local `.agentic/` overlay.
