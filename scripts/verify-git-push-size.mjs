#!/usr/bin/env node

/** Refuse GitHub-incompatible blobs before a push leaves this repository. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const GITHUB_MAX_BLOB_BYTES = 100 * 1024 * 1024;
const ZERO_SHA = /^0+$/;

function fail(message) { throw new Error(message); }
function git(args, input = undefined) {
  const result = spawnSync('git', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) fail(`Git size guard could not run ${args[0]}.`);
  return result.stdout;
}

export function parsePrePushUpdates(input) {
  return String(input).split(/\r?\n/).filter(Boolean).map((line) => {
    const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!localRef || !localSha || !remoteRef || !remoteSha) fail('Malformed pre-push reference update.');
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

export function oversizedBlobs(objects, limit = GITHUB_MAX_BLOB_BYTES) {
  return objects.filter((object) => object.type === 'blob' && object.size >= limit);
}

function objectsForRevisions(revisions) {
  if (!revisions.length) return [];
  const output = git(['rev-list', '--objects', ...revisions]);
  const paths = new Map();
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [oid, ...pathParts] = line.split(' ');
    if (!paths.has(oid)) paths.set(oid, pathParts.join(' ') || '(path unavailable)');
  }
  if (!paths.size) return [];
  const metadata = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], `${[...paths.keys()].join('\n')}\n`)
    .split(/\r?\n/).filter(Boolean).map((line) => {
      const [oid, type, size] = line.split(' ');
      return { oid, type, size: Number(size), path: paths.get(oid) ?? '(path unavailable)' };
    });
  return metadata;
}

export function revisionsForPush(updates) {
  const revisions = [];
  for (const update of updates) {
    if (ZERO_SHA.test(update.localSha)) continue; // deletion pushes no objects
    revisions.push(update.localSha);
    if (!ZERO_SHA.test(update.remoteSha)) revisions.push(`^${update.remoteSha}`);
  }
  return revisions;
}

function assertNoOversized(objects, label) {
  const oversized = oversizedBlobs(objects);
  if (oversized.length) {
    const details = oversized.map((item) => `${item.path} (${item.size} bytes)`).join(', ');
    fail(`${label} contains blob(s) at or above GitHub's 100 MiB limit: ${details}. Remove them from the commit or use Git LFS before pushing.`);
  }
}

function treeObjects(ref) {
  return git(['ls-tree', '-rl', ref]).split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^\d+\s+(\w+)\s+([0-9a-f]+)\s+(\d+)\t(.*)$/i);
    if (!match) fail('Unable to parse Git tree entry for size verification.');
    return { type: match[1], oid: match[2], size: Number(match[3]), path: match[4] };
  });
}

function main() {
  const index = process.argv.indexOf('--tree');
  if (index !== -1) {
    const ref = process.argv[index + 1] || 'HEAD';
    assertNoOversized(treeObjects(ref), `Git tree ${ref}`);
    process.stdout.write(`Git tree ${ref} contains no blob at or above GitHub's 100 MiB limit.\n`);
    return;
  }
  const input = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
  const updates = parsePrePushUpdates(input);
  assertNoOversized(objectsForRevisions(revisionsForPush(updates)), 'Objects selected for push');
  process.stdout.write(`Git push-size guard passed for ${updates.length} ref update(s).\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { main(); } catch (error) { process.stderr.write(`Git push-size guard failed: ${error.message}\n`); process.exitCode = 1; }
}
