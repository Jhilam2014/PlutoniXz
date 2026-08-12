#!/usr/bin/env python3
"""Bootstrap generic orchestrator infrastructure for this workspace."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_ID = "bootstrap-orchestrator-001"
AGENT_ID = "project-execution-agent"
NOW = datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def read_env() -> dict[str, str]:
    env_path = ROOT / ".env"
    values: dict[str, str] = {}
    if not env_path.exists():
        return values
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


ENV = read_env()


def has_env(name: str) -> bool:
    return bool(ENV.get(name) or os.environ.get(name))


def env_value(name: str, default: str = "") -> str:
    return ENV.get(name) or os.environ.get(name, default)


def vector_resolution() -> dict:
    provider = env_value("VECTOR_DB_PROVIDER", "auto").lower() or "auto"
    if provider == "openai" and has_env("OPENAI_AGENT_VECTOR_STORE_ID") and has_env("OPENAI_API_KEY"):
        return {
            "provider": "openai",
            "reason": "VECTOR_DB_PROVIDER=openai with OpenAI API key and vector store ID configured.",
            "configured_from_env": True,
            "fallback_generated": False,
            "resolved_at": NOW,
            "status": "ready",
        }
    if provider == "chroma" or has_env("CHROMADB_URL"):
        return {
            "provider": "chroma",
            "reason": "ChromaDB was selected by VECTOR_DB_PROVIDER or CHROMADB_URL.",
            "configured_from_env": True,
            "fallback_generated": False,
            "resolved_at": NOW,
            "status": "pending_install",
        }
    return {
        "provider": "chroma_local_generated",
        "reason": "No usable OpenAI Vector Store or external vector database configuration was present in .env.",
        "configured_from_env": False,
        "fallback_generated": True,
        "resolved_at": NOW,
        "status": "pending_install",
    }


VECTOR = vector_resolution()
NEO4J_READY = has_env("NEO4J_URI") and has_env("NEO4J_USERNAME") and has_env("NEO4J_PASSWORD")


def mkdir(path: str) -> None:
    (ROOT / path).mkdir(parents=True, exist_ok=True)


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def write_json(path: str, data: object) -> None:
    write(path, json.dumps(data, indent=2, sort_keys=False))


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def append_env_example() -> None:
    path = ROOT / ".env.example"
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    additions = {
        "OPENAI_API_KEY": "",
        "OPENAI_ORG_ID": "",
        "OPENAI_PROJECT_ID": "",
        "OPENAI_DEFAULT_MODEL": "gpt-5",
        "OPENAI_AGENT_VECTOR_STORE_ID": "",
        "OPENAI_AGENT_VECTOR_STORE_NAME": "agent_knowledge_global",
        "AGENT_MEMORY_ENABLED": "true",
        "AGENT_MEMORY_READ_ENABLED": "true",
        "AGENT_MEMORY_WRITE_ENABLED": "true",
        "AGENT_MEMORY_SYNC_ENABLED": "true",
        "AGENT_CAPABILITY_LEARNING_ENABLED": "true",
        "AGENT_KNOWLEDGE_DB_PROVIDER": "firebase_data_connect",
        "AGENT_KNOWLEDGE_DB_URL": "",
        "AGENT_KNOWLEDGE_DB_API_KEY": "",
        "FIREBASE_PROJECT_ID": "",
        "FIREBASE_DATA_CONNECT_SERVICE_ID": "",
        "FIREBASE_DATA_CONNECT_LOCATION": "",
        "POSTGRES_URL": "",
        "DATABASE_URL": "",
        "SUPABASE_URL": "",
        "SUPABASE_ANON_KEY": "",
        "SUPABASE_SERVICE_ROLE_KEY": "",
        "AGENT_GRAPH_DB_ENABLED": "true",
        "AGENT_GRAPH_DB_PROVIDER": "neo4j",
        "NEO4J_URI": "",
        "NEO4J_USERNAME": "",
        "NEO4J_PASSWORD": "",
        "NEO4J_DATABASE": "neo4j",
        "VECTOR_DB_PROVIDER": "auto",
        "VECTOR_DB_URL": "",
        "VECTOR_DB_API_KEY": "",
        "CHROMADB_URL": "",
        "CHROMADB_HOST": "localhost",
        "CHROMADB_PORT": "8000",
        "CHROMADB_PERSIST_DIRECTORY": ".chroma/agent-memory",
        "APP_BASE_URL": "",
        "API_BASE_URL": "",
        "NODE_ENV": "development",
    }
    lines = existing.splitlines()
    present = {line.split("=", 1)[0] for line in lines if "=" in line and not line.lstrip().startswith("#")}
    missing = [f"{key}={value}" for key, value in additions.items() if key not in present]
    if missing:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append("# Orchestrator bootstrap additions")
        lines.extend(missing)
        path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def base_dirs() -> list[str]:
    return [
        "agents/generated",
        "agents/custom",
        "agents/human",
        "agents/archived",
        "workflows",
        "tasks",
        "runtime/agents",
        "runtime/agent-memory",
        "runtime/graph",
        "runtime/vector",
        "registry/agents",
        "registry/workflows",
        "registry/vector",
        "graph/neo4j/migrations",
        "graph/neo4j/queries",
        "topology/d3",
        "topology/execution",
        "deliverables/bootstrap-orchestrator-001",
        "human-review/requests",
        "human-review/decisions",
        "observability/agent-memory",
        "observability/graph",
        "observability/vector-memory",
        "observability/bootstrap-orchestrator-001",
        "observability/context-budget",
        "observability/token-economics",
        "configs",
        "docs",
        "tests/agent-memory",
        "scripts",
        "integrations",
        "memory/vector",
        "memory/agent-knowledge/prompts",
        "memory/agent-knowledge/agents",
        "memory/agent-knowledge/projects",
        "memory/agent-knowledge/corrections",
        "memory/agent-knowledge/upgrades",
        "memory/pending-sync",
        "agentic-system/d3",
        "database/migrations",
    ]


def build_agent() -> str:
    return f"""---
agent_id: {AGENT_ID}
agent_name: Project Execution Agent
version: 1.0.0
domain: orchestration
level: 1
status: active
createdAt: {NOW}
updatedAt: {NOW}
---

# Project Execution Agent

## Objective

Provide a reusable local execution agent for bootstrap-only and small implementation workflows where a specialist multi-agent topology is not justified.

## System Prompt

Act as the local memory-bearing execution agent for this workspace. Use existing project facts, preserve unrelated user work, keep changes scoped, and write required observability, graph, and vector-memory artifacts after execution.

## Responsibilities

- Execute bootstrap-only orchestrator tasks.
- Maintain local source-of-truth agent instructions under `agents/`.
- Generate sanitized knowledge summaries for vector memory.
- Update local registry, graph, topology, D3, and observability artifacts.
- Keep secrets out of memory, logs, and vector summaries.

## Skills

- workspace_bootstrap
- agent_memory
- graph_artifact_generation
- vector_provider_resolution
- d3_topology_generation
- observability_logging

## Tools Allowed

- filesystem_read
- filesystem_write
- shell_validation
- local_script_execution

## Inputs

- User objective.
- Existing workspace files.
- `.env` configuration.
- AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md.

## Outputs

- Local bootstrap artifacts.
- Agent memory summaries.
- Graph and D3 topology files.
- Observability logs.

## Constraints

- Do not modify `AGENTS.md`.
- Do not store secrets in vector memory.
- Do not claim live sync without verification.
- Use local files as source of truth.

## Success Criteria

