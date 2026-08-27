#!/usr/bin/env node

import { syncKnownAgentKnowledgeRoots } from "../apps/backend/src/vectorMemorySync.js";

const result = await syncKnownAgentKnowledgeRoots({
  reason: process.argv[2] || "manual-project-delivery",
  isSystemIdle: () => true,
  minPendingFiles: 1
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (["failed", "partial"].includes(result.status)) process.exitCode = 1;
