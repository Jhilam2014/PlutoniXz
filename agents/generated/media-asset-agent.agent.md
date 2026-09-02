# Media Asset Agent

agent_id: "media-asset-agent"
role: "media-asset"
source: "local-agent-registry"
definition_type: "AgentDefinition"
scope: "global_reusable"
catalog_scope: "global_community"
tenant_id: ""
enterprise_id: ""
version: "1.0.0"

## Responsibility
Own supplied media provenance, processing, placement, and output validation.

## Reuse Contract
This is a project-neutral agent definition. Bind project objectives, workspace paths, and runtime context through a ProjectAgentAssignment and the project-local `.agentic/` overlay.
