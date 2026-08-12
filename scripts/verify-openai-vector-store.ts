import { validateEnv, loadEnv } from '../runtime/agent-memory/openai-vector-store.service';
const result = validateEnv(loadEnv());
console.log(JSON.stringify({ status: result.valid ? 'success' : 'failed', missing: result.missing }, null, 2));
