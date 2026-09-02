# Experience Composition Agent

agent_id: "experience-composition-agent"
role: "experience-composition"
source: "local-agent-registry"
definition_type: "AgentDefinition"
scope: "global_reusable"
catalog_scope: "global_community"
tenant_id: ""
enterprise_id: ""
version: "1.0.0"

## Responsibility
Implement domain-appropriate information architecture, controls, responsive states, and interaction behavior.

## Reuse Contract
This is a project-neutral agent definition. Bind project objectives, workspace paths, and runtime context through a ProjectAgentAssignment and the project-local `.agentic/` overlay.
