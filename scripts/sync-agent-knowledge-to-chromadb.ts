import { chromaConfig } from '../runtime/vector/chromadb.service';
console.log(JSON.stringify({ status: 'pending_install', provider: 'chroma', config: chromaConfig() }, null, 2));
