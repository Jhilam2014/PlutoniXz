import { classifyProductShape } from "./productShape.js";

function normalizeReferenceIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => (typeof value === "string" ? value : value?.id))
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function normalizeSuppliedData(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || value === null || value === undefined) return [];
    if (typeof value === "string") return [[normalizedKey, value]];
    if (typeof value === "number" || typeof value === "boolean") {
      return [[normalizedKey, String(value)]];
    }
    try {
      return [[normalizedKey, JSON.stringify(value)]];
    } catch {
      return [];
    }
  }));
}

export function normalizeRealDataPreflightPayload(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const referenceCount = Number(source.referenceCount);
  return {
    ...(typeof source.instruction === "string" ? { instruction: source.instruction } : {}),
    ...(typeof source.projectName === "string" ? { projectName: source.projectName } : {}),
    mediaIds: normalizeReferenceIds(source.mediaIds),
    stagedMediaIds: normalizeReferenceIds(source.stagedMediaIds),
    stagedDocumentIds: normalizeReferenceIds(source.stagedDocumentIds),
    ...(Number.isInteger(referenceCount) ? { referenceCount } : {}),
    suppliedData: normalizeSuppliedData(source.suppliedData)
  };
}

function suppliedValueExists(values = {}, id) {
  return String(values?.[id] || "").trim().length > 0;
}

