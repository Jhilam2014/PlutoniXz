import { validateEnv, loadEnv } from '../runtime/agent-memory/openai-vector-store.service';
const result = validateEnv(loadEnv());
console.log(JSON.stringify({ status: result.valid ? 'ready' : 'pending_credentials', missing: result.missing }, null, 2));
