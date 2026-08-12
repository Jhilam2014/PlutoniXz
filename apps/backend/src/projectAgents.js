import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function projectRoot() {
  return process.env.PLUTONIX_PROJECT_ROOT || repoRoot;
}

function agentRuntimeRoot() {
  return process.env.PROJECT_AGENT_RUNTIME_ROOT || path.join(projectRoot(), "runtime", "agents", "projects");
}

function deletedAgentsPath() {
  return process.env.DELETED_AGENTS_PATH || path.join(projectRoot(), "runtime", "agents", "deleted-agents.json");
}

function generatedAgentsRoot() {
  return process.env.PROJECT_AGENT_MARKDOWN_ROOT || path.join(projectRoot(), "agents", "generated");
}

function generatedGraphPath() {
  return process.env.PROJECT_AGENT_NEO4J_PATH || path.join(projectRoot(), "graph", "neo4j", "generated-project-agents.cypher");
}

function topologyGraphPath() {
  return process.env.AGENTIC_SYSTEM_GRAPH_PATH || path.join(projectRoot(), "topology", "d3", "agentic-system-graph.json");
}

function frontendGraphPath() {
  return process.env.FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH || path.join(projectRoot(), "apps", "frontend", "public", "topology", "d3", "agentic-system-graph.json");
}

function selfImprovementRuntimeRoot() {
  return path.join(projectRoot(), "runtime", "self-improvement");
}

async function readJsonLineRecords(filePath, limit = 20) {
  if (!(await fs.pathExists(filePath))) return [];
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-limit);
}

