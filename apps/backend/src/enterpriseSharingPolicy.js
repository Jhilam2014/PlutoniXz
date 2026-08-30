import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { canShareApplicationInformation } from "./enterprisePortfolio.js";

const IdSchema = z.string().trim().min(1).max(160);
const TextSchema = z.string().trim().min(1).max(500);

const ApprovalInputSchema = z.object({
  approved: z.boolean(),
  principalId: z.string().trim().max(160).default("")
}).strict();

export const EnterpriseSharingAgreementInputSchema = z.object({
  id: z.string().trim().min(2).max(160).optional(),
  status: z.enum(["draft", "active", "suspended", "revoked"]).default("draft"),
  enterpriseId: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
  sourceProjectId: IdSchema,
  recipientProjectId: IdSchema,
  direction: z.literal("source_to_recipient").default("source_to_recipient"),
  purposes: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  scope: z.object({
    level: z.enum(["enterprise", "account", "client", "application"]),
    accountId: z.string().trim().max(160).default(""),
    clientId: z.string().trim().max(160).default(""),
    label: z.string().trim().max(240).default("")
  }).strict(),
  information: z.object({
    summary: z.string().trim().min(3).max(2000),
    dataCategories: z.array(TextSchema).min(1).max(40),
    classification: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
    region: z.string().trim().max(80).default(""),
    retentionDays: z.number().int().min(0).max(36500).nullable().default(null),
    governanceRules: z.array(TextSchema).max(40).default([]),
    privacyPolicies: z.array(TextSchema).max(40).default([]),
    enterpriseConstraints: z.array(TextSchema).max(40).default([])
  }).strict(),
  approvals: z.object({
    account: ApprovalInputSchema,
    source: ApprovalInputSchema,
    recipient: ApprovalInputSchema
  }).strict(),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional()
}).strict().superRefine((agreement, context) => {
  if (agreement.sourceProjectId === agreement.recipientProjectId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["recipientProjectId"], message: "Source and recipient applications must differ." });
  }
  if (agreement.scope.level === "account" && !agreement.scope.accountId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scope", "accountId"], message: "Account scope requires an account ID." });
  }
  if (agreement.scope.level === "client" && !agreement.scope.clientId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scope", "clientId"], message: "Client scope requires a client ID." });
  }
  if (agreement.status === "active") {
    for (const party of ["account", "source", "recipient"]) {
      const approval = agreement.approvals[party];
      if (!approval.approved || !approval.principalId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["approvals", party], message: `Active sharing requires explicit ${party} approval evidence.` });
      }
    }
  }
});

function cleanList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function enterpriseFor(project = {}) {
  const value = project.enterprise || project.enterpriseMetadata || project.metadata?.enterprise || {};
  return { id: String(value.id || value.enterpriseId || project.enterpriseId || "").trim().toLowerCase(), name: String(value.name || value.enterpriseName || project.enterpriseName || "").trim() };
}

function projectId(project = {}) {
  return String(project.id || project.projectId || "").trim();
}

export function sharingAgreementRegistryPath({ root = process.env.PLUTONIX_PROJECT_ROOT || process.cwd(), env = process.env } = {}) {
  return env.ENTERPRISE_SHARING_AGREEMENTS_PATH || path.join(root, "runtime", "enterprise-sharing", "agreements.json");
}

export async function readEnterpriseSharingAgreementRegistry(options = {}) {
  const filePath = sharingAgreementRegistryPath(options);
  try {
    const agreements = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!Array.isArray(agreements)) return { status: "invalid", configured: true, agreements: [], error: "Agreement registry must be a JSON array.", filePath };
    return { status: "configured", configured: true, agreements, error: "", filePath };
  } catch (error) {
    if (error.code === "ENOENT") return { status: "unconfigured", configured: false, agreements: [], error: "", filePath };
    return { status: "invalid", configured: true, agreements: [], error: "Agreement registry could not be read; sharing remains denied.", filePath };
  }
}

let registryWriteQueue = Promise.resolve();

