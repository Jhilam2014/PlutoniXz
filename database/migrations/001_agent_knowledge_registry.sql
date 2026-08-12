CREATE TABLE IF NOT EXISTS agents (
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