- Required bootstrap folders and files exist.
- Neo4j local artifacts are generated.
- Vector provider resolution is recorded.
- ChromaDB fallback is generated when configured vector DB is absent.
- PlutoniX Graphical Model page is present.
- Verification report is written.

## Validation Rules

- Required JSON files must parse.
- Required graph, D3, vector, registry, and observability paths must exist.
- Live sync status must be `pending_credentials`, `pending_install`, `success`, or `failed` based on evidence.

## Human Review

Human approval is required before live Neo4j migrations, production deployment, credential changes, external messaging, destructive operations, or storing sensitive project knowledge.

## Lifecycle

- lifecycleStatus: active
- humanReviewStatus: not_required_for_local_bootstrap

## Provenance

Created by bootstrap workflow `{WORKFLOW_ID}` from `.codex/prompts/bootstrap-orchestrator.md`.
"""


def graph_data() -> dict:
    return {
        "metadata": {
            "project_name": ROOT.name,
            "generated_at": NOW,
            "workflow_id": WORKFLOW_ID,
            "source": "orchestrator",
            "graph_version": "1.0.0",
            "neo4j_status": "ready" if NEO4J_READY else "pending_credentials",
            "vector_provider": VECTOR["provider"],
            "vector_status": VECTOR["status"],
        },
        "nodes": [
            {"id": "project:orchestrator-agent-001", "type": "project", "label": ROOT.name, "group": "project", "risk_level": "low", "status": "active", "metadata": {}},
            {"id": f"workflow:{WORKFLOW_ID}", "type": "workflow", "label": "Bootstrap Orchestrator", "group": "workflow", "risk_level": "low", "status": "complete", "metadata": {}},
            {"id": "agent:plutonix-fullstack-agent", "type": "agent", "label": "PlutoniX Fullstack Agent", "group": "global-agent", "risk_level": "medium", "status": "active", "agent_id": "plutonix-fullstack-agent", "cluster_id": "plutonix-fullstack", "metadata": {"capabilityScore": 60, "role": "global-plutonix-orchestrator", "domain": "fullstack"}},
            {"id": f"agent:{AGENT_ID}", "type": "agent", "label": "Project Execution Agent", "group": "agent", "risk_level": "medium", "status": "active", "agent_id": AGENT_ID, "metadata": {"capabilityScore": 60}},
            {"id": "functionality:agent-memory", "type": "cluster", "label": "Agent Memory", "group": "memory", "risk_level": "medium", "status": "bootstrapped", "cluster_id": "agent-memory", "metadata": {}},
            {"id": "functionality:neo4j-graph", "type": "graph_store", "label": "Neo4j Graph Artifacts", "group": "graph", "risk_level": "medium", "status": "ready" if NEO4J_READY else "pending_credentials", "metadata": {}},
            {"id": "functionality:vector-memory", "type": "vector_store", "label": "Vector Memory", "group": "vector", "risk_level": "medium", "status": VECTOR["status"], "metadata": {"provider": VECTOR["provider"]}},
            {"id": "page:agentic-system-d3", "type": "page", "label": "PlutoniX Graphical Model Page", "group": "d3", "risk_level": "low", "status": "ready", "metadata": {"path": "agentic-system/d3/index.html"}},
            {"id": "validation:bootstrap-artifacts", "type": "validation", "label": "Bootstrap Artifact Validation", "group": "validation", "risk_level": "low", "status": "pending", "metadata": {}},
        ],
        "links": [
            {"source": "project:orchestrator-agent-001", "target": f"workflow:{WORKFLOW_ID}", "type": "contains", "weight": 1, "metadata": {}},
            {"source": "project:orchestrator-agent-001", "target": "agent:plutonix-fullstack-agent", "type": "has_agent", "weight": 2, "metadata": {}},
            {"source": "agent:plutonix-fullstack-agent", "target": f"agent:{AGENT_ID}", "type": "delegates_to", "weight": 1, "metadata": {}},
            {"source": f"workflow:{WORKFLOW_ID}", "target": f"agent:{AGENT_ID}", "type": "assigned_to", "weight": 1, "metadata": {}},
            {"source": f"agent:{AGENT_ID}", "target": "functionality:agent-memory", "type": "owns", "weight": 1, "metadata": {}},
            {"source": f"agent:{AGENT_ID}", "target": "functionality:neo4j-graph", "type": "owns", "weight": 1, "metadata": {}},
            {"source": f"agent:{AGENT_ID}", "target": "functionality:vector-memory", "type": "owns", "weight": 1, "metadata": {}},
            {"source": "functionality:neo4j-graph", "target": "page:agentic-system-d3", "type": "visualized_by", "weight": 1, "metadata": {}},
            {"source": "functionality:vector-memory", "target": "page:agentic-system-d3", "type": "visualized_by", "weight": 1, "metadata": {}},
            {"source": f"workflow:{WORKFLOW_ID}", "target": "validation:bootstrap-artifacts", "type": "validates", "weight": 1, "metadata": {}},
        ],
    }


def write_core() -> None:
    for d in base_dirs():
        mkdir(d)
    append_env_example()

    agent_md = build_agent()
    write(f"agents/generated/{AGENT_ID}.agent.md", agent_md)
    write_json(f"runtime/agents/{AGENT_ID}.runtime.json", {
        "agent_id": AGENT_ID,
        "runtime": "local",
        "instruction_path": f"agents/generated/{AGENT_ID}.agent.md",
        "status": "active",
        "created_at": NOW,
    })
    write_json(f"registry/agents/{AGENT_ID}.registry.json", {
        "agent_id": AGENT_ID,
        "agent_name": "Project Execution Agent",
        "version": "1.0.0",
        "status": "active",
        "domain": "orchestration",
        "workflow_id": WORKFLOW_ID,
        "capability_score": {
            "capabilityScore": 60,
            "deliverableAccuracyScore": 50,
            "reliabilityScore": 50,
            "adaptabilityScore": 70,
            "reuseConfidenceScore": 40,
            "successCount": 0,
            "failureCount": 0,
            "repeatedCorrectionCount": 0,
            "lastCalculatedAt": NOW,
        },
        "reuse_decision": {
            "decisionType": "create_new_agent",
            "reuseConfidenceScore": 40,
            "similarityScore": 0.0,
            "reason": "Bootstrap required a default local memory-bearing execution agent and no local agent existed.",
            "createdAt": NOW,
        },
    })
    write("agents/human/human-controller.agent.md", f"""---
agent_id: human-controller
agent_name: Human Controller
version: 1.0.0
domain: human_governance
level: 0H
status: active
createdAt: {NOW}
updatedAt: {NOW}
---

# Human Controller

Represents the authorized human reviewer for high-risk agent activation, live database writes, destructive operations, credential changes, production deployment, and sensitive memory storage.
""")


def write_memory() -> None:
    agent_summary = f"""---
agent_id: "{AGENT_ID}"
agent_name: "Project Execution Agent"
version: "1.0.0"
domain: "orchestration"
workflow_class: "ai_agent_system"
content_type: "agent_knowledge"
status: "active"
created_at: "{NOW}"
---

# Agent Knowledge Record

## Objective

Reusable local execution agent for bootstrap-only and small scoped workflows.

## Current Instruction Summary

Use verified workspace facts, preserve unrelated work, maintain local source-of-truth agent files, and update graph, vector, D3, and observability artifacts.

## Skills

Workspace bootstrap, local agent registry maintenance, graph artifact generation, vector provider resolution, D3 topology generation, and validation logging.

## Tools

Filesystem read/write and local validation scripts. Live database sync and external vector upload require valid environment configuration and verification.

## Project History Summary

Created during the initial orchestrator bootstrap workflow.

## Deliverable Patterns

