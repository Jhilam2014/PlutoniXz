import { chromaConfig } from '../runtime/vector/chromadb.service';
console.log(JSON.stringify({ status: 'pending_install', config: chromaConfig() }, null, 2));
