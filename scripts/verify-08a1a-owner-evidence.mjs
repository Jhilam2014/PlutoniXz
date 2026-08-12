#!/usr/bin/env node

/** Scoped, secret-safe acceptance check for the Apify 08A1A owner-evidence subgate. */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDirectory = join(root, 'docs/production-readiness/evidence');
const ownerEvidencePath = join(evidenceDirectory, '08a-owner-evidence.md');
const revocationPath = join(evidenceDirectory, 'apify-revocation-sanitized.md');
const healthPath = join(evidenceDirectory, 'apify-post-rotation-health-check.md');
const imagePath = join(evidenceDirectory, 'apify-revocation-sanitized.png');
const incidentPath = join(root, 'docs/production-readiness/incidents/2026-08-10-apify-credential-exposure.md');
const statusPath = join(root, 'docs/production-readiness/STATUS.md');
const expectedImageDigest = '686f64afd5851e5c7b6671cb484a06bd5e47e5cfe3c567bfad5c1b005bd4f00a';
const rejectedTimestamps = ['2026-08-11T15:11:00Z', '2026-08-11T12:02:08Z', '2026-08-11T12:03:08Z'];
const credentialShape = /(?:apify_api|sk-(?:proj-)?|AIza|AKIA|xox[abprs])[_-]?[A-Za-z0-9]{12,}|(?:api[_-]?key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i;

function requireText(text, value, label) {
  if (!text.includes(value)) throw new Error(`Missing ${label}.`);
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  }));
  return nested.flat();
}

async function main() {
  const paths = [ownerEvidencePath, revocationPath, healthPath, incidentPath, statusPath];
  if (!paths.every(existsSync) || !existsSync(imagePath)) throw new Error('Required 08A1A evidence path is missing.');
  const [owner, revocation, health, incident, status] = await Promise.all(paths.map((path) => readFile(path, 'utf8')));

  for (const text of [owner, revocation, health, incident, status]) {
    if (credentialShape.test(text)) throw new Error('Credential-shaped content detected in sanitized evidence.');
  }

  for (const [timestamp, label] of [
    ['2026-08-11T10:41:00Z', 'rotation timestamp'],
    ['2026-08-11T11:07:55Z', 'invalidation timestamp'],
    ['2026-08-11T11:08:55Z', 'health-check timestamp'],
    ['2026-08-11T11:11:26Z', 'approval timestamp'],
  ]) requireText(owner, timestamp, label);
  const chronology = ['2026-08-11T10:41:00Z', '2026-08-11T11:07:55Z', '2026-08-11T11:08:55Z', '2026-08-11T11:11:26Z'].map(Date.parse);
  if (!chronology.every(Number.isFinite) || !chronology.every((value, index) => index === 0 || chronology[index - 1] < value)) throw new Error('Owner-evidence chronology is not strictly increasing.');

  for (const value of [
    'SEC-2026-08-10-APIFY-001',
    'APIFY-DEV-PERSONAL-TOKEN-2026-08-11',
    'OWNER_ASSERTED',
    'IMAGE_INSPECTION_NOT_AVAILABLE',
    'Apify owner-evidence record is complete and ready for subgate closure.',
    'Remaining unresolved logical items | 14,848',
    'one deterministic, non-provider test fixture is closed by 08A1C repository evidence',
    'Authorized to review GCP, OpenAI, and unidentified findings | No',
  ]) requireText(owner, value, `owner-evidence field ${value}`);
  for (const value of [
    'Evidence classification | OWNER_ASSERTED',
    'Provider console confirms the old token is revoked/inactive and no 24-hour grace period remains',
    'No token value, token fragment, replacement value, request header, authorization header, or provider response body is recorded.',
  ]) requireText(revocation, value, `revocation field ${value}`);
  for (const value of [
    'Environment | Development only',
    'Health result | Passed',
    'Evidence classification | OWNER_ASSERTED',
    'No token value, request header, authorization header, or secret-bearing command output is recorded.',
  ]) requireText(health, value, `health field ${value}`);
  for (const value of [
    'Apify owner remediation | RECORDED',
    'Apify evidence classification | OWNER_ASSERTED',
    'Apify owner-evidence subgate | PASS',
    'Overall Step 08A | IN PROGRESS',
    '08A1B inventory prerequisite | PASS — run `20260811T214249Z`',
  ]) requireText(incident, value, `incident field ${value}`);
  for (const value of [
    'SUBGATE 08A1A: PASS',
    'STEP 08A: IN PROGRESS',
    'NEXT SUBGATE: 08A1B',
  ]) requireText(status, value, `status field ${value}`);

  const imageDigest = createHash('sha256').update(await readFile(imagePath)).digest('hex');
  if (imageDigest !== expectedImageDigest || !owner.includes(expectedImageDigest) || !revocation.includes(expectedImageDigest)) throw new Error('Revocation PNG digest does not reconcile.');

  const productionReadinessFiles = await markdownFiles(join(root, 'docs/production-readiness'));
  const productionReadinessText = await Promise.all(productionReadinessFiles.map((path) => readFile(path, 'utf8')));
  if (productionReadinessText.some((text) => rejectedTimestamps.some((timestamp) => text.includes(timestamp)))) throw new Error('A superseded Apify timestamp remains in production-readiness Markdown.');

  process.stdout.write('Validated scoped 08A1A Apify owner evidence.\n');
}

main().catch((error) => {
  process.stderr.write(`08A1A owner-evidence validation failed: ${error.message}\n`);
  process.exitCode = 1;
});