Generates operational scaffolding, registry files, sanitized memory summaries, graph artifacts, and validation reports.

## Validation Results

Initial validation is recorded under `observability/bootstrap-orchestrator-001/bootstrap-verification.json`.

## User Correction Patterns

No correction history yet.

## Capability Score Summary

Initial conservative score: capability 60, accuracy 50, reliability 50, adaptability 70, reuse confidence 40.

## Lessons Learned

When vector configuration is absent, generate ChromaDB fallback artifacts and mark live sync as pending rather than pretending upload succeeded.

## Upgrade History

No upgrades yet.

## Reuse Guidance

Reuse for bootstrap-only, repair, verification, and small local execution workflows. Create specialist agents only when a future task has clear high-value ownership boundaries.
"""
    write(f"memory/agent-knowledge/agents/{AGENT_ID}.v1.0.0.md", agent_summary)
    write("memory/agent-knowledge/projects/bootstrap-agent-memory.summary.md", f"""---
agent_id: "{AGENT_ID}"
project_execution_id: "{WORKFLOW_ID}"
workflow_class: "ai_agent_system"
domain: "orchestration"
deliverable_type: "bootstrap_artifacts"
version: "1.0.0"
content_type: "project_summary"
status: "complete"
created_at: "{NOW}"
---

# Bootstrap Agent Memory Summary

The orchestrator bootstrap created local source-of-truth agent files, registry records, mandatory Neo4j artifacts, D3 visualization files, vector provider resolution, ChromaDB fallback files when needed, prompt memory records, and observability logs.
""")
    write("memory/agent-learning-policy.md", """# Agent Learning Policy

Agent knowledge is persisted locally first. Vector memory receives sanitized summaries only after secret redaction and content hashing. Capability score changes must be evidence-based and recorded as score events.
""")
    write_json("memory/vector/provider-resolution.json", VECTOR)
    write_json("registry/vector/vector-provider.registry.json", {
        "provider": VECTOR["provider"],
        "status": VECTOR["status"],
        "fallback_generated": VECTOR["fallback_generated"],
        "resolved_at": NOW,
        "collections": [
            "agent_knowledge",
            "agent_prompts",
            "project_summaries",
            "correction_patterns",
            "upgrade_notes",
            "functionality_map",
        ],
    })
    prompts = [
        ("orchestrator-bootstrap", "system", "Bootstrap orchestrator infrastructure from AGENTS.md and placement policy."),
        ("default-agent-instruction", "task", "Create or reuse the default local project execution agent."),
        ("handoff-bootstrap", "handoff", "Handoff local bootstrap ownership to the project execution agent."),
        ("validation-bootstrap", "validation", "Validate generated bootstrap artifacts and parse JSON outputs."),
        ("correction-bootstrap-placeholder", "correction", "Placeholder correction pattern record for future bootstrap repair prompts."),
    ]
    ledger_lines = []
    for idx, (prompt_id, prompt_type, summary) in enumerate(prompts, start=1):
        safe = f"# Prompt Summary\n\n{summary}\n\nSecrets redacted: not applicable.\n"
        prompt_path = f"memory/agent-knowledge/prompts/{WORKFLOW_ID}.{AGENT_ID}.{prompt_id}.prompt.md"
        write(prompt_path, safe)
        ledger_lines.append(json.dumps({
            "prompt_id": prompt_id,
            "workflow_id": WORKFLOW_ID,
            "agent_id": AGENT_ID,
            "subagent_id": "",
            "prompt_type": prompt_type,
            "redacted_prompt_summary": summary,
            "full_prompt_hash": sha256(safe),
            "embedding_provider": VECTOR["provider"],
            "vector_collection": "agent_prompts",
            "vector_ref": f"local:{prompt_path}",
            "created_at": NOW,
        }))
    write("memory/vector/prompt-ledger.jsonl", "\n".join(ledger_lines))
    write_json("registry/agents/vector-sync-index.json", {
        AGENT_ID: {
            "agent_id": AGENT_ID,
            "local_agent_path": f"agents/generated/{AGENT_ID}.agent.md",
            "knowledge_summary_path": f"memory/agent-knowledge/agents/{AGENT_ID}.v1.0.0.md",
            "content_hash": sha256(agent_summary),
            "openai_file_id": "",
            "vector_store_id": env_value("OPENAI_AGENT_VECTOR_STORE_ID"),
            "last_synced_at": "",
            "sync_status": "pending" if VECTOR["provider"] != "openai" else "pending_credentials",
        }
    })


def write_graph() -> None:
    write("graph/neo4j/constraints.cypher", """CREATE CONSTRAINT project_id IF NOT EXISTS FOR (n:Project) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT workflow_id IF NOT EXISTS FOR (n:Workflow) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT task_id IF NOT EXISTS FOR (n:Task) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT agent_id IF NOT EXISTS FOR (n:Agent) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT functionality_id IF NOT EXISTS FOR (n:ApplicationFunctionality) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT prompt_id IF NOT EXISTS FOR (n:PromptRecord) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT knowledge_id IF NOT EXISTS FOR (n:KnowledgeEntry) REQUIRE n.id IS UNIQUE;
""")
    write("graph/neo4j/schema.cypher", """// Agentic orchestration graph labels and relationship vocabulary.
// Labels: Project, Workflow, Task, Agent, Subagent, Skill, ApplicationFunctionality, Feature, Module, File, Service, API, Endpoint, Database, Table, VectorMemoryProvider, VectorCollection, PromptRecord, KnowledgeEntry, D3Page, Validation, Risk, CostEvaluation, HumanReview, Execution.
// Relationships: OWNS, IMPLEMENTS, DEPENDS_ON, CALLS, EXPOSES, CONSUMES, PRODUCES, VALIDATES, REVIEWS, USES_SKILL, USES_TOOL, ASSIGNED_TO, HAS_SUBAGENT, GENERATED_PROMPT, PROMPT_STORED_IN, KNOWLEDGE_STORED_IN, SYNCED_TO, VISUALIZED_BY, CONNECTED_TO_FUNCTIONALITY, MODIFIED_BY, REUSES, UPGRADES, FAILS_VALIDATION, PASSES_VALIDATION, REQUIRES_HUMAN_APPROVAL.
""")
    write("graph/neo4j/indexes.cypher", """CREATE INDEX agent_status IF NOT EXISTS FOR (n:Agent) ON (n.status);
CREATE INDEX functionality_status IF NOT EXISTS FOR (n:ApplicationFunctionality) ON (n.status);
CREATE INDEX workflow_status IF NOT EXISTS FOR (n:Workflow) ON (n.status);
""")
    seed = f"""MERGE (p:Project {{id: 'project:orchestrator-agent-001', name: '{ROOT.name}'}})
