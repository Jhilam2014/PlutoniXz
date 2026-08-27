#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const outputPath = path.resolve("observability/agent-memory/vector-store-verification.json");
const vectorStoreId = String(process.env.OPENAI_AGENT_VECTOR_STORE_ID || "").trim();
const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
const headers = { Authorization: `Bearer ${apiKey}` };
if (process.env.OPENAI_ORG_ID) headers["OpenAI-Organization"] = process.env.OPENAI_ORG_ID;
if (process.env.OPENAI_PROJECT_ID) headers["OpenAI-Project"] = process.env.OPENAI_PROJECT_ID;

function safeError(error) {
  return String(error?.message || error || "Vector store verification failed.")
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .slice(0, 1000);
}

const report = {
  vector_store_id: vectorStoreId,
  checked_at: new Date().toISOString(),
  attached_file_count: 0,
  uploaded_files: [],
  status: "failed"
};

try {
  if (!apiKey || !vectorStoreId) throw new Error("Missing OPENAI_API_KEY or OPENAI_AGENT_VECTOR_STORE_ID.");
  let after = "";
  do {
    const query = new URLSearchParams({ limit: "100", order: "asc" });
    if (after) query.set("after", after);
    const response = await fetch(`https://api.openai.com/v1/vector_stores/${encodeURIComponent(vectorStoreId)}/files?${query}`, { headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${body.error?.message || "request failed"}`);
    report.uploaded_files.push(...(body.data || []).map((file) => ({ id: file.id, status: file.status, source_path: file.attributes?.source_path || "" })));
    after = body.has_more ? body.last_id : "";
  } while (after);
  report.attached_file_count = report.uploaded_files.length;
  const indexPath = path.resolve("registry/agents/vector-sync-index.json");
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const remoteById = new Map(report.uploaded_files.map((file) => [file.id, file]));
  for (const record of Object.values(index.files || {})) {
    const remote = remoteById.get(record.file_id);
    if (remote) record.status = remote.status || record.status;
  }
  index.last_verification_at = report.checked_at;
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  report.status = "success";
} catch (error) {
  report.error = safeError(error);
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ ...report, vector_store_id: vectorStoreId ? `${vectorStoreId.slice(0, 8)}…${vectorStoreId.slice(-4)}` : "" }, null, 2)}\n`);
if (report.status !== "success") process.exitCode = 1;
