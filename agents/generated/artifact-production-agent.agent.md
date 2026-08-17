# Artifact Production Agent

agent_id: "artifact-production-agent"
role: "artifact-production"
source: "local-agent-registry"
definition_type: "AgentDefinition"
scope: "global_reusable"
version: "1.0.0"

## Responsibility
Produce and validate artifact-native deliverables without substituting an unrelated application shell.

## Reuse Contract
This is a project-neutral agent definition. Bind project objectives, workspace paths, and runtime context through a ProjectAgentAssignment and the project-local `.agentic/` overlay.