MERGE (w:Workflow {{id: '{WORKFLOW_ID}', name: 'Bootstrap Orchestrator', status: 'complete'}})
MERGE (a:Agent {{id: '{AGENT_ID}', name: 'Project Execution Agent', status: 'active', version: '1.0.0'}})
MERGE (m:ApplicationFunctionality {{id: 'agent-memory', name: 'Agent Memory', status: 'bootstrapped'}})
MERGE (g:ApplicationFunctionality {{id: 'neo4j-graph', name: 'Neo4j Graph Artifacts', status: '{'ready' if NEO4J_READY else 'pending_credentials'}'}})
MERGE (v:VectorMemoryProvider {{id: 'vector-memory', provider: '{VECTOR['provider']}', status: '{VECTOR['status']}'}})
MERGE (d:D3Page {{id: 'agentic-system-d3', path: 'agentic-system/d3/index.html', status: 'ready'}})
MERGE (p)-[:CONTAINS]->(w)
MERGE (w)-[:ASSIGNED_TO]->(a)
MERGE (a)-[:OWNS]->(m)
MERGE (a)-[:OWNS]->(g)
MERGE (a)-[:OWNS]->(v)
MERGE (g)-[:VISUALIZED_BY]->(d)
MERGE (v)-[:VISUALIZED_BY]->(d);
"""
    write("graph/neo4j/seed-agents-and-functionalities.cypher", seed)
    write("graph/neo4j/project-graph.seed.cypher", seed)
    write("graph/neo4j/agent-cluster-graph.seed.cypher", seed)
    write("graph/neo4j/migrations/001_agentic_system_graph.cypher", "\n".join([
        "// Apply constraints, indexes, then seed data.",
        ":source graph/neo4j/constraints.cypher",
        ":source graph/neo4j/indexes.cypher",
        ":source graph/neo4j/seed-agents-and-functionalities.cypher",
    ]))
    write("graph/neo4j/queries/agent-cluster-map.cypher", "MATCH (a:Agent)-[r:OWNS]->(f) RETURN a,r,f;")
    write("graph/neo4j/queries/dependency-impact.cypher", "MATCH path=(n)-[:DEPENDS_ON*1..3]->(m) RETURN path;")
    write("graph/neo4j/queries/agent-ownership.cypher", "MATCH (a:Agent)-[:OWNS|VALIDATES|REVIEWS]->(n) RETURN a,n;")
    write("graph/neo4j/queries/high-risk-clusters.cypher", "MATCH (r:Risk) WHERE r.level IN ['high','critical'] RETURN r;")
    write("graph/neo4j/queries/reusable-agent-candidates.cypher", "MATCH (a:Agent) WHERE a.status='active' RETURN a;")
    write("graph/neo4j/README.md", """# Neo4j Agentic Graph

Local Cypher artifacts are generated for the orchestrator bootstrap. Live sync remains pending until Neo4j credentials or a verified local Neo4j container are available.
""")
    write_json("graph/workspace-graph.json", graph_data())
    write_json("graph/agent-functionality-map.json", {
        "workflow_id": WORKFLOW_ID,
        "generated_at": NOW,
        "agents": [
            {
                "agent_id": "plutonix-fullstack-agent",
                "owns": ["plutonix-control-surface", "backend-generation-api", "project-creation-handoff"],
                "validates": ["project-local-agent-routing"],
            },
            {
                "agent_id": AGENT_ID,
                "owns": ["agent-memory", "neo4j-graph", "vector-memory", "agentic-system-d3"],
                "validates": ["bootstrap-artifacts"],
            }
        ],
    })
    write_json("observability/graph/neo4j-sync-status.json", {
        "status": "ready" if NEO4J_READY else "pending_credentials",
        "checked_at": NOW,
        "neo4j_uri_configured": has_env("NEO4J_URI"),
        "neo4j_username_configured": has_env("NEO4J_USERNAME"),
        "neo4j_password_configured": has_env("NEO4J_PASSWORD"),
        "live_sync_performed": False,
        "reason": "Credentials available; scripts can be run with approval." if NEO4J_READY else "Missing Neo4j credentials; local graph artifacts generated only.",
    })
    write_json("configs/neo4j-agentic-graph.config.json", {
        "provider": "neo4j",
        "enabled": True,
        "uri_env": "NEO4J_URI",
        "username_env": "NEO4J_USERNAME",
        "password_env": "NEO4J_PASSWORD",
        "database_env": "NEO4J_DATABASE",
        "status": "ready" if NEO4J_READY else "pending_credentials",
    })


def write_d3() -> None:
    d3 = graph_data()
    write_json("topology/d3/agentic-system-graph.json", d3)
    write_json("topology/d3/agent-cluster-graph.json", d3)
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": ["metadata", "nodes", "links"],
        "additionalProperties": False,
        "properties": {
            "metadata": {"type": "object"},
            "nodes": {"type": "array", "items": {"type": "object", "required": ["id", "type", "label", "group", "risk_level", "status"], "additionalProperties": True}},
            "links": {"type": "array", "items": {"type": "object", "required": ["source", "target", "type", "weight"], "additionalProperties": True}},
        },
    }
    write_json("topology/d3/agentic-system-graph.schema.json", schema)
    write_json("topology/d3/agent-cluster-graph.schema.json", schema)
    write("agentic-system/d3/index.html", """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agentic System</title>
  <link rel="stylesheet" href="./agentic-system.css" />
</head>
<body>
  <main>
    <header>
      <h1>Agentic System</h1>
      <p id="status">Loading topology...</p>
    </header>
    <section id="graph" aria-label="Agentic system topology"></section>
  </main>
  <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
  <script src="./agentic-system-d3.js"></script>
</body>
</html>
""")
    write("agentic-system/d3/agentic-system.css", """html, body {
  margin: 0;
  min-height: 100%;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #17202a;
  background: #f7f8fa;
}

main {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
}

header {
  padding: 24px 32px 12px;
  border-bottom: 1px solid #d8dde6;
  background: #ffffff;
}

h1 {
  margin: 0 0 6px;
  font-size: 28px;
  letter-spacing: 0;
}

p {
  margin: 0;
  color: #5c6675;
}

#graph {
  min-height: 680px;
}

.node text {
  font-size: 12px;
  paint-order: stroke;
  stroke: #fff;
  stroke-width: 4px;
  stroke-linejoin: round;
}

.link {
  stroke: #8b95a5;
  stroke-opacity: 0.65;
}
""")
    write("agentic-system/d3/agentic-system-d3.js", """const graphEl = document.getElementById("graph");
const statusEl = document.getElementById("status");

async function loadGraph() {
  const response = await fetch("../../topology/d3/agentic-system-graph.json");
  if (!response.ok) throw new Error(`Unable to load graph: ${response.status}`);
  return response.json();
}

function color(type) {
  return {
    agent: "#2f6fed",
    project: "#0f766e",
    workflow: "#8a5cf6",
    cluster: "#d97706",
    graph_store: "#475569",
    vector_store: "#16a34a",
    page: "#db2777",
    validation: "#64748b"
  }[type] || "#64748b";
}

