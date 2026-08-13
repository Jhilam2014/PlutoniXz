#!/usr/bin/env node

import assert from 'node:assert/strict';
import { GITHUB_MAX_BLOB_BYTES, oversizedBlobs, parsePrePushUpdates, revisionsForPush } from './verify-git-push-size.mjs';

const updates = parsePrePushUpdates('refs/heads/main aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n');
assert.deepEqual(updates, [{ localRef: 'refs/heads/main', localSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', remoteRef: 'refs/heads/main', remoteSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }]);
assert.deepEqual(revisionsForPush(updates), ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '^bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);
assert.deepEqual(revisionsForPush(parsePrePushUpdates('refs/heads/new cccccccccccccccccccccccccccccccccccccccc refs/heads/new 0000000000000000000000000000000000000000\n')), ['cccccccccccccccccccccccccccccccccccccccc']);
assert.equal(oversizedBlobs([{ type: 'blob', size: GITHUB_MAX_BLOB_BYTES - 1 }, { type: 'tree', size: GITHUB_MAX_BLOB_BYTES }]).length, 0);
assert.equal(oversizedBlobs([{ type: 'blob', size: GITHUB_MAX_BLOB_BYTES }]).length, 1, 'GitHub-limit-sized blobs must be rejected.');
assert.throws(() => parsePrePushUpdates('bad update'), /Malformed/);
console.log('Git push-size guard parsing, ref-range, and 100 MiB boundary tests passed.');
