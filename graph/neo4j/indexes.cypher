CREATE INDEX agent_status IF NOT EXISTS FOR (n:Agent) ON (n.status);
CREATE INDEX functionality_status IF NOT EXISTS FOR (n:ApplicationFunctionality) ON (n.status);
CREATE INDEX workflow_status IF NOT EXISTS FOR (n:Workflow) ON (n.status);