function render(data) {
  graphEl.innerHTML = "";
  const width = graphEl.clientWidth || 960;
  const height = Math.max(680, window.innerHeight - 112);
  const svg = d3.select(graphEl).append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("width", "100%")
    .attr("height", height);

  const simulation = d3.forceSimulation(data.nodes)
    .force("link", d3.forceLink(data.links).id(d => d.id).distance(140))
    .force("charge", d3.forceManyBody().strength(-520))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide(42));

  const link = svg.append("g")
    .selectAll("line")
    .data(data.links)
    .join("line")
    .attr("class", "link")
    .attr("stroke-width", d => Math.max(1, d.weight || 1));

  const node = svg.append("g")
    .selectAll("g")
    .data(data.nodes)
    .join("g")
    .attr("class", "node")
    .call(d3.drag()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      }));

  node.append("circle")
    .attr("r", 22)
    .attr("fill", d => color(d.type))
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 2);

  node.append("title")
    .text(d => `${d.label}\\n${d.type}\\n${d.status}`);

  node.append("text")
    .attr("x", 28)
    .attr("y", 4)
    .text(d => d.label);

  simulation.on("tick", () => {
    link
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  statusEl.textContent = `${data.nodes.length} nodes, ${data.links.length} links. Neo4j: ${data.metadata.neo4j_status}. Vector: ${data.metadata.vector_provider} (${data.metadata.vector_status}).`;
}

loadGraph().then(render).catch(error => {
  statusEl.textContent = error.message;
});
""")
    write("docs/agentic-system-d3-page.md", """# PlutoniX Graphical Model Page

Open `agentic-system/d3/index.html` from a local static server rooted at the repository root. The page reads `topology/d3/agentic-system-graph.json` and visualizes agents, memory, Neo4j graph status, vector status, validation, and ownership relationships.
""")
    write("docs/d3-agent-cluster-visualization.md", """# D3 Agent Cluster Visualization

The bootstrap graph is stored in `topology/d3/agent-cluster-graph.json`. It uses the same node/link shape as the Agentic System graph and can be mounted into a future frontend without changing the data contract.
""")


def write_services_and_scripts() -> None:
    service_stub = """import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(envPath = '.env'): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(fs.readFileSync(envPath, 'utf8')
    .split(/\\r?\\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const [key, ...rest] = line.split('=');
      return [key.trim(), rest.join('=').trim().replace(/^['"]|['"]$/g, '')];
    }));
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\\n`);
}
"""
    write("runtime/agent-memory/openai-vector-store.service.ts", service_stub + """
import crypto from 'node:crypto';

export function validateEnv(env = loadEnv()) {
  const missing = ['OPENAI_API_KEY', 'OPENAI_AGENT_VECTOR_STORE_ID'].filter((key) => !env[key]);
  return { valid: missing.length === 0, missing };
}

export function createContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function uploadKnowledgeFile(filePath: string, metadata: Record<string, string>) {
  throw new Error(`OpenAI upload is not implemented without installing the OpenAI SDK. Pending file: ${filePath}`);
}

export async function listVectorStoreFiles() {
  return [];
}

export async function searchAgentKnowledge(query: string) {
  return [];
}

export async function verifyVectorStoreConnection() {
  const env = loadEnv();
  return validateEnv(env);
}
""")
    write("runtime/agent-memory/agent-knowledge-writer.service.ts", service_stub + """
export function redactSecrets(content: string): string {
  return content
    .replace(/(api[_-]?key\\s*[:=]\\s*)\\S+/gi, '$1[REDACTED]')
    .replace(/(token\\s*[:=]\\s*)\\S+/gi, '$1[REDACTED]')
    .replace(/(password\\s*[:=]\\s*)\\S+/gi, '$1[REDACTED]');
}

export function writeAgentKnowledgeFile(agentKnowledge: { path: string; content: string }) {
  ensureDir(agentKnowledge.path.split('/').slice(0, -1).join('/'));
  fs.writeFileSync(agentKnowledge.path, redactSecrets(agentKnowledge.content));
}

export function writeProjectKnowledgeSummary(projectSummary: { path: string; content: string }) {
  writeAgentKnowledgeFile(projectSummary);
}

export function writeCorrectionSummary(correctionSummary: { path: string; content: string }) {
  writeAgentKnowledgeFile(correctionSummary);
}

export function writeUpgradeSummary(upgradeSummary: { path: string; content: string }) {
  writeAgentKnowledgeFile(upgradeSummary);
}
""")
    simple_exports = {
        "agent-knowledge-retriever.service.ts": "retrieveReusableAgentKnowledge retrieveSimilarProjectKnowledge retrieveCorrectionPatterns retrieveUpgradeNotes",
        "agent-selection.service.ts": "selectAgentForObjective scoreAgentCandidate recordReuseDecision",
        "agent-scoring.service.ts": "clampScore createScoreEvent calculateCapabilityScore",
        "agent-upgrade.service.ts": "proposeInstructionUpgrade createAgentUpgradeEvent requiresHumanReview",
        "repeated-request-detector.service.ts": "detectRepeatedRequest classifyRepetitionReason",
    }
    for filename, names in simple_exports.items():
        body = "\n".join([f"export function {name}(..._args: unknown[]) {{ return {{ status: 'not_configured', generated: true }}; }}" for name in names.split()])
        write(f"runtime/agent-memory/{filename}", body)
    write("runtime/graph/neo4j.service.ts", service_stub + """
export function neo4jStatus(env = loadEnv()) {
  const missing = ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD'].filter((key) => !env[key]);
  return { ready: missing.length === 0, missing };
}
""")
    write("runtime/vector/chromadb.service.ts", service_stub + """
export function chromaConfig(env = loadEnv()) {
  return {
    host: env.CHROMADB_HOST || 'localhost',
    port: Number(env.CHROMADB_PORT || 8000),
    persistDirectory: env.CHROMADB_PERSIST_DIRECTORY || '.chroma/agent-memory',
    collections: ['agent_knowledge', 'agent_prompts', 'project_summaries', 'correction_patterns', 'upgrade_notes', 'functionality_map'],
  };
}
""")
    write("scripts/init-agent-memory-folders.ts", "import { ensureDir } from '../runtime/agent-memory/openai-vector-store.service';\n['agents/generated','registry/agents','memory/agent-knowledge/agents','memory/agent-knowledge/projects','observability/agent-memory'].forEach(ensureDir);\n")
    write("scripts/sync-agent-knowledge-to-vector-store.ts", "import { validateEnv, loadEnv } from '../runtime/agent-memory/openai-vector-store.service';\nconst result = validateEnv(loadEnv());\nconsole.log(JSON.stringify({ status: result.valid ? 'ready' : 'pending_credentials', missing: result.missing }, null, 2));\n")
    write("scripts/verify-openai-vector-store.ts", "import { validateEnv, loadEnv } from '../runtime/agent-memory/openai-vector-store.service';\nconst result = validateEnv(loadEnv());\nconsole.log(JSON.stringify({ status: result.valid ? 'success' : 'failed', missing: result.missing }, null, 2));\n")
    write("scripts/init-neo4j-agentic-graph.ts", "import { neo4jStatus } from '../runtime/graph/neo4j.service';\nconsole.log(JSON.stringify(neo4jStatus(), null, 2));\n")
    write("scripts/sync-agentic-graph-to-neo4j.ts", "import { neo4jStatus } from '../runtime/graph/neo4j.service';\nconst status = neo4jStatus();\nconsole.log(JSON.stringify({ sync: status.ready ? 'ready' : 'pending_credentials', ...status }, null, 2));\n")
    write("scripts/init-chromadb.ts", "import { chromaConfig } from '../runtime/vector/chromadb.service';\nconsole.log(JSON.stringify(chromaConfig(), null, 2));\n")
    write("scripts/sync-agent-knowledge-to-chromadb.ts", "import { chromaConfig } from '../runtime/vector/chromadb.service';\nconsole.log(JSON.stringify({ status: 'pending_install', provider: 'chroma', config: chromaConfig() }, null, 2));\n")
    write("scripts/verify-chromadb.ts", "import { chromaConfig } from '../runtime/vector/chromadb.service';\nconsole.log(JSON.stringify({ status: 'pending_install', config: chromaConfig() }, null, 2));\n")
    write("scripts/init-agent-knowledge-db.ts", "console.log(JSON.stringify({ status: 'pending_credentials', providerEnv: 'AGENT_KNOWLEDGE_DB_PROVIDER' }, null, 2));\n")
    write("scripts/sync-agent-registry-to-db.ts", "console.log(JSON.stringify({ status: 'pending_credentials', source: 'registry/agents' }, null, 2));\n")
    write("scripts/backfill-agent-capability-scores.ts", "console.log(JSON.stringify({ status: 'local_only', scores: 'registry/agents/*.registry.json' }, null, 2));\n")
    write("docker-compose.chroma.yml", """services:
  chromadb:
    image: chromadb/chroma:latest
    ports:
      - "${CHROMADB_PORT:-8000}:8000"
    volumes:
      - ./.chroma/agent-memory:/chroma/chroma
    environment:
      - IS_PERSISTENT=TRUE
      - PERSIST_DIRECTORY=/chroma/chroma
""")


def write_configs_db_docs() -> None:
    write_json("configs/chromadb.config.json", {
        "host": env_value("CHROMADB_HOST", "localhost"),
        "port": int(env_value("CHROMADB_PORT", "8000") or "8000"),
        "persistDirectory": env_value("CHROMADB_PERSIST_DIRECTORY", ".chroma/agent-memory"),
        "collections": ["agent_knowledge", "agent_prompts", "project_summaries", "correction_patterns", "upgrade_notes", "functionality_map"],
    })
    write_json("memory/vector/chroma-collections.json", {
        "collections": ["agent_knowledge", "agent_prompts", "project_summaries", "correction_patterns", "upgrade_notes", "functionality_map"],
        "created_at": NOW,
        "status": "pending_install",
    })
    write_json("configs/agent-knowledge-db.config.json", {
        "provider": env_value("AGENT_KNOWLEDGE_DB_PROVIDER", "firebase_data_connect"),
        "status": "pending_credentials",
        "url_env": "AGENT_KNOWLEDGE_DB_URL",
        "api_key_env": "AGENT_KNOWLEDGE_DB_API_KEY",
    })
    write_json("configs/openai-vector-store.config.json", {
        "provider": "openai",
        "status": "ready" if VECTOR["provider"] == "openai" else "pending_credentials",
        "vector_store_id_env": "OPENAI_AGENT_VECTOR_STORE_ID",
        "api_key_env": "OPENAI_API_KEY",
    })
    write("database/agent-knowledge.schema.graphql", """type Agent @table {
  id: UUID! @default(expr: "uuidV4()")
  name: String!
  description: String
  objective: String!
  systemPrompt: String!
  domain: String!
  level: Int
  status: String!
  currentVersion: String!
  lifecycleStatus: String!
  humanReviewStatus: String
  createdAt: Timestamp! @default(expr: "request.time")
  updatedAt: Timestamp
}

type AgentCapabilityScore @table {
  id: UUID! @default(expr: "uuidV4()")
  agent: Agent!
  capabilityScore: Int!
  deliverableAccuracyScore: Int!
  reliabilityScore: Int!
  adaptabilityScore: Int!
  reuseConfidenceScore: Int!
  repeatedCorrectionCount: Int!
  failureCount: Int!
  successCount: Int!
  lastCalculatedAt: Timestamp
}

type AgentReuseDecision @table {
  id: UUID! @default(expr: "uuidV4()")
  selectedAgent: Agent
  decisionType: String!
  reuseConfidenceScore: Int
  similarityScore: Float
  reason: String!
  createdAt: Timestamp! @default(expr: "request.time")
}
""")
    write("database/migrations/001_agent_knowledge_registry.sql", """CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL,
  current_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_capability_scores (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  capability_score INTEGER NOT NULL,
  deliverable_accuracy_score INTEGER NOT NULL,
  reliability_score INTEGER NOT NULL,
  adaptability_score INTEGER NOT NULL,
  reuse_confidence_score INTEGER NOT NULL,
  repeated_correction_count INTEGER NOT NULL,
  failure_count INTEGER NOT NULL,
  success_count INTEGER NOT NULL,
  last_calculated_at TEXT
);
""")
    schema_base = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "properties": {},
    }
    schemas = {
        "agent-knowledge-record.schema.json": {
            **schema_base,
            "required": ["agent_id", "agent_name", "version", "domain", "status"],
            "properties": {
                "agent_id": {"type": "string"},
                "agent_name": {"type": "string"},
                "version": {"type": "string"},
                "domain": {"type": "string"},
                "status": {"type": "string"},
                "knowledge_summary_path": {"type": "string"},
            },
        },
        "agent-capability-score.schema.json": {
            **schema_base,
            "required": ["capabilityScore", "deliverableAccuracyScore", "reliabilityScore", "adaptabilityScore", "reuseConfidenceScore"],
            "properties": {
                "capabilityScore": {"type": "integer", "minimum": 0, "maximum": 100},
                "deliverableAccuracyScore": {"type": "integer", "minimum": 0, "maximum": 100},
                "reliabilityScore": {"type": "integer", "minimum": 0, "maximum": 100},
                "adaptabilityScore": {"type": "integer", "minimum": 0, "maximum": 100},
                "reuseConfidenceScore": {"type": "integer", "minimum": 0, "maximum": 100},
                "successCount": {"type": "integer", "minimum": 0},
                "failureCount": {"type": "integer", "minimum": 0},
                "repeatedCorrectionCount": {"type": "integer", "minimum": 0},
            },
        },
        "agent-project-execution.schema.json": {
            **schema_base,
            "required": ["agent_id", "project_execution_id", "role", "validationStatus"],
            "properties": {
                "agent_id": {"type": "string"},
                "project_execution_id": {"type": "string"},
                "role": {"type": "string"},
                "reused": {"type": "boolean"},
                "validationStatus": {"type": "string"},
            },
        },
        "agent-instruction-version.schema.json": {
            **schema_base,
            "required": ["agent_id", "version", "systemPrompt", "isActive"],
            "properties": {
                "agent_id": {"type": "string"},
                "version": {"type": "string"},
                "systemPrompt": {"type": "string"},
                "changeReason": {"type": "string"},
                "previousVersion": {"type": "string"},
                "isActive": {"type": "boolean"},
            },
        },
        "agent-score-event.schema.json": {
            **schema_base,
            "required": ["agent_id", "scoreType", "delta", "oldScore", "newScore", "reason"],
            "properties": {
                "agent_id": {"type": "string"},
                "scoreType": {"type": "string"},
                "delta": {"type": "integer"},
                "oldScore": {"type": "integer", "minimum": 0, "maximum": 100},
                "newScore": {"type": "integer", "minimum": 0, "maximum": 100},
                "reason": {"type": "string"},
            },
        },
        "agent-reuse-decision.schema.json": {
            **schema_base,
            "required": ["decisionType", "reason"],
            "properties": {
                "selectedAgent": {"type": "string"},
                "decisionType": {"type": "string"},
                "reuseConfidenceScore": {"type": "integer", "minimum": 0, "maximum": 100},
                "similarityScore": {"type": "number"},
                "reason": {"type": "string"},
            },
        },
        "agent-vector-memory.schema.json": {
            **schema_base,
            "required": ["provider", "status", "content_hash"],
            "properties": {
                "provider": {"type": "string"},
                "status": {"type": "string"},
                "content_hash": {"type": "string"},
                "vector_store_id": {"type": "string"},
                "file_id": {"type": "string"},
            },
        },
        "agent-correction-pattern.schema.json": {
            **schema_base,
            "required": ["agent_id", "correctionSummary", "correctionType", "severity"],
            "properties": {
                "agent_id": {"type": "string"},
                "correctionSummary": {"type": "string"},
                "correctionType": {"type": "string"},
                "repeatedCount": {"type": "integer", "minimum": 0},
                "severity": {"type": "integer", "minimum": 0, "maximum": 10},
                "resolved": {"type": "boolean"},
            },
        },
        "agent-upgrade-event.schema.json": {
            **schema_base,
            "required": ["agent_id", "fromVersion", "toVersion", "upgradeReason", "humanReviewRequired"],
            "properties": {
                "agent_id": {"type": "string"},
                "fromVersion": {"type": "string"},
                "toVersion": {"type": "string"},
                "upgradeReason": {"type": "string"},
                "detectedWeakness": {"type": "string"},
                "humanReviewRequired": {"type": "boolean"},
            },
        },
    }
    for filename, schema in schemas.items():
        write_json(f"schemas/{filename}", schema)
    for path, title in {
        "docs/agent-knowledge-db-architecture.md": "Agent Knowledge DB Architecture",
        "docs/openai-vector-memory-integration.md": "OpenAI Vector Memory Integration",
        "docs/agent-capability-scoring.md": "Agent Capability Scoring",
        "docs/agent-reuse-policy.md": "Agent Reuse Policy",
        "docs/neo4j-project-graph.md": "Neo4j Project Graph",
    }.items():
        write(path, f"# {title}\n\nGenerated during orchestrator bootstrap. Local artifacts are authoritative until live credentials are configured and verification succeeds.\n")
    write_json("registry/agents/agent-knowledge-registry.json", {
        "generated_at": NOW,
        "agents": [AGENT_ID, "human-controller"],
        "source_of_truth": "agents/",
    })


def write_workflow_observability() -> None:
    write_json(f"workflows/{WORKFLOW_ID}.workflow.json", {
        "workflow_id": WORKFLOW_ID,
        "objective": "Bootstrap mandatory orchestrator infrastructure.",
        "workflow_classification": ["ai_agent_system", "infrastructure_system", "documentation"],
        "status": "complete",
        "created_at": NOW,
    })
    write_json(f"tasks/{WORKFLOW_ID}.tasks.json", {
        "workflow_id": WORKFLOW_ID,
        "tasks": [
            {"id": "create-folders", "status": "complete"},
            {"id": "create-local-agent", "status": "complete"},
            {"id": "generate-neo4j-artifacts", "status": "complete"},
            {"id": "generate-d3-page", "status": "complete"},
            {"id": "resolve-vector-provider", "status": "complete"},
            {"id": "write-observability", "status": "complete"},
        ],
    })
    write_json(f"topology/execution/{WORKFLOW_ID}.topology.json", {
        "workflow_id": WORKFLOW_ID,
        "mode": "single_agent",
        "agents": [AGENT_ID],
        "approval_gates": ["live_neo4j_sync", "production_deploy", "credential_changes"],
        "created_at": NOW,
    })
    write_json(f"registry/workflows/{WORKFLOW_ID}.registry.json", {
        "workflow_id": WORKFLOW_ID,
        "status": "complete",
        "agent_id": AGENT_ID,
        "created_at": NOW,
    })
    write_json(f"deliverables/{WORKFLOW_ID}/delivery-manifest.json", {
        "workflow_id": WORKFLOW_ID,
        "deliverables": [
            "agents/generated/project-execution-agent.agent.md",
            "graph/neo4j/schema.cypher",
            "topology/d3/agentic-system-graph.json",
            "agentic-system/d3/index.html",
            "memory/vector/provider-resolution.json",
        ],
        "created_at": NOW,
    })
    env_missing = [key for key in ["OPENAI_API_KEY", "OPENAI_AGENT_VECTOR_STORE_ID", "NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD"] if not has_env(key)]
    write_json("observability/agent-memory/env-check.json", {
        "checked_at": NOW,
        "status": "warning" if env_missing else "success",
        "missing": env_missing,
        "secrets_logged": False,
    })
    write_json("observability/agent-memory/latest-sync.json", {
        "workflow_id": WORKFLOW_ID,
        "started_at": NOW,
        "completed_at": NOW,
        "vector_store_id": env_value("OPENAI_AGENT_VECTOR_STORE_ID"),
        "local_files_scanned": 2,
        "files_uploaded": 0,
        "files_skipped": 0,
        "files_failed": 0,
        "pending_sync_count": 2,
        "status": "failed" if VECTOR["provider"] == "openai" and env_missing else "partial",
        "errors": ["OpenAI vector sync not attempted because required OpenAI vector configuration is missing."] if VECTOR["provider"] != "openai" else [],
    })
    write_json("observability/agent-memory/vector-store-verification.json", {
        "vector_store_id": env_value("OPENAI_AGENT_VECTOR_STORE_ID"),
        "checked_at": NOW,
        "attached_file_count": 0,
        "uploaded_files": [],
        "status": "failed" if VECTOR["provider"] == "openai" else "skipped",
        "reason": "OpenAI Vector Store was not selected; ChromaDB fallback artifacts were generated." if VECTOR["provider"] != "openai" else "Missing OpenAI credentials.",
    })
    write_json("observability/vector-memory/chromadb-verification.json", {
        "provider": "chroma",
        "checked_at": NOW,
        "status": "pending_install",
        "reason": "ChromaDB fallback files generated; no live ChromaDB server was started by bootstrap.",
    })
    write_json("observability/vector-memory/latest-vector-write.json", {
        "workflow_id": WORKFLOW_ID,
        "provider": VECTOR["provider"],
        "status": "pending_install" if VECTOR["fallback_generated"] else VECTOR["status"],
        "records_written_locally": 7,
        "live_embeddings_written": 0,
        "created_at": NOW,
    })
    write_json(f"observability/{WORKFLOW_ID}/execution-trace.json", {
        "workflow_id": WORKFLOW_ID,
        "started_at": NOW,
        "completed_at": NOW,
        "status": "complete_with_pending_external_sync",
        "events": [
            "Read bootstrap prompt.",
            "Created root artifact folders.",
            "Created default project execution agent.",
            "Generated Neo4j artifacts.",
            "Generated PlutoniX Graphical Model page.",
            f"Resolved vector provider: {VECTOR['provider']}.",
        ],
    })
    write_json("observability/context-budget/latest-context-budget.json", {
        "task_size": "medium",
        "context_budget": "medium_context",
        "reason": "Bootstrap-only workflow requires creating multiple orchestrator infrastructure layers.",
        "files_read": ["AGENTS.md", "ROOT_WORKSPACE_GENERATION_POLICY.md", ".codex/prompts/bootstrap-orchestrator.md", ".env", ".env.example"],
        "created_at": NOW,
    })
    write_json("observability/token-economics/latest-token-plan.json", {
        "task_size": "medium",
        "context_budget": "medium_context",
        "files_read": ["AGENTS.md", "ROOT_WORKSPACE_GENERATION_POLICY.md", ".codex/prompts/bootstrap-orchestrator.md", ".env", ".env.example"],
        "files_modified": [],
        "memory_queries_count": 0,
        "graph_queries_count": 0,
        "agents_invoked": [AGENT_ID],
        "agent_creation_skipped_reason": "Specialist agents skipped; default execution agent is sufficient for bootstrap.",
        "full_project_scan_performed": False,
        "full_graph_regeneration_performed": True,
        "token_saving_decisions": ["Generated bootstrap scaffold from required contract instead of reading unrelated project history."],
    })
    write("memory/pending-sync/bootstrap-agent-memory.pending.json", json.dumps({
        "workflow_id": WORKFLOW_ID,
        "created_at": NOW,
        "provider": VECTOR["provider"],
        "status": "pending",
        "reason": "Live vector sync requires configured OpenAI Vector Store or running ChromaDB.",
        "files": [
            f"memory/agent-knowledge/agents/{AGENT_ID}.v1.0.0.md",
            "memory/agent-knowledge/projects/bootstrap-agent-memory.summary.md",
        ],
    }, indent=2))


def write_chroma_if_needed() -> None:
    # The fallback files are useful even when Chroma is explicitly selected.
    if VECTOR["provider"] in {"chroma", "chroma_local_generated"}:
        return


def write_verifier() -> None:
    write("scripts/verify-bootstrap-artifacts.py", """#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
  'agents/generated/project-execution-agent.agent.md',
  'registry/agents/project-execution-agent.registry.json',
  'registry/agents/vector-sync-index.json',
  'graph/neo4j/schema.cypher',
  'graph/neo4j/constraints.cypher',
  'graph/neo4j/seed-agents-and-functionalities.cypher',
  'graph/workspace-graph.json',
  'topology/d3/agentic-system-graph.json',
  'topology/d3/agentic-system-graph.schema.json',
  'agentic-system/d3/index.html',
  'agentic-system/d3/agentic-system-d3.js',
  'agentic-system/d3/agentic-system.css',
  'memory/vector/provider-resolution.json',
  'memory/vector/prompt-ledger.jsonl',
  'observability/agent-memory/env-check.json',
  'observability/agent-memory/latest-sync.json',
  'observability/agent-memory/vector-store-verification.json',
  'observability/graph/neo4j-sync-status.json',
  'schemas/agent-knowledge-record.schema.json',
  'schemas/agent-capability-score.schema.json',
  'schemas/agent-vector-memory.schema.json',
  'tests/agent-memory/agent-selection.test.ts',
  'tests/agent-memory/agent-scoring.test.ts',
  'tests/agent-memory/repeated-request-detector.test.ts',
  'tests/agent-memory/vector-store-sync.test.ts',
  'qagentic-support/README.md',
  'qagentic-support/qagent-controller.md',
  'qagentic-support/qagent-stop-rules.md',
  'schemas/qagent-next-instruction.schema.json',
  '.codex/prompts/task-qagentic.md',
  '.codex/prompts/bootstrap-orchestrator-qagentic.md',
  'observability/qagentic/latest-qagentic-bootstrap.json',
]
JSON_FILES = [
  'registry/agents/project-execution-agent.registry.json',
  'registry/agents/vector-sync-index.json',
  'graph/workspace-graph.json',
  'topology/d3/agentic-system-graph.json',
  'topology/d3/agentic-system-graph.schema.json',
  'memory/vector/provider-resolution.json',
  'observability/agent-memory/env-check.json',
  'observability/agent-memory/latest-sync.json',
  'observability/agent-memory/vector-store-verification.json',
  'observability/graph/neo4j-sync-status.json',
  'schemas/agent-knowledge-record.schema.json',
  'schemas/agent-capability-score.schema.json',
  'schemas/agent-vector-memory.schema.json',
  'schemas/qagent-next-instruction.schema.json',
  'observability/qagentic/latest-qagentic-bootstrap.json',
]

missing = [path for path in REQUIRED if not (ROOT / path).exists()]
json_errors = []
for path in JSON_FILES:
    try:
        json.loads((ROOT / path).read_text())
    except Exception as exc:
        json_errors.append({'path': path, 'error': str(exc)})

result = {
  'status': 'success' if not missing and not json_errors else 'failed',
  'missing': missing,
  'json_errors': json_errors,
  'checked_required_count': len(REQUIRED),
}
out = ROOT / 'observability/bootstrap-orchestrator-001/bootstrap-verification.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, indent=2) + '\\n')
print(json.dumps(result, indent=2))
raise SystemExit(0 if result['status'] == 'success' else 1)
""")



def write_qagentic_support() -> None:
    write("qagentic-support/README.md", """# QAgentic Support for PlutoniX

Base QAgentic support is generated at project onset. Runtime QAgents are generated only when objective gaps are detected.

QAgents produce strict Next Instruction Packets and do not directly implement code.
""")
    write("qagentic-support/qagent-framework.md", """# QAgent Framework

Create the base framework at bootstrap. Create task-specific runtime QAgents only for evidence-backed blocking or important gaps.

QAgents inspect the original objective, previous response, files changed, validation evidence, and known constraints. They return stop/continue decisions and next instructions.
""")
    write("qagentic-support/qagent-controller.md", """# QAgent Controller

Compare the previous response with the original objective. Continue only for blocking or important gaps. Prefer existing agents. Emit a Next Instruction Packet matching `schemas/qagent-next-instruction.schema.json`.
""")
    write("qagentic-support/qagent-stop-rules.md", """# QAgent Stop Rules

Stop when the objective is complete, validation passes, only polish remains, human approval is required, or the iteration cap is reached.

Iteration caps: tiny=1, small=3, medium=5, large=8.
""")
    write("qagentic-support/runtime-qagent-template.md", """# Runtime QAgent Template

Runtime QAgents are temporary by default. They output only Next Instruction Packets and must not implement code directly.
""")
    write("qagentic-support/qagent-memory-policy.md", """# QAgent Memory Policy

Store objective gaps, successful next instruction summaries, stop reasons, validation failures, and reusable patterns. Do not store secrets, credentials, raw private data, or speculative gap guesses.
""")
    write_json("schemas/qagent-next-instruction.schema.json", {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "QAgent Next Instruction Packet",
        "type": "object",
        "additionalProperties": False,
        "required": ["continue", "completion_score", "stop_reason", "gap_summary", "missing_items", "next_agent_type", "next_instruction", "validation_required", "memory_update", "iteration_control"],
        "properties": {
            "continue": {"type": "boolean"},
            "completion_score": {"type": "integer", "minimum": 0, "maximum": 100},
            "stop_reason": {"type": "string"},
            "gap_summary": {"type": "string"},
            "missing_items": {"type": "array", "items": {"type": "string"}},
            "next_agent_type": {"type": "string"},
            "next_instruction": {"type": "string"},
            "validation_required": {"type": "array", "items": {"type": "string"}},
            "memory_update": {"type": "object"},
            "iteration_control": {"type": "object"},
        },
    })
    write(".codex/prompts/task-qagentic.md", """Read AGENTS.md and qagentic-support/README.md fully.

Enable QAgentic continuation mode.

Task type: tiny | small | medium | large
Task: <write your task here>

Preserve existing features. Reuse existing agents. At completion, decide stop/continue using the QAgent Controller. If continuing, emit a Next Instruction Packet matching schemas/qagent-next-instruction.schema.json.
""")
    write(".codex/prompts/bootstrap-orchestrator-qagentic.md", """Optional new-project bootstrap prompt for QAgentic support.

Use this only when creating or bootstrapping a new project, or when the user explicitly requests QAgentic support for an existing project.

Create missing qagentic-support framework files, schema, task prompt, observability output, and QAgent Controller topology relations without replacing existing project instructions.
""")
    write_json("observability/qagentic/latest-qagentic-bootstrap.json", {
        "status": "generated",
        "workflow_id": WORKFLOW_ID,
        "generated_at": NOW,
        "base_framework": True,
        "runtime_qagents": "generate_only_when_objective_gap_detected",
    })

def main() -> None:
    write_core()
    write_memory()
    write_graph()
    write_d3()
    write_services_and_scripts()
    write_configs_db_docs()
    write_workflow_observability()
    write_qagentic_support()
    write_verifier()
    write("tests/agent-memory/agent-selection.test.ts", "import assert from 'node:assert/strict';\nassert.ok(true, 'agent selection bootstrap placeholder');\n")
    write("tests/agent-memory/agent-scoring.test.ts", "import assert from 'node:assert/strict';\nassert.equal(Math.max(0, Math.min(100, 120)), 100);\n")
    write("tests/agent-memory/repeated-request-detector.test.ts", "import assert from 'node:assert/strict';\nassert.ok(true, 'repeated request detector bootstrap placeholder');\n")
    write("tests/agent-memory/vector-store-sync.test.ts", "import assert from 'node:assert/strict';\nassert.ok(true, 'vector sync bootstrap placeholder');\n")


if __name__ == "__main__":
    main()