function sanitizeAgentId(value) {
  return String(value || "project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "project";
}

function titleCase(value) {
  return String(value || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function needsDesignWorkshopAgent(structuredRequest = {}, productDecision = {}) {
  const text = [
    structuredRequest.instruction,
    structuredRequest.pageType,
    structuredRequest.taskType,
    structuredRequest.target?.type,
    productDecision.productShape,
    productDecision.interactionModel,
    ...(structuredRequest.sections || [])
  ].filter(Boolean).join(" ").toLowerCase();
  return (
    ["browser_app", "production_application", "deep_complex_platform"].includes(productDecision.productShape) ||
    /agentic[- ]?plutonix|plutonix|gotham|frontend|ui|ux|design|layout|panel|chat|dashboard|workflow|controls?|modal|graph|navigation|responsive/.test(text)
  );
}

const managedBlockStart = "<!-- plutonix-project-orchestrator:start -->";
const managedBlockEnd = "<!-- plutonix-project-orchestrator:end -->";

async function writeManagedEntryFile(filePath, title) {
  const block = [
    managedBlockStart,
    `# ${title}`,
    "",
    "Before editing this project, read `.agentic/orchestrator-agent.md` as project-scoped execution context.",
    "PlutoniX Fullstack Agent remains the global authority for task scope, delegation, validation, retries, and completion.",
    managedBlockEnd
  ].join("\n");
  const existing = (await fs.pathExists(filePath)) ? await fs.readFile(filePath, "utf8") : "";
  const pattern = new RegExp(`${managedBlockStart}[\\s\\S]*?${managedBlockEnd}`, "m");
  if (existing.trim() && !pattern.test(existing)) return;
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trim()}${existing.trim() ? "\n\n" : ""}${block}\n`;
  await fs.writeFile(filePath, next);
}

async function writeProjectLocalOrchestrator(topology) {
  const workspaceDir = topology.project.workspaceDir;
  if (!workspaceDir) return;
  const orchestrator = topology.agents.find((agent) => agent.role === "project-orchestrator");
  const specialists = topology.agents.filter((agent) => !["project-orchestrator", "qagent-controller"].includes(agent.role));
  const supportAgents = topology.agents.filter((agent) => agent.role === "qagent-controller");
  const qagenticContract = supportAgents.length
    ? [
        "## QAgentic Continuation Contract",
        "- Every generated project includes base QAgentic support at project onset.",
        "- After an agent response, use the project-local QAgent Controller to decide whether the objective is complete or a precise next instruction is required.",
        "- Runtime QAgents are created only for blocking or important objective gaps; do not pre-generate every possible QAgent.",
        "- QAgents return Next Instruction Packets only. They must not directly implement code or create infinite loops.",
        "- QAgents must validate Product Shape fidelity, implementation depth, interaction model, information density, data provenance, supplied-input consumption, generic-template drift, and unrequested explainer copy.",
        "- Stop when validation passes, the objective is complete, only polish remains, human approval is required, or the iteration cap is reached.",
        ""
      ]
    : [];
  const policyDir = path.join(workspaceDir, ".agentic");
  const localAgentsDir = path.join(policyDir, "agents");
  await fs.ensureDir(localAgentsDir);
  if (!orchestrator) {
    await fs.remove(path.join(policyDir, "orchestrator-agent.md"));
    return;
  }
  if (!supportAgents.length) {
    await fs.remove(path.join(policyDir, "qagentic-support"));
  }

  const policy = [
    `# ${orchestrator?.name || "Project Orchestrator Agent"}`,
    "",
    `project_id: ${topology.project.id}`,
    `project_name: ${topology.project.name}`,
    `workspace: ${topology.project.workspaceDir}`,
    `preview_port: ${topology.project.port}`,
    "authority: plutonix-delegated-project-context",
    "",
    "## Core Objective",
    "Deliver the highest achievable implementation accuracy with the lowest justified token and tool cost.",
    "Use current workspace evidence as truth, retrieve only task-relevant context, and expand scope only when verified dependencies require it.",
    "",
    "## Instruction And Response Quality",
    "- Before delegating, suggesting a next instruction, or beginning non-trivial work, make a compact task packet with Goal, Context, Scope, Constraints, Requirements, and Done when criteria.",
    "- Read relevant instruction history chronologically from genesis, deduplicate it, preserve completed work, and target only unresolved, failed, or explicitly requested gaps.",
    "- For complex work, inspect evidence and make a short dependency-aware plan before editing. Use named files, UI nodes, APIs, and acceptance criteria instead of generic prose.",
    "- Lead every completion response with the outcome, then report evidence-backed files changed, behavior implemented, usable fallbacks or credential limits, and exact validation results.",
    "- Do not invent results, expose secrets, repeat raw history, or call functionality implemented until its end-to-end behavior is proven.",
    "",
    "## Delegated Execution Contract",
    "PlutoniX Fullstack Agent owns the parent task and completion criteria. This agent advises and executes only the bounded delegation supplied by PlutoniX.",
    "1. Classify each request as tiny, small, medium, or large before using tools.",
    "2. Inspect the smallest relevant set of files, symbols, routes, schemas, tests, and runtime state.",
    "3. Reuse project-local patterns and agents before creating a new specialist or abstraction.",
    "4. Produce an explicit, dependency-aware handoff for Gotham or Claude; never delegate an unverified path, API, import, schema, or command.",
    "5. Apply the narrowest complete change, preserve unrelated behavior, and validate in proportion to risk.",
    "6. Record topology changes only when ownership, services, data boundaries, or agent responsibilities actually change.",
    "",
    "## Context And Token Economy",
    "- Tiny: inspect up to 3 relevant files; no graph regeneration or specialist creation.",
    "- Small: inspect up to 8 relevant files; use existing agents and targeted validation.",
    "- Medium: perform focused dependency discovery; load only affected contracts and update topology if ownership changes.",
    "- Large: map architecture and risk first; use staged context, explicit review gates, and broader validation.",
    "- Summarize long logs and retrieved memory. Do not resend unchanged context between steps.",
    "- Stop discovery when the edit location, dependencies, acceptance criteria, and validation path are proven.",
    "",
    "## MCP Task Control",
    "- Treat MCP tools as scoped capabilities, not autonomous sources of truth.",
    "- Send the selected project ID, workspace, objective, constraints, relevant media, and acceptance criteria with every delegated task.",
    "- Prefer local project resources before remote retrieval. Verify external results against current files before editing.",
    "- Keep credentials and secrets out of prompts, logs, memory, graph artifacts, and generated source.",
    "- Require approval before destructive data changes, production deployment, credential mutation, or irreversible migration.",
    "",
    "## Product Shape Contract",
    "- Before selecting stack, routes, components, agents, or styling, consume the server-owned Product Shape Contract.",
    "- Preserve the selected artifact type, product shape, generation depth, interaction model, information density, navigation model, output paths, and prohibited defaults.",
    "- Choose the smallest complete solution. Do not turn artifacts, APIs, automations, scripts, or infrastructure into decorative web apps.",
    "- PlutoniX is a multi-artifact system. Preserve web, mobile, PDF, document, flyer, image, presentation, workbook, data, media, API, script, automation, and service requests as their real primary outputs.",
    "- Spreadsheet work must produce a real workbook or delimited-data artifact with required sheets, formulas, tables, formatting, validation, and recalculation evidence; an HTML table is not a workbook substitute.",
    "- Non-browser completion requires artifact-native evidence: parse/open success, requested output path, supplied-input consumption, and domain checks for layout, dimensions, formulas, media metadata, or executable contracts.",
    "- The Playground preview strategy must match the artifact: browser/device, PDF, image/print, workbook, document, presentation, code/data, audio, or video.",
    "- A dashboard requires a monitoring/comparison/triage job and real aggregation data. Enterprise language alone does not justify dashboard composition.",
    "- Do not add universal heroes, metric rows, card grids, sidebars, About/Contact routes, testimonials, or feature sections.",
    "- Route boundaries represent distinct user goals or operational domains. Site structure is decided only after artifact type and product shape.",
    "- Record why the selected shape is neither underbuilt nor overbuilt in generated metadata and validation evidence.",
    "",
    "## Standalone Containerization",
    "- This project must remain runnable outside PlutoniX with project-local Docker assets.",
    "- Maintain `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, and README Docker run instructions at the project root.",
    "- Docker assets must not depend on PlutoniX backend, PlutoniX frontend, MCP services, shared preview volumes, or PlutoniX-only environment variables unless explicitly required by the project.",
    "- When runtime dependencies, ports, build commands, or environment variables change, update the standalone Docker files in the same task.",
    "- If Docker cannot be executed in the current environment, validate file presence and syntax as far as possible and report that runtime validation was not run.",
    "",
    "## Hugging Face Model Workspace",
    "- Every generated project includes a project-local Hugging Face model workspace under `models/huggingface/`.",
    "- When a PlutoniX or project task requires a Hugging Face model, first register it in `models/huggingface/model-manifest.json` and download the complete repository locally, including all model weight files and shards, with `npm run hf:models:download -- <namespace/model>` or `node scripts/huggingface-models.mjs download <namespace/model>`.",
    "- If the task asks to search for a suitable Hugging Face model, record the selected repository ID and estimated repository size in GB in the manifest before implementation, inform the user of that size, then download the complete repository locally and read its model card.",
    "- Run `npm run hf:models:build` after downloads so `models/huggingface/services/` describes the local service boundary that backend or script code should use.",
    "- Prefer the local repository path over remote inference providers for generated-project functionality. Keep `HF_TOKEN` in the environment only and never write tokens into project files, logs, graphs, manifests, or prompts.",
    "- If the HF CLI or hardware is unavailable, leave the manifest, local service metadata, install/download commands, and clear runtime TODO hooks instead of silently switching to a paid remote provider.",
    "",
    "## What-Next Knowledge",
    "- Before selecting a substantial next development path, compare the instruction with prior project lessons and what-next knowledge when available.",
    "- Select the development path deterministically by scoring objective fit, required feature coverage, relevant feature expansion, feasibility, reuse, validation readiness, and token/time/cost efficiency.",
    "- Reject any path that violates user intent, safety, credentials/fallback constraints, standalone Docker portability, graph/vector/local-agent controls, or validation requirements.",
    "- Add relevant features only when they improve the end application objective without exceeding scope or weakening the requested behavior.",
    "- When screenshots, Figma frames, product images, or named-app UI references are supplied, treat visible UI nodes as functionality candidates. Map each prominent control, navigation item, panel, table, chart, editor, filter, tab, and command surface to behavior, state, data/API needs, validation criteria, or an explicit unavailable-integration fallback before completion.",
    "- Intel mode must expand from screenshot/UI nodes to functional workflows, using research or UI-exploration agents when available for known tools and product categories. Do not accept a visual clone whose prominent UI elements are decorative.",
    "- Record candidate paths, selected path, rejected paths, confidence, evidence, validation result, and follow-up recommendation under project memory when path choice changes.",
    "- If the correct path is unclear or materially changes architecture, cost, data handling, deployment, or user-facing behavior, activate the Human Agent choice-selection flow before continuing.",
    "- Human Agent choices must be stored as project knowledge and reused as decision evidence for similar future tasks.",
    "- Improve self-sustainability over time by reusing accumulated path decisions, validation outcomes, feature patterns, correction patterns, and agent efficiency signals.",
    "",
    "## Accuracy Gates",
    "- Files prove implementation state; memory and generated plans are guidance only.",
    "- Run the most focused available test or build after changes. Report any check that could not run.",
    "- A task is complete only when requested behavior is present, runtime impact is understood, and validation evidence exists.",
    "",
    ...qagenticContract,
    "## Project Context",
    `Objective: ${topology.instruction.objective || "Maintain and improve this application."}`,
    `Page type: ${topology.instruction.pageType || "managed_app_project"}`,
    `Product shape: ${topology.instruction.productDecision?.productShape || "preserve existing"}`,
    `Artifact type: ${topology.instruction.productDecision?.artifactType || "existing project"}`,
    `Interaction model: ${topology.instruction.productDecision?.interactionModel || "preserve existing"}`,
    `Generation depth: ${topology.instruction.productDecision?.generationDepth || "scoped"}`,
    `Topic: ${topology.instruction.topic || topology.project.name}`,
    `Sections: ${(topology.instruction.sections || []).join(", ") || "project, runtime, playground"}`,
    `Site structure: ${topology.instruction.siteStructure || "auto"}`,
    `Route plan: ${(topology.instruction.routePlan || []).map((route) => `${route.title || route.key} ${route.path}`).join(", ") || "single-page or project-defined"}`,
    "",
    "## Available Specialists",
    ...specialists.map((agent) => `- ${agent.name} (${agent.role}): ${agent.responsibility}`),
    "",
    "## System Support Agents",
    ...supportAgents.map((agent) => `- ${agent.name} (${agent.role}): ${agent.responsibility}`),
    "",
    "## Execution Handoff",
    "Gotham and Claude must follow the PlutoniX parent orchestration envelope. Use this file for project identity, specialist context, and local accuracy/token constraints without redefining the parent task.",
    ""
  ].join("\n");
  await fs.writeFile(path.join(policyDir, "orchestrator-agent.md"), policy);

  if (supportAgents.length) {
    await fs.ensureDir(path.join(policyDir, "qagentic-support"));
    await fs.writeFile(
      path.join(policyDir, "qagentic-support", "qagent-controller.md"),
      [
        "# Project-Local QAgent Controller",
        "",
        `project_id: ${topology.project.id}`,
        `project_name: ${topology.project.name}`,
        "",
        "## Role",
        "Inspect the previous agent response, compare it with the original objective, and produce a stop decision or one strict Next Instruction Packet.",
        "",
        "## Runtime Rule",
        "Generate runtime QAgents only for blocking or important objective gaps. Prefer existing specialists first.",
        "",
        "## Stop Rule",
        "Stop when the objective is complete, validation passes, only polish remains, human approval is required, or the iteration cap is reached.",
        ""
      ].join("\n")
    );
    await fs.writeFile(
      path.join(policyDir, "qagentic-support", "runtime-qagent-template.md"),
      [
        "# Runtime QAgent Template",
        "",
        "Runtime QAgents are temporary by default and must output only a Next Instruction Packet.",
        "",
        "Required fields: continue, completion_score, gap_summary, missing_items, next_agent_type, next_instruction, validation_required, memory_update, iteration_control.",
        ""
      ].join("\n")
    );
    await fs.writeJson(
      path.join(policyDir, "qagentic-support", "qagent-bootstrap.json"),
      {
        project_id: topology.project.id,
        project_name: topology.project.name,
        status: "generated",
        created_at: new Date().toISOString(),
        base_framework: true,
        runtime_qagents: "generate_only_when_objective_gap_detected"
      },
      { spaces: 2 }
    );
  }

  for (const agent of topology.agents) {
    const body = [
      `# ${agent.name}`,
      "",
      `agent_id: ${agent.id}`,
      `project_id: ${topology.project.id}`,
      `role: ${agent.role}`,
      "",
      "## Responsibility",
      agent.responsibility,
      "",
      "## Governing Policy",
      "Follow `../orchestrator-agent.md`. Return concise evidence, changed contracts, validation results, and unresolved risk to the project orchestrator.",
      ""
    ].join("\n");
    await fs.writeFile(path.join(localAgentsDir, `${agent.id}.agent.md`), body);
  }

  await writeManagedEntryFile(path.join(workspaceDir, "AGENTS.md"), "Gotham Project Entry");
  await writeManagedEntryFile(path.join(workspaceDir, "CLAUDE.md"), "Claude Project Entry");
}

function requiredSpecialists(structuredRequest = {}) {
  const sections = new Set(structuredRequest.sections || []);
  const productDecision = structuredRequest.productDecision || {};
  const agents = [];

  if (productDecision.productShape === "artifact_only") {
    agents.push({
      key: "artifact-production",
      name: "Artifact Production Agent",
      responsibility: `Produce and validate the requested ${productDecision.artifactType || "artifact"} as the primary deliverable without substituting an app shell.`
    });
  } else if (productDecision.productShape === "service_or_automation") {
    agents.push(
      {
        key: "service-runtime",
        name: "Service Runtime Agent",
        responsibility: `Implement the ${productDecision.artifactType || "service"} entrypoint, contracts, configuration, and failure behavior.`
      },
      {
        key: "service-validation",
        name: "Service Validation Agent",
        responsibility: "Validate inputs, outputs, schemas, executable behavior, and task-specific packaging."
      }
    );
  } else {
    agents.push(
      {
        key: "experience-composition",
        name: "Experience Composition Agent",
        responsibility: `Implement the ${productDecision.interactionModel || "workflow application"} using domain-specific information density, navigation, controls, and responsive states.`
      },
      {
        key: "data-contract",
        name: "Data Contract Agent",
        responsibility: "Define real data sources, persistence boundaries, supplied-input provenance, and explicit empty/loading/error states."
      }
    );
  }

  agents.push({
    key: "runtime-packaging",
    name: "Runtime Packaging Agent",
    responsibility: "Maintain only the runtime, dependency, export, and container assets justified by the selected artifact and product shape."
  });

	  if (["production_application", "deep_complex_platform"].includes(productDecision.productShape)) {
	    agents.push({
	      key: "application-architecture",
	      name: "Application Architecture Agent",
	      responsibility: "Implement durable workflow, persistence, integration, and recovery boundaries required by the Product Shape Contract."
	    });
	  }
	  if (needsDesignWorkshopAgent(structuredRequest, productDecision)) {
	    agents.push({
	      key: "design-workshop-review",
	      name: "Design Workshop Review Agent",
	      responsibility: "Periodically review growing UI/UX surfaces with design strategy, frontend implementation, accessibility, responsive behavior, visual hierarchy, command placement, and professional aesthetic quality while preserving all existing functionality."
	    });
	  }
	  if (productDecision.productShape === "deep_complex_platform" || productDecision.complexity?.dimensions?.governance >= 2) {
	    agents.push({
	      key: "governance-security",
      name: "Governance and Security Agent",
      responsibility: "Validate role, permission, approval, audit, compliance, and sensitive-data boundaries."
    });
  }

  if (sections.has("catalog") || sections.has("materials") || String(structuredRequest.pageType || "").includes("commerce")) {
    agents.push({
      key: "commerce-catalog",
      name: "Commerce Catalog Agent",
      responsibility: "Model product catalog sections, material details, product imagery hooks, and storefront conversion paths."
    });
  }
  if (sections.has("pricing")) {
    agents.push({
      key: "pricing-conversion",
      name: "Pricing Conversion Agent",
      responsibility: "Create pricing, plan comparison, offer framing, and conversion CTA structure."
    });
  }
  if (productDecision.interactionModel === "monitoring_dashboard") {
    agents.push({
      key: "analytics-dashboard",
      name: "Analytics Dashboard Agent",
      responsibility: "Model real monitoring signals, trends, exceptions, filters, and dense triage states without invented metrics."
    });
  }
  if ((structuredRequest.media || []).length) {
    agents.push({
      key: "media-asset",
      name: "Media Asset Agent",
      responsibility: "Track uploaded media references, identify screenshot/UI reference nodes, and expose each prominent node as a functional implementation or explicit fallback requirement."
    });
    agents.push({
      key: "ui-functionality-mapper",
      name: "UI Functionality Mapper Agent",
      responsibility: "Convert screenshots, Figma frames, product images, and named-app visual references into a ui_node_to_functionality map with behavior, state, data/API contracts, and validation criteria."
    });
  }

  return agents;
}

export function buildProjectAgentTopology(project, structuredRequest = {}) {
  const projectSlug = sanitizeAgentId(project.folderName || project.name || project.id);
  const projectDisplayName = titleCase(project.name || projectSlug);
  const orchestratorAgentId = `${projectSlug}-orchestrator-agent`;
  const specialistAgents = requiredSpecialists(structuredRequest).map((agent) => ({
    id: `${projectSlug}-${agent.key}-agent`,
    name: `${projectDisplayName} ${agent.name}`,
    role: agent.key,
    responsibility: agent.responsibility,
    source: "instruction-derived",
    projectId: project.id,
    projectName: project.name
  }));

  const orchestrator = {
    id: orchestratorAgentId,
    name: `${projectDisplayName} Orchestrator Agent`,
    role: "project-orchestrator",
    responsibility: "Read the project instruction, decide required specialist agents, and coordinate Gotham workflow handoff.",
    source: "project-create",
    projectId: project.id,
    projectName: project.name
  };

  const qagentController = {
    id: `${projectSlug}-qagent-controller`,
    name: `${projectDisplayName} QAgent Controller`,
    role: "qagent-controller",
    responsibility: "Evaluate end-of-response objective gaps and produce stop decisions or strict next-instruction packets without directly implementing code.",
    source: "project-create-qagentic",
    projectId: project.id,
    projectName: project.name
  };

  return {
    project: {
      id: project.id,
      name: project.name,
      folderName: project.folderName,
      workspaceDir: project.workspaceDir,
      port: project.port,
      previewUrl: project.previewUrl
    },
    instruction: {
      hash: structuredRequest.instructionHash,
      objective: structuredRequest.objective,
      pageType: structuredRequest.pageType,
      topic: structuredRequest.topic,
      sections: structuredRequest.sections || [],
      siteStructure: structuredRequest.siteStructure,
      routePlan: structuredRequest.routePlan || [],
      complexityScaling: structuredRequest.complexityScaling || null,
      productDecision: structuredRequest.productDecision || null
    },
    agents: [orchestrator, qagentController, ...specialistAgents],
    relationships: [
      {
        source: "plutonix-fullstack-agent",
        target: orchestrator.id,
        type: "RUNTIME_DELEGATES_TO"
      },
      {
        source: project.id,
        target: orchestrator.id,
        type: "HAS_ORCHESTRATOR"
      },
      {
        source: orchestrator.id,
        target: qagentController.id,
        type: "USES_QAGENT_CONTROLLER"
      },
      ...specialistAgents.map((agent) => ({
        source: orchestrator.id,
        target: agent.id,
        type: "DELEGATES_TO"
      }))
    ],
    createdAt: new Date().toISOString()
  };
}

async function readProjectAgentTopologies() {
  const root = agentRuntimeRoot();
  if (!(await fs.pathExists(root))) return [];
  const files = (await fs.readdir(root)).filter((file) => file.endsWith(".agents.json"));
  const topologies = [];
  for (const file of files) {
    try {
      topologies.push(await fs.readJson(path.join(root, file)));
    } catch {
      // Ignore partial files and keep the graph readable.
    }
  }
  return topologies;
}

async function readDeletedAgentIds() {
  if (!(await fs.pathExists(deletedAgentsPath()))) return new Set();
  const rows = await fs.readJson(deletedAgentsPath()).catch(() => []);
  return new Set((Array.isArray(rows) ? rows : []).map((row) => row?.agentId).filter(Boolean));
}

function withoutDeletedAgents(topology, deletedAgentIds) {
  if (!deletedAgentIds.size) return topology;
  return {
    ...topology,
    agents: (topology.agents || []).filter((agent) => !deletedAgentIds.has(agent.id)),
    relationships: (topology.relationships || []).filter(
      (relationship) => !deletedAgentIds.has(relationship.source) && !deletedAgentIds.has(relationship.target)
    )
  };
}

async function recordDeletedAgent(agentId, metadata = {}) {
  const existing = (await fs.pathExists(deletedAgentsPath()))
    ? await fs.readJson(deletedAgentsPath()).catch(() => [])
    : [];
  const rows = (Array.isArray(existing) ? existing : []).filter((row) => row?.agentId !== agentId);
  rows.push({
    agentId,
    project: metadata.project || "",
    sourcePath: metadata.sourcePath || "",
    deletedAt: new Date().toISOString()
  });
  await fs.ensureDir(path.dirname(deletedAgentsPath()));
  await fs.writeJson(deletedAgentsPath(), rows, { spaces: 2 });
}

async function refreshProjectAgentGraphs() {
  const topologies = await readProjectAgentTopologies();
  await writeGeneratedNeo4jSeed(topologies);
  const graph = await buildAgenticSystemGraph();
  await fs.ensureDir(path.dirname(topologyGraphPath()));
  await fs.writeJson(topologyGraphPath(), graph, { spaces: 2 });
  await fs.ensureDir(path.dirname(frontendGraphPath()));
  await fs.writeJson(frontendGraphPath(), graph, { spaces: 2 });
}

async function writeAgentMarkdown(topology) {
  await fs.ensureDir(generatedAgentsRoot());
  for (const agent of topology.agents) {
    const body = [
      `# ${agent.name}`,
      "",
      `agent_id: "${agent.id}"`,
      `project_id: "${topology.project.id}"`,
      `project_name: "${topology.project.name}"`,
      `role: "${agent.role}"`,
      `source: "${agent.source}"`,
      "",
      "## Responsibility",
      agent.responsibility,
      "",
      "## Instruction Context",
      `Objective: ${topology.instruction.objective || "Not specified"}`,
      `Page type: ${topology.instruction.pageType || "unknown"}`,
      `Topic: ${topology.instruction.topic || "unknown"}`,
      `Sections: ${(topology.instruction.sections || []).join(", ") || "none"}`,
      ""
    ].join("\n");
    await fs.writeFile(path.join(generatedAgentsRoot(), `${agent.id}.agent.md`), body);
  }
}

async function writeGeneratedNeo4jSeed(topologies) {
  await fs.ensureDir(path.dirname(generatedGraphPath()));
  const lines = [
    "// Generated by PlutoniX project-agent registry.",
    "// This file keeps managed app projects related to their project-scoped agents.",
    "MERGE (:Agent {id: 'plutonix-fullstack-agent', name: 'PlutoniX Fullstack Agent', role: 'global-orchestrator', status: 'active'})",
    "MERGE (:Agent {id: 'plutonix-independent-reviewer', name: 'PlutoniX Independent Reviewer', role: 'reviewer', status: 'available', read_only: true})",
    "MATCH (o:Agent {id: 'plutonix-fullstack-agent'}), (r:Agent {id: 'plutonix-independent-reviewer'}) MERGE (o)-[:MAY_REQUEST_REVIEW_FROM {adaptive: true}]->(r)",
    ""
  ];
  for (const topology of topologies) {
    const projectId = `project:${topology.project.id}`;
    lines.push(
      `MERGE (p:Project {id: '${projectId}'})`,
      `SET p.name = ${JSON.stringify(topology.project.name)}, p.folder_name = ${JSON.stringify(topology.project.folderName)}, p.workspace_dir = ${JSON.stringify(topology.project.workspaceDir)}, p.port = ${Number(topology.project.port || 0)}`
    );
    for (const agent of topology.agents) {
      lines.push(
        `MERGE (a:Agent {id: ${JSON.stringify(agent.id)}})`,
        `SET a.name = ${JSON.stringify(agent.name)}, a.role = ${JSON.stringify(agent.role)}, a.project_id = ${JSON.stringify(topology.project.id)}, a.status = 'active'`,
        "MERGE (p)-[:OWNS]->(a)"
      );
    }
    for (const relationship of topology.relationships) {
      if (relationship.type === "RUNTIME_DELEGATES_TO") {
        lines.push(`MATCH (a:Agent {id: ${JSON.stringify(relationship.source)}}), (b:Agent {id: ${JSON.stringify(relationship.target)}}) MERGE (a)-[:RUNTIME_DELEGATES_TO]->(b)`);
      }
      if (relationship.type === "HAS_ORCHESTRATOR") {
        lines.push(`MATCH (p:Project {id: '${projectId}'}), (a:Agent {id: ${JSON.stringify(relationship.target)}}) MERGE (p)-[:HAS_ORCHESTRATOR]->(a)`);
      }
      if (relationship.type === "DELEGATES_TO") {
        lines.push(`MATCH (a:Agent {id: ${JSON.stringify(relationship.source)}}), (b:Agent {id: ${JSON.stringify(relationship.target)}}) MERGE (a)-[:DELEGATES_TO]->(b)`);
      }
      if (relationship.type === "USES_QAGENT_CONTROLLER") {
        lines.push(`MATCH (a:Agent {id: ${JSON.stringify(relationship.source)}}), (b:Agent {id: ${JSON.stringify(relationship.target)}}) MERGE (a)-[:USES_QAGENT_CONTROLLER]->(b)`);
      }
    }
    lines.push("");
  }
  await fs.writeFile(generatedGraphPath(), `${lines.join("\n")}\n`);
}

function graphRowsForTopology(topology) {
  const projectNodeId = `project:${topology.project.id}`;
  const nodes = [
    {
      id: "agent:plutonix-fullstack-agent",
      type: "agent",
      label: "PlutoniX Fullstack Agent",
      group: "global-agent",
      risk_level: "medium",
      status: "active",
      agent_id: "plutonix-fullstack-agent",
      cluster_id: "plutonix-fullstack",
      metadata: {
        dynamicProjectGraph: true,
        role: "global-plutonix-orchestrator",
        domain: "fullstack",
        responsibility: "Owns the PlutoniX control surface, backend generation API, and project creation handoff.",
        description: "Global PlutoniX agent that creates and delegates to project-local orchestrators."
      }
    },
    {
      id: projectNodeId,
      type: "project",
      label: topology.project.name,
      group: "project",
      risk_level: "medium",
      status: "managed",
      agent_id: "",
      cluster_id: "",
      metadata: {
        dynamicProjectGraph: true,
        projectId: topology.project.id,
        folderName: topology.project.folderName,
        workspaceDir: topology.project.workspaceDir,
        port: topology.project.port,
        previewUrl: topology.project.previewUrl,
        description: topology.instruction.objective || `Managed PlutoniX project for ${topology.project.name}.`
      }
    },
    {
      id: "agent:plutonix-independent-reviewer",
      type: "agent",
      label: "PlutoniX Independent Reviewer",
      group: "review-agent",
      risk_level: "low",
      status: "available",
      agent_id: "plutonix-independent-reviewer",
      cluster_id: "adaptive-review",
      metadata: { dynamicProjectGraph: true, readOnly: true, adaptive: true }
    },
    ...topology.agents.map((agent) => ({
      id: `agent:${agent.id}`,
      type: "agent",
      label: agent.name,
      group: agent.role === "qagent-controller" ? "system-support-agent" : "project-agent",
      risk_level: agent.role === "project-orchestrator" ? "medium" : "low",
      status: "active",
      agent_id: agent.id,
      cluster_id: agent.role,
      metadata: {
        dynamicProjectGraph: true,
        projectId: topology.project.id,
        projectName: topology.project.name,
        supportAgent: agent.role === "qagent-controller",
        responsibility: agent.responsibility,
        description: agent.responsibility
      }
    }))
  ];
  const links = [
    {
      source: "agent:plutonix-fullstack-agent",
      target: projectNodeId,
      type: "creates_project",
      weight: 2,
      metadata: { dynamicProjectGraph: true, projectId: topology.project.id }
    },
    {
      source: "agent:plutonix-fullstack-agent",
      target: "agent:plutonix-independent-reviewer",
      type: "may_request_review_from",
      weight: 1,
      metadata: { dynamicProjectGraph: true, adaptive: true, readOnly: true }
    },
    ...topology.relationships.map((relationship) => ({
      source: relationship.type === "HAS_ORCHESTRATOR" ? projectNodeId : `agent:${relationship.source}`,
      target: `agent:${relationship.target}`,
      type: relationship.type.toLowerCase(),
      weight: relationship.type === "HAS_ORCHESTRATOR" ? 2 : 1,
      metadata: { dynamicProjectGraph: true, projectId: topology.project.id }
    }))
  ];
  return { nodes, links };
}

function mergeNodesById(nodes) {
  const merged = new Map();
  for (const node of nodes) {
    if (!node?.id) continue;
    const current = merged.get(node.id);
    merged.set(node.id, current ? { ...current, ...node, metadata: { ...(current.metadata || {}), ...(node.metadata || {}) } } : node);
  }
  return Array.from(merged.values());
}

async function selfImprovementGraphRows() {
  const runtimeRoot = selfImprovementRuntimeRoot();
  const [status, proposals, patterns, validations, promotions, rollbacks, investigations, researchLogs, toolPlans, monetaryApprovals, marketVision, hfModelPoolStatus] = await Promise.all([
    fs.pathExists(path.join(projectRoot(), "observability", "self-improvement", "latest-status.json"))
      .then((exists) => exists ? fs.readJson(path.join(projectRoot(), "observability", "self-improvement", "latest-status.json")) : null)
      .catch(() => null),
    readJsonLineRecords(path.join(runtimeRoot, "proposals", "proposals.jsonl"), 12),
    readJsonLineRecords(path.join(runtimeRoot, "patterns", "patterns.jsonl"), 12),
    readJsonLineRecords(path.join(runtimeRoot, "validations", "validation-runs.jsonl"), 12),
    readJsonLineRecords(path.join(runtimeRoot, "promotions", "promotion-decisions.jsonl"), 12),
    readJsonLineRecords(path.join(runtimeRoot, "rollbacks", "rollback-events.jsonl"), 12),
    readJsonLineRecords(path.join(runtimeRoot, "investigations", "investigator-decisions.jsonl"), 12),
    readJsonLineRecords(path.join(runtimeRoot, "research", "research-agent-usage.jsonl"), 12),
    readJsonLineRecords(path.join(runtimeRoot, "tools", "tool-incorporation-plans.jsonl"), 12),
    readJsonLineRecords(path.join(runtimeRoot, "approvals", "monetary-approvals.jsonl"), 12),
    fs.pathExists(path.join(runtimeRoot, "market-vision", "agentic-builderx-market-differentiation.json"))
      .then((exists) => exists ? fs.readJson(path.join(runtimeRoot, "market-vision", "agentic-builderx-market-differentiation.json")) : null)
      .catch(() => null),
    fs.pathExists(path.join(projectRoot(), "observability", "model-pool", "huggingface-latest.json"))
      .then((exists) => exists ? fs.readJson(path.join(projectRoot(), "observability", "model-pool", "huggingface-latest.json")) : null)
      .catch(() => null)
  ]);
  const metadata = { dynamicSelfImprovementGraph: true };
  const researchAgentNodes = [
    {
      id: "agent:plutonix-competitive-tools-research-agent",
      label: "Competitive Tools Research Agent",
      role: "competitive-tool-scout"
    },
    {
      id: "agent:plutonix-literature-research-agent",
      label: "Literature Research Agent",
      role: "research-paper-scout"
    },
    {
      id: "agent:plutonix-marketplace-research-agent",
      label: "Marketplace Research Agent",
      role: "marketplace-signal-scout"
    }
  ];
  const nodes = [
    {
      id: "system:plutonix",
      type: "system",
      label: "PlutoniX System",
      group: "platform",
      risk_level: "medium",
      status: "managed",
      metadata: {
        ...metadata,
        description: "The platform repository and orchestration runtime selected through Gotham's system target."
      }
    },
    {
      id: "self-improvement:observer",
      type: "service",
      label: "Improvement Observer",
      group: "self-improvement",
      risk_level: "low",
      status: status?.status || "configured",
      metadata: { ...metadata, description: "Non-blocking signal observer for runtime logs, health reports, and Gotham system instructions." }
    },
    {
      id: "agent:plutonix-self-improvement-investigator-agent",
      type: "agent",
      label: "Self-Improvement Investigator Agent",
      group: "self-improvement",
      risk_level: "low",
      status: investigations.some((row) => row.shouldTrigger) ? "escalated" : "watching",
      agent_id: "plutonix-self-improvement-investigator-agent",
      cluster_id: "self-improvement",
      metadata: { ...metadata, description: "Checks every logged event for quality, efficiency, security, UI friction, and repeated failure signals." }
    },
    {
      id: "agent:plutonix-tool-capability-agent",
      type: "agent",
      label: "Tool Capability Agent",
      group: "self-improvement",
      risk_level: "low",
      status: toolPlans.length ? "planning" : "available",
      agent_id: "plutonix-tool-capability-agent",
      cluster_id: "self-improvement",
      metadata: { ...metadata, description: "Detects missing tools, sluggishness, and workflow complexity from logged evidence." }
    },
    {
      id: "agent:plutonix-autonomous-tool-builder-agent",
      type: "agent",
      label: "Autonomous Tool Builder Agent",
      group: "self-improvement",
      risk_level: "medium",
      status: toolPlans.some((row) => row.status === "ready_for_candidate") ? "building_candidates" : "gated",
      agent_id: "plutonix-autonomous-tool-builder-agent",
      cluster_id: "self-improvement",
      metadata: { ...metadata, description: "Builds safe generated-tool candidates and routes paid capability requests to approval." }
    },
    {
      id: "self-improvement:monetary-approval-gate",
      type: "approval-gate",
      label: "Monetary Approval Gate",
      group: "self-improvement",
      risk_level: "high",
      status: monetaryApprovals.some((row) => row.status === "pending") ? "pending" : "idle",
      metadata: { ...metadata, description: "Requires user approval before paid tools, subscriptions, cloud services, GPU usage, or external APIs." }
    },
    {
      id: "self-improvement:aggregator",
      type: "service",
      label: "Signal Aggregator",
      group: "self-improvement",
      risk_level: "low",
      status: "active",
      metadata: { ...metadata, description: "Groups repeated or similar improvement signals before investigation." }
    },
    {
      id: "self-improvement:planner",
      type: "service",
      label: "Proposal Planner",
      group: "self-improvement",
      risk_level: "medium",
      status: "gated",
      metadata: { ...metadata, description: "Converts evidence-backed analyses into testable improvement proposals." }
    },
    {
      id: "self-improvement:validation",
      type: "service",
      label: "Validation and Review",
      group: "self-improvement",
      risk_level: "medium",
      status: "required",
      metadata: { ...metadata, description: "Checks feature preservation, isolation, rollback, and independent review readiness." }
    },
    {
      id: "model-pool:huggingface",
      type: "service",
      label: "Hugging Face Model Pool",
      group: "model-pool",
      risk_level: "medium",
      status: hfModelPoolStatus?.downloaded ? "available" : hfModelPoolStatus?.planned ? "planned" : "configured",
      metadata: {
        ...metadata,
        dynamicModelPoolGraph: true,
        downloaded: hfModelPoolStatus?.downloaded || 0,
        planned: hfModelPoolStatus?.planned || 0,
        failed: hfModelPoolStatus?.failed || 0,
        services: hfModelPoolStatus?.services || 0,
        poolRoot: hfModelPoolStatus?.poolRoot || "",
        description: "Downloads Hugging Face model repositories locally, stores model cards, registers local services, and tracks model-pool performance."
      }
    },
    {
      id: "model-pool:huggingface-local-services",
      type: "service",
      label: "Local HF Services",
      group: "model-pool",
      risk_level: "medium",
      status: hfModelPoolStatus?.services ? "registered" : "idle",
      metadata: {
        ...metadata,
        dynamicModelPoolGraph: true,
        serviceCount: hfModelPoolStatus?.services || 0,
        averageDownloadMs: hfModelPoolStatus?.performance?.averageDownloadMs || 0,
        description: "Local service registry for downloaded Hugging Face models used by small PlutoniX and self-improvement tasks."
      }
    },
    ...researchAgentNodes.map((agent) => ({
      id: agent.id,
      type: "agent",
      label: agent.label,
      group: "self-improvement-research",
      risk_level: "low",
      status: researchLogs.length ? "budget_logged" : "available",
      agent_id: agent.id.replace(/^agent:/, ""),
      cluster_id: "self-improvement-research",
      metadata: { ...metadata, role: agent.role, description: "Optional bounded exploration agent controlled by orchestrator research budgets." }
    })),
    ...(marketVision ? [
      {
        id: "self-improvement:market-vision",
        type: "knowledge",
        label: "Market Vision Source",
        group: "self-improvement-market",
        risk_level: "low",
        status: "ingested",
        metadata: {
          ...metadata,
          sourcePath: marketVision.source?.path,
          supplementalConversationUrl: marketVision.source?.supplementalConversationUrl,
          description: marketVision.positioning?.oneSentence || marketVision.positioning?.coreMoat
        }
      },
      ...(marketVision.marketReadyPillars || []).map((pillar) => ({
        id: `self-improvement:market-pillar:${pillar.id}`,
        type: "objective",
        label: pillar.label,
        group: "self-improvement-market",
        risk_level: "low",
        status: "planned",
        metadata: {
          ...metadata,
          owner: pillar.agentOwner,
          proofKpi: pillar.proofKpi,
          description: pillar.goal
        }
      })),
      ...(marketVision.investorDiscoveryPlan ? [
        {
          id: "self-improvement:investor-discovery",
          type: "objective",
          label: "Investor Discovery Approach",
          group: "self-improvement-market",
          risk_level: "medium",
          status: "planned",
          metadata: {
            ...metadata,
            owner: marketVision.investorDiscoveryPlan.agentOwner,
            supportingAgents: marketVision.investorDiscoveryPlan.supportingAgents,
            successMetrics: marketVision.investorDiscoveryPlan.successMetrics,
            standardDiscoveryWorkflow: marketVision.investorDiscoveryPlan.standardDiscoveryWorkflow,
            linkedinOperatingRules: marketVision.investorDiscoveryPlan.linkedinOperatingRules,
            manualLinkedInWindow: marketVision.investorDiscoveryPlan.manualLinkedInWindow,
            automaticApifyWindow: marketVision.investorDiscoveryPlan.automaticApifyWindow,
            apolloApiUsage: marketVision.investorDiscoveryPlan.apolloApiUsage,
            description: marketVision.investorDiscoveryPlan.objective
          }
        }
      ] : []),
      ...((marketVision.checkpointTimeline?.checkpoints || []).map((checkpoint) => ({
        id: `self-improvement:checkpoint:${checkpoint.id}`,
        type: "milestone",
        label: checkpoint.label,
        group: "self-improvement-market",
        risk_level: "medium",
        status: checkpoint.status || "planned",
        metadata: {
          ...metadata,
          owner: checkpoint.owner,
          deadline: checkpoint.deadline,
          deliverables: checkpoint.deliverables,
          exitCriteria: checkpoint.exitCriteria,
          description: `${checkpoint.label} due ${checkpoint.deadline}`
        }
      })))
    ] : [])
  ];
  const links = [
    { source: "system:plutonix", target: "agent:plutonix-self-improvement-investigator-agent", type: "streams_logged_events_to", weight: 2, metadata },
    { source: "agent:plutonix-self-improvement-investigator-agent", target: "self-improvement:observer", type: "emits_problem_signal_to", weight: 2, metadata },
    { source: "agent:plutonix-self-improvement-investigator-agent", target: "self-improvement:planner", type: "can_trigger_proposal_for", weight: 2, metadata },
    { source: "agent:plutonix-self-improvement-investigator-agent", target: "agent:plutonix-tool-capability-agent", type: "shares_quality_context_with", weight: 2, metadata },
    { source: "agent:plutonix-tool-capability-agent", target: "agent:plutonix-autonomous-tool-builder-agent", type: "requests_tool_build_from", weight: 2, metadata },
    { source: "agent:plutonix-autonomous-tool-builder-agent", target: "self-improvement:monetary-approval-gate", type: "requires_cost_gate_when_paid", weight: 2, metadata },
    { source: "agent:plutonix-autonomous-tool-builder-agent", target: "self-improvement:planner", type: "feeds_tool_output_to", weight: 1, metadata },
    { source: "self-improvement:observer", target: "self-improvement:aggregator", type: "emits_signals_to", weight: 2, metadata },
    { source: "self-improvement:aggregator", target: "self-improvement:planner", type: "triggers_proposals_for", weight: 2, metadata },
    { source: "self-improvement:planner", target: "self-improvement:validation", type: "requires_validation_by", weight: 2, metadata },
    { source: "self-improvement:planner", target: "system:plutonix", type: "may_improve", weight: 1, metadata },
    { source: "system:plutonix", target: "model-pool:huggingface", type: "owns_local_model_pool", weight: 2, metadata },
    { source: "model-pool:huggingface", target: "model-pool:huggingface-local-services", type: "registers_local_services_for", weight: 2, metadata },
    { source: "model-pool:huggingface-local-services", target: "self-improvement:planner", type: "serves_small_self_improvement_tasks_for", weight: 2, metadata },
    ...researchAgentNodes.flatMap((agent) => [
      { source: "self-improvement:planner", target: agent.id, type: "authorizes_research_budget_for", weight: 1, metadata },
      { source: agent.id, target: "self-improvement:planner", type: "returns_bounded_findings_to", weight: 1, metadata }
    ]),
    ...(marketVision ? [
      { source: "self-improvement:market-vision", target: "self-improvement:planner", type: "guides_roadmap_for", weight: 2, metadata },
      { source: "self-improvement:market-vision", target: "agent:plutonix-marketplace-research-agent", type: "guides_research_for", weight: 2, metadata },
      { source: "self-improvement:market-vision", target: "agent:plutonix-competitive-tools-research-agent", type: "guides_research_for", weight: 2, metadata },
      { source: "self-improvement:market-vision", target: "agent:plutonix-literature-research-agent", type: "guides_research_for", weight: 2, metadata },
      ...(marketVision.marketReadyPillars || []).map((pillar) => ({
        source: "self-improvement:market-vision",
        target: `self-improvement:market-pillar:${pillar.id}`,
        type: "defines_market_ready_pillar",
        weight: 1,
        metadata
      })),
      ...(marketVision.investorDiscoveryPlan ? [
        { source: "self-improvement:market-vision", target: "self-improvement:investor-discovery", type: "defines_investor_discovery_plan", weight: 2, metadata },
        { source: "self-improvement:investor-discovery", target: "agent:plutonix-marketplace-research-agent", type: "assigns_research_to", weight: 2, metadata },
        { source: "self-improvement:investor-discovery", target: "self-improvement:planner", type: "feeds_validated_outreach_experiments_to", weight: 1, metadata }
      ] : []),
      ...((marketVision.checkpointTimeline?.checkpoints || []).map((checkpoint) => ({
        source: "self-improvement:market-vision",
        target: `self-improvement:checkpoint:${checkpoint.id}`,
        type: "defines_checkpoint_deadline",
        weight: 1,
        metadata
      })))
    ] : [])
  ];

  for (const investigation of investigations.slice(-6)) {
    const investigationNodeId = `self-improvement:investigation:${investigation.id}`;
    nodes.push({
      id: investigationNodeId,
      type: "investigation",
      label: investigation.shouldTrigger ? "Investigator problem statement" : investigation.component || "Event check",
      group: "self-improvement-investigation",
      risk_level: investigation.severity || "low",
      status: investigation.shouldTrigger ? "triggered" : "checked",
      metadata: {
        ...metadata,
        investigationId: investigation.id,
        eventType: investigation.eventType,
        component: investigation.component,
        qualityScore: investigation.qualityScore,
        relatedCount: investigation.relatedCount,
        randomAuditSelected: investigation.randomAuditSelected
      }
    });
    links.push(
      { source: "agent:plutonix-self-improvement-investigator-agent", target: investigationNodeId, type: "records", weight: 1, metadata },
      ...(investigation.shouldTrigger ? [{ source: investigationNodeId, target: "self-improvement:planner", type: "sends_problem_statement_to", weight: 2, metadata }] : [])
    );
  }

  for (const researchLog of researchLogs.slice(-4)) {
    const researchNodeId = `self-improvement:research:${researchLog.id}`;
    nodes.push({
      id: researchNodeId,
      type: "research-budget",
      label: researchLog.status || "Research budget",
      group: "self-improvement-research",
      risk_level: researchLog.status === "ready_for_bounded_exploration" ? "medium" : "low",
      status: researchLog.status || "recorded",
      metadata: {
        ...metadata,
        researchLogId: researchLog.id,
        reason: researchLog.reason,
        topic: researchLog.topic,
        budget: researchLog.budget
      }
    });
    links.push({ source: "self-improvement:planner", target: researchNodeId, type: "monitors_research_budget", weight: 1, metadata });
  }

  for (const toolPlan of toolPlans.slice(-5)) {
    const toolPlanNodeId = `self-improvement:tool-plan:${toolPlan.id}`;
    nodes.push({
      id: toolPlanNodeId,
      type: "tool-plan",
      label: toolPlan.proposedTool?.name || toolPlan.solutionKind || "Tool plan",
      group: "self-improvement-tooling",
      risk_level: toolPlan.monetaryApprovalRequired ? "high" : toolPlan.severity || "medium",
      status: toolPlan.status || "planned",
      metadata: {
        ...metadata,
        toolPlanId: toolPlan.id,
        solutionKind: toolPlan.solutionKind,
        component: toolPlan.component,
        monetaryApprovalRequired: toolPlan.monetaryApprovalRequired,
        costEstimate: toolPlan.costEstimate
      }
    });
    links.push(
      { source: "agent:plutonix-tool-capability-agent", target: toolPlanNodeId, type: "plans", weight: 1, metadata },
      { source: toolPlanNodeId, target: toolPlan.monetaryApprovalRequired ? "self-improvement:monetary-approval-gate" : "agent:plutonix-autonomous-tool-builder-agent", type: toolPlan.monetaryApprovalRequired ? "awaits_approval_from" : "can_be_built_by", weight: 2, metadata }
    );
  }

  for (const approval of monetaryApprovals.slice(-5)) {
    const approvalNodeId = `self-improvement:monetary-approval:${approval.id}`;
    nodes.push({
      id: approvalNodeId,
      type: "monetary-approval",
      label: approval.status || "Cost approval",
      group: "self-improvement-approval",
      risk_level: approval.status === "pending" ? "high" : "medium",
      status: approval.status || "pending",
      metadata: {
        ...metadata,
        approvalId: approval.id,
        toolPlanId: approval.toolPlanId,
        decision: approval.decision,
        costEstimate: approval.costEstimate
      }
    });
    links.push({ source: "self-improvement:monetary-approval-gate", target: approvalNodeId, type: "records_decision_for", weight: 1, metadata });
  }

  for (const pattern of patterns.slice(-6)) {
    const patternNodeId = `self-improvement:pattern:${pattern.id}`;
    nodes.push({
      id: patternNodeId,
      type: "pattern",
      label: pattern.component || pattern.kind || "Signal pattern",
      group: "self-improvement-pattern",
      risk_level: pattern.severity || "medium",
      status: pattern.status || "aggregated",
      metadata: { ...metadata, patternId: pattern.id, signalCount: pattern.signalCount, confidence: pattern.confidence }
    });
    links.push({ source: "self-improvement:aggregator", target: patternNodeId, type: "detects", weight: 1, metadata });
  }

  for (const proposal of proposals.slice(-8)) {
    const proposalNodeId = `self-improvement:proposal:${proposal.id}`;
    nodes.push({
      id: proposalNodeId,
      type: "proposal",
      label: proposal.title || proposal.id,
      group: "self-improvement-proposal",
      risk_level: proposal.riskLevel || "medium",
      status: proposal.status || "proposed",
      metadata: {
        ...metadata,
        proposalId: proposal.id,
        category: proposal.category,
        expectedBenefit: proposal.expectedBenefit,
        affectedFeatures: proposal.affectedFeatures || []
      }
    });
    links.push(
      { source: "self-improvement:planner", target: proposalNodeId, type: "creates", weight: 2, metadata },
      { source: proposalNodeId, target: "system:plutonix", type: "affects_component", weight: 1, metadata },
      { source: proposalNodeId, target: "self-improvement:validation", type: "must_pass", weight: 2, metadata }
    );
  }

  for (const validation of validations.slice(-6)) {
    const validationNodeId = `self-improvement:validation:${validation.id}`;
    nodes.push({
      id: validationNodeId,
      type: "validation",
      label: validation.status || "Validation",
      group: "self-improvement-validation",
      risk_level: validation.passed ? "low" : "high",
      status: validation.status || "validated",
      metadata: { ...metadata, validationId: validation.id, proposalId: validation.proposalId, passed: validation.passed }
    });
    links.push({ source: "self-improvement:validation", target: validationNodeId, type: "records", weight: 1, metadata });
  }

  for (const promotion of promotions.slice(-4)) {
    const promotionNodeId = `self-improvement:promotion:${promotion.id}`;
    nodes.push({
      id: promotionNodeId,
      type: "promotion",
      label: promotion.decision || promotion.status || "Promotion decision",
      group: "self-improvement-promotion",
      risk_level: promotion.decision === "promote" ? "low" : "medium",
      status: promotion.status || "skipped",
      metadata: { ...metadata, promotionId: promotion.id, proposalId: promotion.proposalId, decision: promotion.decision }
    });
    links.push({ source: "self-improvement:validation", target: promotionNodeId, type: "gates", weight: 1, metadata });
  }

  for (const rollback of rollbacks.slice(-4)) {
    const rollbackNodeId = `self-improvement:rollback:${rollback.id}`;
    nodes.push({
      id: rollbackNodeId,
      type: "rollback",
      label: rollback.reason || "Rollback",
      group: "self-improvement-rollback",
      risk_level: "high",
      status: rollback.status || "rolled_back",
      metadata: { ...metadata, rollbackId: rollback.id, proposalId: rollback.proposalId, reason: rollback.reason }
    });
    links.push({ source: rollbackNodeId, target: "system:plutonix", type: "restores", weight: 2, metadata });
  }

  return {
    nodes,
    links,
    counts: {
      proposals: proposals.length,
      patterns: patterns.length,
      investigations: investigations.length,
      researchLogs: researchLogs.length,
      toolPlans: toolPlans.length,
      monetaryApprovals: monetaryApprovals.length
    }
  };
}

export async function buildAgenticSystemGraph() {
  const basePath = topologyGraphPath();
  const baseGraph = (await fs.pathExists(basePath))
    ? await fs.readJson(basePath)
    : { metadata: {}, nodes: [], links: [] };
  const baseNodes = (baseGraph.nodes || []).filter((node) => !node.metadata?.dynamicProjectGraph && !node.metadata?.dynamicSelfImprovementGraph);
  const baseLinks = (baseGraph.links || []).filter((link) => !link.metadata?.dynamicProjectGraph && !link.metadata?.dynamicSelfImprovementGraph);
  const topologies = await readProjectAgentTopologies();
  const projectRows = topologies.map(graphRowsForTopology);
  const improvementRows = await selfImprovementGraphRows();
  return {
    metadata: {
      ...baseGraph.metadata,
      generated_at: new Date().toISOString(),
      graph_version: "1.3.0",
      managed_project_count: topologies.length,
      project_agent_source: "runtime/agents/projects",
      self_improvement_source: "runtime/self-improvement",
      self_improvement_proposal_count: improvementRows.counts.proposals,
      self_improvement_pattern_count: improvementRows.counts.patterns,
      self_improvement_investigation_count: improvementRows.counts.investigations,
      self_improvement_research_log_count: improvementRows.counts.researchLogs,
      self_improvement_tool_plan_count: improvementRows.counts.toolPlans,
      self_improvement_monetary_approval_count: improvementRows.counts.monetaryApprovals
    },
    nodes: mergeNodesById([...baseNodes, ...projectRows.flatMap((row) => row.nodes), ...improvementRows.nodes]),
    links: [...baseLinks, ...projectRows.flatMap((row) => row.links), ...improvementRows.links]
  };
}

export async function syncProjectAgentTopology(project, structuredRequest = {}) {
  structuredRequest.projectOrchestrator = {
    authority: "project-local",
    policyPath: "AGENTS.md",
    contextPath: ".agentic/orchestrator-agent.md",
    bootstrapPromptPath: ".codex/prompts/bootstrap-orchestrator.md",
    codexEntryPath: "AGENTS.md",
    claudeEntryPath: "CLAUDE.md",
    coreObjective: "Highest implementation accuracy at the lowest justified token and tool cost."
  };
  const topology = withoutDeletedAgents(buildProjectAgentTopology(project, structuredRequest), await readDeletedAgentIds());
  await writeProjectLocalOrchestrator(topology);
  await fs.ensureDir(agentRuntimeRoot());
  await fs.writeJson(path.join(agentRuntimeRoot(), `${project.id}.agents.json`), topology, { spaces: 2 });
  await writeAgentMarkdown(topology);
  const topologies = await readProjectAgentTopologies();
  await writeGeneratedNeo4jSeed(topologies);
  const graph = await buildAgenticSystemGraph();
  await fs.ensureDir(path.dirname(topologyGraphPath()));
  await fs.writeJson(topologyGraphPath(), graph, { spaces: 2 });
  await fs.ensureDir(path.dirname(frontendGraphPath()));
  await fs.writeJson(frontendGraphPath(), graph, { spaces: 2 });
  return topology;
}

export async function removeAgentFromProjectTopologies(agentId, metadata = {}) {
  if (!agentId) throw new Error("Agent ID is required.");
  await recordDeletedAgent(agentId, metadata);
  const files = (await fs.pathExists(agentRuntimeRoot()))
    ? (await fs.readdir(agentRuntimeRoot())).filter((file) => file.endsWith(".agents.json"))
    : [];
  const updatedTopologies = [];
  const removedLocalPaths = [];

  for (const file of files) {
    const topologyPath = path.join(agentRuntimeRoot(), file);
    const topology = await fs.readJson(topologyPath).catch(() => null);
    if (!topology) continue;
    const removedAgent = (topology.agents || []).find((agent) => agent.id === agentId);
    if (!removedAgent) continue;
    const nextTopology = withoutDeletedAgents(topology, new Set([agentId]));
    await fs.writeJson(topologyPath, nextTopology, { spaces: 2 });
    updatedTopologies.push(topology.project?.id || file);

    const workspaceDir = topology.project?.workspaceDir;
    if (workspaceDir) {
      const localAgentPath = path.join(workspaceDir, ".agentic", "agents", `${agentId}.agent.md`);
      await fs.remove(localAgentPath);
      removedLocalPaths.push(localAgentPath);
      if (removedAgent.role === "project-orchestrator") {
        const orchestratorPath = path.join(workspaceDir, ".agentic", "orchestrator-agent.md");
        await fs.remove(orchestratorPath);
        removedLocalPaths.push(orchestratorPath);
      }
      if (removedAgent.role === "qagent-controller") {
        const qagentPath = path.join(workspaceDir, ".agentic", "qagentic-support");
        await fs.remove(qagentPath);
        removedLocalPaths.push(qagentPath);
      }
      await writeProjectLocalOrchestrator(nextTopology);
    }
  }

  const generatedPath = path.join(generatedAgentsRoot(), `${agentId}.agent.md`);
  await fs.remove(generatedPath);
  removedLocalPaths.push(generatedPath);
  await refreshProjectAgentGraphs();
  return { updatedTopologies, removedLocalPaths };
}

export async function ensureProjectAgentTopologies(projects) {
  const existingTopologies = await readProjectAgentTopologies();
  const existing = new Map(existingTopologies.map((topology) => [topology.project.id, topology]));
  const created = [];
  for (const project of projects) {
    if (!project || project.isDefault) continue;
    if (existing.has(project.id)) {
      await writeProjectLocalOrchestrator(existing.get(project.id));
      continue;
    }
    const topology = await syncProjectAgentTopology(project, {
      objective: `Maintain the managed app project ${project.name}.`,
      pageType: "managed_app_project",
      topic: project.name,
      sections: ["project", "runtime", "playground"],
      media: []
    });
    created.push(topology);
  }
  return created;
}

export async function removeProjectAgentTopology(project) {
  if (!project?.id) return;
  const topologyPath = path.join(agentRuntimeRoot(), `${project.id}.agents.json`);
  let topology = null;
  if (await fs.pathExists(topologyPath)) {
    try {
      topology = await fs.readJson(topologyPath);
    } catch {
      topology = null;
    }
  }
  await fs.remove(topologyPath);
  for (const agent of topology?.agents || []) {
    await fs.remove(path.join(generatedAgentsRoot(), `${agent.id}.agent.md`));
  }
  await refreshProjectAgentGraphs();
}
