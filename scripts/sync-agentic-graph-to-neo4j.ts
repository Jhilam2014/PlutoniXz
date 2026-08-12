import { neo4jStatus } from '../runtime/graph/neo4j.service';
const status = neo4jStatus();
console.log(JSON.stringify({ sync: status.ready ? 'ready' : 'pending_credentials', ...status }, null, 2));
