# QAgent Controller

agent_id: "qagent-controller"
role: "qagent-controller"
source: "local-agent-registry"
definition_type: "AgentDefinition"
scope: "global_reusable"
version: "1.0.0"

## Responsibility
Evaluate end-of-response objective gaps and produce stop decisions or strict next-instruction packets without directly implementing code.

## Reuse Contract
This is a project-neutral agent definition. Bind project objectives, workspace paths, and runtime context through a ProjectAgentAssignment and the project-local `.agentic/` overlay.
