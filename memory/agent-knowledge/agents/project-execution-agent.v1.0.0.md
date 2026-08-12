---
agent_id: "project-execution-agent"
agent_name: "Project Execution Agent"
version: "1.0.0"
domain: "orchestration"
workflow_class: "ai_agent_system"
content_type: "agent_knowledge"
status: "active"
created_at: "2026-06-29T22:53:21+00:00"
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