async function saveEnterpriseSharingAgreementUnlocked(input, { actorId = "", ...options } = {}) {
  const parsed = EnterpriseSharingAgreementInputSchema.parse(input);
  const registry = await readEnterpriseSharingAgreementRegistry(options);
  if (registry.status === "invalid") throw new Error(registry.error);
  const now = new Date().toISOString();
  const id = parsed.id || `sharing-${crypto.randomUUID()}`;
  const approvals = Object.fromEntries(Object.entries(parsed.approvals).map(([party, approval]) => [party, {
    approved: approval.approved,
    ...(approval.approved ? { principalId: approval.principalId || actorId, decidedAt: now } : {})
  }]));
  const agreement = {
    ...parsed,
    id,
    purposes: cleanList(parsed.purposes.map((purpose) => purpose.toLowerCase())),
    information: {
      ...parsed.information,
      dataCategories: cleanList(parsed.information.dataCategories),
      governanceRules: cleanList(parsed.information.governanceRules),
      privacyPolicies: cleanList(parsed.information.privacyPolicies),
      enterpriseConstraints: cleanList(parsed.information.enterpriseConstraints)
    },
    approvals,
    createdAt: registry.agreements.find((candidate) => candidate?.id === id)?.createdAt || now,
    updatedAt: now,
    recordedBy: String(actorId || "").slice(0, 160)
  };
  const agreements = [...registry.agreements.filter((candidate) => candidate?.id !== id), agreement];
  await fs.mkdir(path.dirname(registry.filePath), { recursive: true });
  const temporaryPath = `${registry.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(agreements, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, registry.filePath);
  return agreement;
}

export function saveEnterpriseSharingAgreement(input, options = {}) {
  const write = registryWriteQueue.then(() => saveEnterpriseSharingAgreementUnlocked(input, options));
  registryWriteQueue = write.catch(() => {});
  return write;
}

export function buildApplicationInformationSharingContext({ project, projects = [], agreements = [], purpose = "application_development" } = {}) {
  const selectedProjectId = projectId(project);
  const projectById = new Map(projects.map((candidate) => [projectId(candidate), candidate]).filter(([id]) => id));
  const activePolicies = [];
  const blockedPolicies = [];
  for (const agreement of Array.isArray(agreements) ? agreements : []) {
    if (agreement?.sourceProjectId !== selectedProjectId && agreement?.recipientProjectId !== selectedProjectId) continue;
    const sourceProject = projectById.get(agreement.sourceProjectId);
    const recipientProject = projectById.get(agreement.recipientProjectId);
    if (!sourceProject || !recipientProject) continue;
    const authorized = canShareApplicationInformation({ sourceProject, targetProject: recipientProject, agreement, purpose });
    if (!authorized) {
      blockedPolicies.push({ id: agreement.id, status: agreement.status || "invalid", sourceProjectId: agreement.sourceProjectId, recipientProjectId: agreement.recipientProjectId, purposes: cleanList(agreement.purposes) });
      continue;
    }
    const counterpartId = agreement.sourceProjectId === selectedProjectId ? agreement.recipientProjectId : agreement.sourceProjectId;
    activePolicies.push({
      id: agreement.id,
      enterpriseId: agreement.enterpriseId,
      direction: agreement.sourceProjectId === selectedProjectId ? "outbound" : "inbound",
      sourceProjectId: agreement.sourceProjectId,
      recipientProjectId: agreement.recipientProjectId,
      counterpartProjectId: counterpartId,
      counterpartProjectName: projectById.get(counterpartId)?.name || counterpartId,
      purposes: cleanList(agreement.purposes),
      scope: agreement.scope || { level: "application", label: "" },
      information: {
        summary: String(agreement.information?.summary || "").slice(0, 2000),
        dataCategories: cleanList(agreement.information?.dataCategories),
        classification: agreement.information?.classification || "internal",
        region: String(agreement.information?.region || "").slice(0, 80),
        retentionDays: Number.isInteger(agreement.information?.retentionDays) ? agreement.information.retentionDays : null,
        governanceRules: cleanList(agreement.information?.governanceRules),
        privacyPolicies: cleanList(agreement.information?.privacyPolicies),
        enterpriseConstraints: cleanList(agreement.information?.enterpriseConstraints)
      }
    });
  }
  return {
    version: "enterprise-information-sharing-context/v1",
    applicationId: selectedProjectId,
    enterprise: enterpriseFor(project),
    purpose,
    defaultPolicy: "deny",
    activePolicies,
    blockedPolicies,
    agreementIds: activePolicies.map((policy) => policy.id),
    enterpriseConstraints: cleanList(activePolicies.flatMap((policy) => policy.information.enterpriseConstraints)),
    governanceRules: cleanList(activePolicies.flatMap((policy) => policy.information.governanceRules)),
    privacyPolicies: cleanList(activePolicies.flatMap((policy) => policy.information.privacyPolicies))
  };
}