export function analyzeRealDataNeed(input = {}) {
  const instruction = String(input.instruction || "");
  const projectName = String(input.projectName || "");
  const suppliedData = input.suppliedData || {};
  const productDecision = classifyProductShape({ instruction, projectName });
  const artifactLabel = String(productDecision.artifactType || "digital output").replaceAll("_", " ");
  const requiredSurfaces = (productDecision.requiredSurfaces || []).slice(0, 3);
  const requiredCapabilities = (productDecision.requiredCapabilities || [])
    .slice(0, 4)
    .map((capability) => String(capability).replaceAll("_", " "));
  const uiElementsForField = (fallback = []) => {
    const surfaces = requiredSurfaces.length ? requiredSurfaces : fallback;
    return surfaces.length
      ? surfaces
      : ["visible screens", "forms", "lists/tables", "loading, empty, and error states"];
  };
  const backendElementsForField = (fallback = []) => (
    fallback.length
      ? fallback
      : requiredCapabilities.length
        ? requiredCapabilities
        : ["data model", "client/API contract", "validation", "loading and error handling"]
  );
  const text = `${instruction}\n${projectName}`.toLowerCase();
  const suppliedText = Object.values(suppliedData).map((value) => String(value || "")).join("\n");
  const sourceContext = `${instruction}\n${suppliedText}`;
  const mediaCount =
    (input.mediaIds || []).length +
    (input.stagedMediaIds || []).length +
    (input.stagedDocumentIds || []).length +
    Number(input.referenceCount || 0);
  const hasReferenceEvidence = mediaCount > 0;
  const hasApiEvidence =
    /\bhttps?:\/\/\S+|[A-Z][A-Z0-9_]{3,}_(?:API_KEY|TOKEN|URL)|(?:endpoint|webhook|database url|connection string|table name)\s*:\s*\S+/i.test(
      sourceContext
    );
  const hasSuppliedData = Object.values(suppliedData).some((value) => String(value || "").trim().length > 0);
  const placeholderAuthorized =
    /\b(?:use|show|render|keep|allow|leave)\b.{0,30}\b(?:placeholders?|empty placeholders?|empty state|empty data)\b|\b(?:placeholders?|empty state)\b.{0,30}\b(?:allowed|acceptable|ok)\b/i.test(
      sourceContext
    );
  const hasInlineData =
    hasReferenceEvidence ||
    hasApiEvidence ||
    hasSuppliedData ||
    /\b(?:records|content|copy|script|brief|source data|real data)\s*:\s*\S.{20,}/i.test(instruction);
  const requestedArtifacts = [
    [/\b(web\s*app|website|portal|dashboard|crm|marketplace|ecommerce|tool|admin panel|mobile\s*app|ios|android)\b/i, "app"],
    [/\b(pdf|document|report|flyer|brochure|deck|presentation)\b/i, "document"],
    [/\b(video|demo video|reel|animation|motion)\b/i, "video"],
    [/\b(image|poster|banner|thumbnail|logo|creative)\b/i, "image"],
    [/\b(audio|voice|podcast|speech|sound)\b/i, "audio"]
  ]
    .filter(([pattern]) => pattern.test(instruction))
    .map(([, label]) => label);
  const dataSensitive =
    /\b(real|live|integration|backend|api|database|db|finance|financial|invoice|billing|analytics|metrics|revenue|sales|inventory|catalog|users|profiles|orders|transactions|messages|appointments|bookings|product data|business data)\b/i.test(
      instruction
    );
  const explicitIntegrationRequired = /\b(api|backend|database|db|integration|live)\b/i.test(instruction);
  const mediaReferenceRequired =
    /\b(use|using|match|based on|from|edit|transform|include)\b.{0,40}\b(attached|uploaded|reference|photo|image|video|audio|logo|brand asset|source file)\b/i.test(
      instruction
    ) && !hasReferenceEvidence;
  const contentDependent = ["document", "presentation", "image", "video", "audio", "website"].includes(
    productDecision.artifactType
  );
  const projectIdentityLooksGeneric =
    !projectName.trim() ||
    /^(new project|untitled|generated site|plutomix default workspace|plutomix system)$/i.test(projectName.trim());
  const hasNamedSubject =
    !projectIdentityLooksGeneric ||
    /\b(for|about|called|named|brand|company|org|organization|product|startup|business)\s+["']?[A-Z0-9][A-Za-z0-9& ._-]{2,}/.test(
      instruction
    );
  const fields = [];
  const pushField = (field) => {
    if (!fields.some((item) => item.id === field.id)) {
      fields.push({ ...field, valueProvided: suppliedValueExists(suppliedData, field.id) });
    }
  };

  if (contentDependent && !hasNamedSubject) {
    pushField({
      id: "business_context",
      label: "Product or business context",
      type: "text",
      inputKind: "text",
      accept: "",
      required: true,
      placeholder: "Name plus one-line business/product summary",
      reason: "Needed to avoid inventing the subject of the generated artifact.",
      purpose: `Sets the factual subject, identity, and scope of the ${artifactLabel}.`,
      usedFor: requiredSurfaces.length ? requiredSurfaces : [`the primary ${artifactLabel} content`],
      uiElements: uiElementsForField([`primary ${artifactLabel} surface`, "navigation labels", "empty states"]),
      backendElements: backendElementsForField(["project metadata", "content schema", "source attribution"]),
      expectedInput: "A product, organization, or subject name plus one factual sentence describing it."
    });
  }

  if (dataSensitive && !hasInlineData && !placeholderAuthorized) {
    pushField({
      id: "source_data",
      label: explicitIntegrationRequired ? "Data or integration source" : "Source data or content",
      type: "textarea",
      inputKind: "text_or_file",
      accept: ".csv,.json,.txt,.md,.xlsx,.xls,application/pdf",
      required: true,
      placeholder: explicitIntegrationRequired
        ? "Paste records, a source URL/endpoint, or credential env var names; empty placeholders are also allowed"
        : "Paste real records/content or state that empty placeholders should be used",
      reason: "Gotham must use real integration/user-provided data or explicit placeholders.",
      purpose: explicitIntegrationRequired
        ? `Connects the ${artifactLabel} to the requested live or backend data boundary.`
        : `Supplies the factual records and content rendered by the ${artifactLabel}.`,
      usedFor: requiredCapabilities.length
        ? requiredCapabilities
        : ["real content", "loading, empty, and error states"],
      uiElements: uiElementsForField(["tables/lists", "detail panels", "filters", "loading, empty, and error states"]),
      backendElements: explicitIntegrationRequired
        ? backendElementsForField(["API/client contract", "backend adapter", "database or external-service configuration", "credential environment hooks", "failure states"])
        : backendElementsForField(["data model", "source parser", "validation", "state management"]),
      expectedInput: explicitIntegrationRequired
        ? "Records, an endpoint/source URL, table or export name, and credential environment variable names. Secrets should remain in environment configuration."
        : "Pasted records/content, an uploaded CSV/JSON/document, or explicit permission to use empty placeholders."
    });
  }

  if (explicitIntegrationRequired && hasInlineData && !hasApiEvidence && !placeholderAuthorized) {
    pushField({
      id: "integration_source",
      label: "Integration or backend source",
      type: "textarea",
      inputKind: "integration_reference",
      accept: "",
      required: true,
      placeholder: "Endpoint, table/export name, credential env var names, or say which data must remain empty",
      reason: "The requested live backend/integration source cannot be guessed safely.",
      purpose: `Defines where the ${artifactLabel} reads and writes the requested real data.`,
      usedFor: requiredCapabilities.length
        ? requiredCapabilities
        : ["backend adapter", "configuration hooks", "failure states"],
      uiElements: uiElementsForField(["connected-data controls", "settings/configuration states", "loading and error surfaces"]),
      backendElements: backendElementsForField(["API/client contract", "backend adapter", "database or service connector", "credential environment hooks", "failure states"]),
      expectedInput: "Endpoint or service name, table/export identifier, credential environment variable names, or an explicit empty-state instruction."
    });
  }

  if (mediaReferenceRequired) {
    pushField({
      id: "media_reference",
      label: "Media reference",
      type: "textarea",
      inputKind: "text_or_file",
      accept: "image/*,video/*,audio/*,application/pdf,.txt,.md",
      required: true,
      placeholder: "Describe/upload the reference asset, script, dimensions, style constraints, or allowed placeholder",
      reason: "Media artifacts need authorized source material or explicit placeholder direction.",
      purpose: `Provides the source material Gotham must use or transform in the ${artifactLabel}.`,
      usedFor: [
        `the primary ${artifactLabel}`,
        ...(productDecision.secondaryArtifactTypes || []).slice(0, 2).map((type) => `${String(type).replaceAll("_", " ")} output`)
      ],
      uiElements: uiElementsForField([`primary ${artifactLabel} canvas`, "reference preview", "asset state", "output controls"]),
      backendElements: backendElementsForField(["asset registry", "file reference contract", "source metadata", "generation fallback state"]),
      expectedInput: "Upload the source asset or provide its script, dimensions, usage constraints, and explicit placeholder direction."
    });
  }

  const requiredFields = fields.slice(0, 3);
  const missingFields = requiredFields.filter((field) => !suppliedValueExists(suppliedData, field.id));
  return {
    status: missingFields.length ? "needs_input" : "ready",
    requestedArtifacts: [...new Set(requestedArtifacts)],
    productDecision,
    requiredFields,
    message: requiredFields.length
      ? missingFields.length
        ? "Minimal real-data inputs are required before Gotham can continue without inventing data."
        : "Required real-data inputs are ready for the next Gotham iteration."
      : "Instruction has enough supplied data or can proceed with explicit placeholders."
  };
}
