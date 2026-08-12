import { ensureDir } from '../runtime/agent-memory/openai-vector-store.service';
['agents/generated','registry/agents','memory/agent-knowledge/agents','memory/agent-knowledge/projects','observability/agent-memory'].forEach(ensureDir);
