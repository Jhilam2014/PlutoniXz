import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte", ".html", ".json", ".yaml", ".yml", ".sql", ".prisma", ".py", ".go", ".java", ".rb", ".php", ".cs"]);
const SOURCE_BASENAMES = new Set(["dockerfile", "compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml", "package.json", "tsconfig.json", "vite.config.js", "vite.config.ts", "next.config.js", "next.config.mjs"]);
const EXCLUDED_DIRECTORIES = new Set([".git", ".hg", ".svn", ".agentic", "node_modules", "vendor", "dist", "build", ".next", ".nuxt", ".vite", "coverage", "uploads", "tmp", "temp", ".cache", ".chroma", "runtime", "exports"]);
const EXCLUDED_FILE_NAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"]);
const MAX_FILES = 400;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
const PUBLISH_THRESHOLD = 0.60;
export const ANALYSIS_VERSION = 9;
const MAX_SUBFUNCTIONALITIES_PER_FUNCTIONALITY = 12;

const ModelAlternativesSchema = z.object({
  alternatives: z.array(z.object({
    functionalityId: z.string().min(1).max(160),
    title: z.string().min(1).max(240),
    description: z.string().min(1).max(1200),
    pattern: z.string().min(1).max(120),
    evidenceIds: z.array(z.string().min(1).max(160)).min(1).max(20),
    rationale: z.string().max(1200).optional()
  }).strict()).max(80)
}).strict();

const MODEL_RESPONSE_FORMAT = {
  type: "json_schema",
  name: "architecture_branch_alternatives",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["alternatives"],
    properties: {
      alternatives: {
        type: "array",
        maxItems: 80,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["functionalityId", "title", "description", "pattern", "evidenceIds"],
          properties: {
            functionalityId: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            pattern: { type: "string" },
            evidenceIds: { type: "array", minItems: 1, items: { type: "string" } },
            rationale: { type: "string" }
          }
        }
      }
    }
  }
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function shortId(value, size = 18) {
  return sha256(String(value)).slice(0, size);
}

function safeKey(value, fallback = "item") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || fallback;
}

function bounded(value, max) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function isSecretFile(relativePath) {
  const normalized = relativePath.toLowerCase();
  return /(^|\/)\.env(?:\.|$)/.test(normalized)
    || /(^|\/)(?:secrets?|credentials?|private[_-]?keys?)(?:\/|$)/.test(normalized)
    || /(?:^|\/)(?:id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.key)$/i.test(normalized);
}

export function redactSecretShapedValues(value) {
  return String(value || "")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, "Bearer [REDACTED]")
    .replace(/\b(sk|pk|rk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_\-]{12,}\b/gi, "[REDACTED_TOKEN]")
    .replace(/((?:api[_-]?key|access[_-]?token|auth(?:orization)?|client[_-]?secret|password|passwd|secret)\s*[:=]\s*["']?)([^\s"',;}]{6,})/gi, "$1[REDACTED]");
}

function lineForOffset(text, offset) {
  return text.slice(0, Math.max(0, offset)).split("\n").length;
}

function evidenceFor({ relativePath, text, offset = 0, label, digest }) {
  const line = lineForOffset(text, offset);
  const key = `${relativePath}:${line}:${label}`;
  return {
    id: `source-${shortId(key, 24)}`,
    type: "artifact",
    source: "project_source_scan",
    observedAt: new Date().toISOString(),
    confidence: 1,
    accessPolicy: "workspace",
    reference: `${relativePath}:${line}`,
    digest
  };
}

function sourceFileAllowed(relativePath, stat) {
  const normalized = relativePath.split(path.sep).join("/");
  const base = path.basename(normalized).toLowerCase();
  if (!stat?.isFile() || stat.size > MAX_FILE_BYTES || isSecretFile(normalized) || EXCLUDED_FILE_NAMES.has(base)) return false;
  return SOURCE_EXTENSIONS.has(path.extname(base)) || SOURCE_BASENAMES.has(base);
}

async function collectSourceFiles(workspaceDir) {
  const root = await fs.realpath(workspaceDir);
  const files = [];
  let totalBytes = 0;
  async function walk(directory) {
    if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) return;
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) break;
      if (entry.isDirectory() && excludedDirectory(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(root, absolute).split(path.sep).join("/");
      const stat = await fs.stat(absolute);
      if (!sourceFileAllowed(relativePath, stat)) continue;
      const bytes = Math.min(stat.size, MAX_FILE_BYTES);
      if (totalBytes + bytes > MAX_TOTAL_BYTES) continue;
      files.push({
        absolute,
        relativePath,
        size: stat.size,
        modifiedAt: new Date(stat.mtimeMs || stat.birthtimeMs || 0).toISOString(),
        discoveryOrder: files.length
      });
      totalBytes += bytes;
    }
  }
  await walk(root);
  return { root, files, totalBytes, limited: files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES };
}

/**
 * A deliberately bounded, language-neutral cyclomatic-complexity estimate.
 * It is not presented as a compiler-grade metric: it captures only observable
 * branch points from the allowlisted source text and gives the architecture
 * lens a consistent source-derived sizing signal without executing code.
 */
export function estimateCyclomaticComplexity(source) {
  const text = String(source || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, " ")
    .replace(/`(?:\\.|[^`])*`/g, " ");
  const decisionPoints = text.match(/\b(?:if|for|while|case|catch|when)\b|&&|\|\||\?\?(?![=])|\?(?![?.:])/g) || [];
  return Math.max(1, 1 + decisionPoints.length);
}

function sourceMetricsFor(text) {
  const codeLineCount = String(text || "")
    .split("\n")
    .filter((line) => line.trim() && !/^\s*(?:\/\/|#|\/\*|\*)/.test(line))
    .length;
  return {
    sourceFileCount: 1,
    codeLineCount,
    cyclomaticComplexity: estimateCyclomaticComplexity(text)
  };
}

function mergeSourceMetrics(existing, incoming) {
  return {
    sourceFileCount: Math.max(0, Number(existing?.sourceFileCount || 0)) + Math.max(0, Number(incoming?.sourceFileCount || 0)),
    codeLineCount: Math.max(0, Number(existing?.codeLineCount || 0)) + Math.max(0, Number(incoming?.codeLineCount || 0)),
    cyclomaticComplexity: Math.max(1, Number(existing?.cyclomaticComplexity || 1)) + Math.max(1, Number(incoming?.cyclomaticComplexity || 1))
  };
}

function excludedDirectory(name) {
  const normalized = String(name || "").toLowerCase();
  return EXCLUDED_DIRECTORIES.has(normalized)
    || normalized === "site-packages"
    || normalized === "__pycache__"
    || normalized === ".venv"
    || normalized === "venv"
    || normalized.startsWith(".venv-")
    || normalized.endsWith(".venv")
    || normalized.endsWith("-venv");
}

function registerFunctionality(registry, { category, entityType = "functionality", key, label, relativePath, text, offset, digest, observedCurrent, sourceHints = {}, modifiedAt = "", discoveryOrder = 0 }) {
  const id = `${category}-${safeKey(key, shortId(`${relativePath}:${offset}`))}`.slice(0, 120);
  const evidence = evidenceFor({ relativePath, text, offset, label, digest });
  const metrics = sourceMetricsFor(text);
  const chronology = {
    sourceModifiedAt: modifiedAt || "",
    sourcePath: relativePath,
    sourceOffset: Math.max(0, Number(offset) || 0),
    discoveryOrder: Math.max(0, Number(discoveryOrder) || 0)
  };
  const existing = registry.get(id);
  if (existing) {
    if (!existing.evidence.some((item) => item.id === evidence.id)) {
      existing.evidence.push(evidence);
      existing.metrics = mergeSourceMetrics(existing.metrics, metrics);
    }
    existing.sourceHints = { ...(existing.sourceHints || {}), ...sourceHints };
    if (
      chronology.discoveryOrder < Number(existing.chronology?.discoveryOrder ?? Number.MAX_SAFE_INTEGER)
      || (chronology.discoveryOrder === Number(existing.chronology?.discoveryOrder ?? Number.MAX_SAFE_INTEGER)
        && chronology.sourceOffset < Number(existing.chronology?.sourceOffset ?? Number.MAX_SAFE_INTEGER))
    ) existing.chronology = chronology;
    return existing;
  }
  const functionality = {
    id,
    label: bounded(label, 240),
    category,
    entityType,
    evidence: [evidence],
    observedCurrent: {
      inferenceRole: "observed_current",
      description: bounded(observedCurrent, 1200),
      sourceOnly: true
    },
    sourceHints,
    chronology,
    metrics,
    sourceDigest: digest
  };
  registry.set(id, functionality);
  return functionality;
}

function componentNameFromPath(relativePath) {
  const base = path.basename(relativePath, path.extname(relativePath));
  return base.replace(/[^A-Za-z0-9_$]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()) || "UI surface";
}

function registerRoute(registry, file, method, routePath, offset) {
  registerFunctionality(registry, {
    category: "api",
    entityType: "api_route",
    key: `${file.relativePath}-${method}-${routePath}`,
    label: `${method} ${routePath}`,
    relativePath: file.relativePath,
    text: file.text,
    offset,
    digest: file.digest,
    modifiedAt: file.modifiedAt,
    discoveryOrder: file.discoveryOrder,
    observedCurrent: `The ${method} ${routePath} application route is implemented in source.`,
    sourceHints: { route: { method, path: routePath, sourcePath: file.relativePath } }
  });
}

function inferredUiRoutePath(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  const nextRoute = /(?:^|\/)app\/(.*?)(?:\/page)?\.(?:jsx?|tsx?)$/i.exec(normalized);
  if (nextRoute) {
    const segments = String(nextRoute[1] || "")
      .split("/")
      .filter((segment) => segment && !/^\(.*\)$/.test(segment) && !segment.startsWith("_"));
    return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
  }
  const pageRoute = /(?:^|\/)pages\/(.*?)\.(?:jsx?|tsx?|vue|svelte)$/i.exec(normalized);
  if (!pageRoute) return "";
  const route = String(pageRoute[1] || "").replace(/(?:^|\/)index$/i, "");
  return `/${route}`.replace(/\/$/, "") || "/";
}

function uiRole(component, relativePath, routePath, primaryComponent = false) {
  const basename = path.basename(relativePath, path.extname(relativePath));
  if (primaryComponent && (routePath || /(?:^|\/)(?:app|pages)\//i.test(relativePath) || /(?:Page|Screen|View)$/.test(component))) return "page";
  if (primaryComponent && (/^(?:App|Main|Home|Dashboard|Index)$/i.test(component) || /^(?:app|main|home|dashboard|index)$/i.test(basename))) return "major_feature";
  return "component";
}

function humanizeUiIdentifier(value = "") {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function uiAttribute(attributes = "", name = "") {
  return new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(attributes)?.[1] || "";
}

function nearestUiComponent(components = [], offset = 0) {
  return components
    .filter((component) => Number(component.index || 0) <= offset)
    .sort((left, right) => Number(right.index || 0) - Number(left.index || 0))[0]?.[1]
    || components[0]?.[1]
    || "";
}

function serviceDescriptor(relativePath, text) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (!/(?:^|\/)(?:services?|integrations?|cloud|functions?|adapters?|repositories?)(?:\/|\.|$)/i.test(normalized)) return null;
  const cloud = /\b(?:onRequest|onCall|https\.onRequest|APIGatewayProxyHandler|LambdaClient|firebase-functions|@google-cloud|aws-sdk|@aws-sdk|azure\/functions)\b/i.test(text);
  const base = componentNameFromPath(relativePath).replace(/\b(?:Jsx?|Tsx?|Mjs|Cjs|Py)\b$/i, "").trim();
  return {
    entityType: cloud ? "cloud_function" : "service",
    label: /\b(?:service|function|repository|adapter|integration)\b/i.test(base) ? base : `${base} ${cloud ? "Cloud Function" : "Service"}`
  };
}

function detectFileFunctionalities(registry, file) {
  const { relativePath, text, digest } = file;
  const extension = path.extname(relativePath).toLowerCase();
  const isTest = /(?:\.test|\.spec)\.[^.]+$/i.test(relativePath);
  const containsJsx = /<\s*[A-Z][A-Za-z0-9._-]*(?:\s|\/?>)|<\s*(?:main|section|article|div|button|form|nav|header|footer)\b/i.test(text);
  const uiSource = !isTest && ([".jsx", ".tsx", ".vue", ".svelte", ".html"].includes(extension) || containsJsx);
  if (uiSource) {
    const componentPattern = /(?:(?:export\s+default\s+|export\s+)?function|(?:export\s+)?const)\s+([A-Z][A-Za-z0-9_$]*)\b/g;
    const components = Array.from(text.matchAll(componentPattern));
    const records = components.length ? components : [{ 1: componentNameFromPath(relativePath), index: 0 }];
    const routePath = inferredUiRoutePath(relativePath);
    const expectedComponent = componentNameFromPath(relativePath).replace(/\s+/g, "");
    const primaryComponentIndex = Math.max(0, records.findIndex((match) =>
      String(match[1] || "").toLowerCase() === expectedComponent.toLowerCase()
      || /^(?:App|Main|Home|Dashboard|Index)$/.test(String(match[1] || ""))));
    for (const [componentIndex, match] of records.entries()) {
      const component = String(match[1] || componentNameFromPath(relativePath));
      const role = uiRole(component, relativePath, routePath, componentIndex === primaryComponentIndex);
      registerFunctionality(registry, {
        category: "ui",
        entityType: "ui_surface",
        key: `${relativePath}:${component}`,
        label: component,
        relativePath,
        text,
        offset: match.index || 0,
        digest,
        modifiedAt: file.modifiedAt,
        discoveryOrder: file.discoveryOrder,
        observedCurrent: `The ${component} UI surface is implemented in ${relativePath}.`,
        sourceHints: { ui: { component, sourcePath: relativePath, role, routePath } }
      });
    }
    const interactiveElementPattern = /<\s*(button|form|input|select|textarea|nav|dialog|table|canvas|a)\b([^>]*)>/gi;
    let elementOrder = 0;
    for (const match of text.matchAll(interactiveElementPattern)) {
      const tag = String(match[1] || "element").toLowerCase();
      const attributes = String(match[2] || "");
      const offset = match.index || 0;
      const ownerComponent = nearestUiComponent(records, offset);
      const trailingText = String(text.slice(offset + match[0].length, offset + match[0].length + 160))
        .replace(/<[^>]+>/g, " ")
        .split(/[<{\n]/)[0]
        .replace(/\s+/g, " ")
        .trim();
      const elementLabel = uiAttribute(attributes, "aria-label")
        || uiAttribute(attributes, "title")
        || uiAttribute(attributes, "name")
        || uiAttribute(attributes, "id")
        || uiAttribute(attributes, "placeholder")
        || trailingText
        || `${humanizeUiIdentifier(tag)} ${elementOrder + 1}`;
      const interactionMatches = Array.from(attributes.matchAll(/\b(on[A-Z][A-Za-z]+)\s*=\s*\{\s*([^}]{1,180})\}/g));
      const element = registerFunctionality(registry, {
        category: "ui",
        entityType: "ui_element",
        key: `${relativePath}:${tag}:${offset}`,
        label: bounded(elementLabel, 120),
        relativePath,
        text,
        offset,
        digest,
        modifiedAt: file.modifiedAt,
        discoveryOrder: file.discoveryOrder,
        observedCurrent: `The ${elementLabel} ${tag} UI element is implemented in ${relativePath}.`,
        sourceHints: { ui: { role: "element", tag, sourcePath: relativePath, ownerComponent, hasInteraction: interactionMatches.length > 0 } }
      });
      elementOrder += 1;
      for (const interaction of interactionMatches) {
        const event = String(interaction[1] || "interaction").replace(/^on/, "");
        const expression = String(interaction[2] || "").trim();
        const handler = /^([A-Za-z_$][\w$]*)\s*(?:\(|$)/.exec(expression)?.[1] || "";
        const featureLabel = handler
          ? humanizeUiIdentifier(handler)
          : `${humanizeUiIdentifier(event)}: ${bounded(elementLabel, 72)}`;
        registerFunctionality(registry, {
          category: "ui",
          entityType: "ui_feature",
          key: `${relativePath}:${tag}:${offset}:${interaction[1]}`,
          label: featureLabel,
          relativePath,
          text,
          offset: offset + (interaction.index || 0),
          digest,
          modifiedAt: file.modifiedAt,
          discoveryOrder: file.discoveryOrder,
          observedCurrent: `The ${featureLabel} interaction feature is bound to the ${elementLabel} ${tag} element.`,
          sourceHints: { feature: { sourcePath: relativePath, ownerElementId: element.id, ownerComponent, handler, event, elementTag: tag } }
        });
      }
    }
  }
  const service = !isTest ? serviceDescriptor(relativePath, text) : null;
  if (service) {
    registerFunctionality(registry, {
      category: service.entityType === "cloud_function" ? "integration" : "service",
      entityType: service.entityType,
      key: `${relativePath}:${service.entityType}`,
      label: service.label,
      relativePath,
      text,
      offset: 0,
      digest,
      modifiedAt: file.modifiedAt,
      discoveryOrder: file.discoveryOrder,
      observedCurrent: `The ${service.label} boundary is implemented in ${relativePath}.`,
      sourceHints: { service: { kind: service.entityType, sourcePath: relativePath } }
    });
  }
  const routePattern = /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  for (const match of text.matchAll(routePattern)) {
    registerRoute(registry, file, String(match[1]).toUpperCase(), String(match[2]), match.index || 0);
  }
  const pythonRoutePattern = /@(?:app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(pythonRoutePattern)) {
    registerRoute(registry, file, String(match[1]).toUpperCase(), String(match[2]), match.index || 0);
  }
  const datasourcePattern = /\bdatasource\s+([A-Za-z_$][\w$]*)\s*\{([\s\S]{0,700}?)\}/gi;
  for (const match of text.matchAll(datasourcePattern)) {
    const connection = String(match[1]);
    const provider = /\bprovider\s*=\s*["']([^"']+)["']/i.exec(match[2] || "")?.[1] || "database";
    registerFunctionality(registry, {
      category: "data",
      entityType: "database_connection",
      key: `${relativePath}:datasource:${connection}`,
      label: `${connection} database (${provider})`,
      relativePath,
      text,
      offset: match.index || 0,
      digest,
      modifiedAt: file.modifiedAt,
      discoveryOrder: file.discoveryOrder,
      observedCurrent: `The ${connection} ${provider} database connection is declared in source.`,
      sourceHints: { database: { connection, provider, sourcePath: relativePath } }
    });
  }
  const clientPattern = /\b(?:new\s+PrismaClient|mongoose\s*\.\s*connect|createConnection\s*\(|new\s+Pool\s*\(|knex\s*\(|new\s+Sequelize\s*\()/i;
  const clientMatch = clientPattern.exec(text);
  if (clientMatch) {
    registerFunctionality(registry, {
      category: "data",
      entityType: "database_connection",
      key: `${relativePath}:client`,
      label: `Database connection: ${relativePath}`,
      relativePath,
      text,
      offset: clientMatch.index || 0,
      digest,
      modifiedAt: file.modifiedAt,
      discoveryOrder: file.discoveryOrder,
      observedCurrent: `A database client or connection is instantiated in ${relativePath}.`,
      sourceHints: { database: { client: clientMatch[0], sourcePath: relativePath } }
    });
  }
  const tablePatterns = [
    /\bmodel\s+([A-Za-z_$][\w$]*)\b/g,
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`']?([A-Za-z_$][\w$]*)/gi,
    /\b(?:mongoose\s*\.\s*)?model\s*\(\s*["']([A-Za-z_$][\w$]*)["']/gi
  ];
  for (const tablePattern of tablePatterns) {
    for (const match of text.matchAll(tablePattern)) {
      const table = String(match[1]);
      registerFunctionality(registry, {
        category: "data",
        entityType: "database_table",
        key: `${relativePath}:table:${table}`,
        label: `Table: ${table}`,
        relativePath,
        text,
        offset: match.index || 0,
        digest,
        modifiedAt: file.modifiedAt,
        discoveryOrder: file.discoveryOrder,
        observedCurrent: `The ${table} database model or table is defined in source.`,
        sourceHints: { database: { table, sourcePath: relativePath } }
      });
    }
  }
}

function sourcePathForEntity(entity) {
  return sourcePathFromReference(entity?.evidence?.[0]?.reference || entity?.sourceHints?.ui?.sourcePath || entity?.sourceHints?.feature?.sourcePath || entity?.sourceHints?.route?.sourcePath || entity?.sourceHints?.database?.sourcePath || entity?.sourceHints?.service?.sourcePath || "");
}

function localImportsForSource(sourcePath, sourceByPath) {
  const file = sourceByPath.get(sourcePath);
  if (!file) return [];
  return Array.from(String(file.text || "").matchAll(/(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(|import\s*\()["']([^"']+)["']/g))
    .map((match) => ({
      sourcePath: resolveLocalImport(sourcePath, match[1], sourceByPath),
      importedFrom: sourcePath,
      offset: match.index || 0
    }))
    .filter((row) => row.sourcePath);
}

function reachableLocalImports(sourcePath, sourceByPath, { maxDepth = 5, stopAtPath = () => false } = {}) {
  const reached = [];
  const visited = new Set([sourcePath]);
  const queue = [{ sourcePath, depth: 0, chain: [] }];
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.depth >= maxDepth) continue;
    for (const imported of localImportsForSource(current.sourcePath, sourceByPath)) {
      if (visited.has(imported.sourcePath)) continue;
      visited.add(imported.sourcePath);
      const row = { ...imported, depth: current.depth + 1, chain: [...current.chain, imported] };
      reached.push(row);
      if (!stopAtPath(imported.sourcePath)) queue.push(row);
    }
  }
  return reached;
}

function normalizedRoutePath(value) {
  const routePath = String(value || "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return routePath || "/";
}

function deriveApplicationLinks(functionalities, sourceByPath) {
  const links = new Map();
  const uiSurfaces = functionalities.filter((item) => item.entityType === "ui_surface");
  const uiElements = functionalities.filter((item) => item.entityType === "ui_element");
  const uiFeatures = functionalities.filter((item) => item.entityType === "ui_feature");
  const routes = functionalities.filter((item) => item.entityType === "api_route");
  const databases = functionalities.filter((item) => String(item.entityType || "").startsWith("database_"));
  const services = functionalities.filter((item) => ["service", "cloud_function"].includes(item.entityType));
  const entitiesBySourcePath = new Map();
  for (const entity of functionalities) {
    const sourcePath = sourcePathForEntity(entity);
    const rows = entitiesBySourcePath.get(sourcePath) || [];
    rows.push(entity);
    entitiesBySourcePath.set(sourcePath, rows);
  }
  const uiRank = (surface) => ({ major_feature: 0, page: 1, component: 2 }[surface.sourceHints?.ui?.role] ?? 3);
  const primaryUiForPath = (sourcePath) => (entitiesBySourcePath.get(sourcePath) || [])
    .filter((entity) => entity.entityType === "ui_surface")
    .sort((left, right) => uiRank(left) - uiRank(right) || Number(left.chronology?.sourceOffset || 0) - Number(right.chronology?.sourceOffset || 0))[0];
  const isUiSourcePath = (sourcePath) => (entitiesBySourcePath.get(sourcePath) || []).some((entity) => entity.entityType === "ui_surface");
  const isServiceSourcePath = (sourcePath) => (entitiesBySourcePath.get(sourcePath) || []).some((entity) => ["service", "cloud_function"].includes(entity.entityType));
  const importedSourcePaths = (sourcePath) => localImportsForSource(sourcePath, sourceByPath);
  const evidenceFromImportChain = (chain = [], label = "application-import-chain") => chain.flatMap((edge) => {
    const file = sourceByPath.get(edge.importedFrom);
    if (!file) return [];
    return [evidenceFor({
      relativePath: edge.importedFrom,
      text: file.text,
      offset: edge.offset,
      label: `${label}:${edge.importedFrom}:${edge.sourcePath}`,
      digest: file.digest
    })];
  });
  const add = ({ sourceEntityId, targetEntityId, type, sourcePath, offset, confidence = 1, importChain = [] }) => {
    if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId) return;
    const file = sourceByPath.get(sourcePath);
    if (!file) return;
    const primaryEvidence = evidenceFor({
      relativePath: sourcePath,
      text: file.text,
      offset,
      label: `${type}:${sourceEntityId}:${targetEntityId}`,
      digest: file.digest
    });
    const evidence = [primaryEvidence, ...evidenceFromImportChain(importChain, type)]
      .filter((item, index, rows) => rows.findIndex((row) => row.id === item.id) === index);
    const key = `${type}:${sourceEntityId}:${targetEntityId}:${evidence.map((item) => item.reference).join("|")}`;
    if (!links.has(key)) links.set(key, { id: `application-link:${shortId(key, 24)}`, sourceEntityId, targetEntityId, type, confidence, evidence });
  };

  for (const [sourcePath, localEntities] of entitiesBySourcePath) {
    const localUi = localEntities.filter((entity) => entity.entityType === "ui_surface").sort((left, right) => uiRank(left) - uiRank(right));
    const parentSurface = localUi[0];
    for (const childSurface of localUi.slice(1)) {
      const relationshipType = childSurface.sourceHints?.ui?.role === "component" ? "contains_ui_element" : "contains_feature";
      add({ sourceEntityId: parentSurface.id, targetEntityId: childSurface.id, type: relationshipType, sourcePath, offset: childSurface.chronology?.sourceOffset || 0 });
    }
    for (const element of localEntities.filter((entity) => entity.entityType === "ui_element")) {
      const owner = localUi.find((surface) => surface.sourceHints?.ui?.component === element.sourceHints?.ui?.ownerComponent) || parentSurface;
      if (owner) add({ sourceEntityId: owner.id, targetEntityId: element.id, type: "contains_ui_element", sourcePath, offset: element.chronology?.sourceOffset || 0 });
    }
    for (const feature of localEntities.filter((entity) => entity.entityType === "ui_feature")) {
      const ownerElementId = feature.sourceHints?.feature?.ownerElementId;
      const owner = localEntities.find((entity) => entity.id === ownerElementId)
        || localUi.find((surface) => surface.sourceHints?.ui?.component === feature.sourceHints?.feature?.ownerComponent)
        || parentSurface;
      if (owner) add({ sourceEntityId: owner.id, targetEntityId: feature.id, type: "has_ui_feature", sourcePath, offset: feature.chronology?.sourceOffset || 0 });
    }
    const file = sourceByPath.get(sourcePath);
    if (!file || !parentSurface) continue;
    for (const imported of importedSourcePaths(sourcePath)) {
      for (const childSurface of (entitiesBySourcePath.get(imported.sourcePath) || []).filter((entity) => entity.entityType === "ui_surface")) {
        if (new RegExp(`<\\s*${childSurface.sourceHints?.ui?.component || childSurface.label}\\b`).test(file.text)) {
          const relationshipType = childSurface.sourceHints?.ui?.role === "component" ? "contains_ui_element" : "contains_feature";
          add({ sourceEntityId: parentSurface.id, targetEntityId: childSurface.id, type: relationshipType, sourcePath, offset: imported.offset });
        }
      }
    }
    for (const match of file.text.matchAll(/<\s*Route\b[^>]*\bpath\s*=\s*["']([^"']+)["'][^>]*\belement\s*=\s*\{\s*<\s*([A-Z][\w$]*)/g)) {
      const childSurface = uiSurfaces.find((surface) => surface.sourceHints?.ui?.component === match[2]);
      if (!childSurface) continue;
      childSurface.sourceHints.ui.routePath = normalizedRoutePath(match[1]);
      add({ sourceEntityId: parentSurface.id, targetEntityId: childSurface.id, type: "contains_subpage", sourcePath, offset: match.index || 0 });
    }
  }

  const routedSurfaces = uiSurfaces.filter((surface) => surface.sourceHints?.ui?.routePath);
  for (const child of routedSurfaces) {
    const childRoute = normalizedRoutePath(child.sourceHints.ui.routePath);
    const parent = routedSurfaces
      .filter((candidate) => candidate.id !== child.id)
      .map((candidate) => ({ candidate, route: normalizedRoutePath(candidate.sourceHints.ui.routePath) }))
      .filter(({ route }) => route === "/" || (childRoute.startsWith(`${route}/`) && route !== childRoute))
      .sort((left, right) => right.route.length - left.route.length)[0]?.candidate;
    if (parent) add({ sourceEntityId: parent.id, targetEntityId: child.id, type: "contains_subpage", sourcePath: sourcePathForEntity(parent), offset: parent.chronology?.sourceOffset || 0 });
  }

  const dependencySources = [
    ...uiSurfaces.filter((surface) => ["major_feature", "page"].includes(surface.sourceHints?.ui?.role)),
    ...uiElements.filter((element) => element.sourceHints?.ui?.hasInteraction),
    ...uiFeatures
  ];
  for (const sourceEntity of dependencySources) {
    const sourcePath = sourcePathForEntity(sourceEntity);
    const file = sourceByPath.get(sourcePath);
    if (!file) continue;
    const importedScope = reachableLocalImports(sourcePath, sourceByPath, {
      stopAtPath: (candidatePath) => isUiSourcePath(candidatePath) || isServiceSourcePath(candidatePath)
    });
    const sourceScope = [{ sourcePath, chain: [] }, ...importedScope.map((row) => ({ sourcePath: row.sourcePath, chain: row.chain }))];
    for (const scope of sourceScope) {
      const scopeFile = sourceByPath.get(scope.sourcePath);
      if (!scopeFile) continue;
      for (const match of scopeFile.text.matchAll(/(?:fetch\s*\(|axios(?:\.(?:get|post|put|patch|delete))?\s*\()\s*["'`]([^"'`?#]+)/g)) {
        const requestedPath = normalizedRoutePath(match[1]);
        for (const route of routes.filter((item) => normalizedRoutePath(item.sourceHints?.route?.path) === requestedPath)) {
          add({ sourceEntityId: sourceEntity.id, targetEntityId: route.id, type: "ui_calls_api", sourcePath: scope.sourcePath, offset: match.index || 0, importChain: scope.chain });
        }
      }
      for (const service of (entitiesBySourcePath.get(scope.sourcePath) || []).filter((entity) => ["service", "cloud_function"].includes(entity.entityType))) {
        add({ sourceEntityId: sourceEntity.id, targetEntityId: service.id, type: "ui_uses_service", sourcePath: scope.sourcePath, offset: 0, importChain: scope.chain });
      }
    }
  }

  for (const route of routes) {
    const sourcePath = sourcePathForEntity(route);
    const file = sourceByPath.get(sourcePath);
    if (!file) continue;
    for (const imported of reachableLocalImports(sourcePath, sourceByPath, { stopAtPath: isServiceSourcePath })) {
      for (const service of (entitiesBySourcePath.get(imported.sourcePath) || []).filter((entity) => ["service", "cloud_function"].includes(entity.entityType))) {
        add({ sourceEntityId: route.id, targetEntityId: service.id, type: "api_calls_service", sourcePath: imported.importedFrom, offset: imported.offset, importChain: imported.chain });
      }
    }
  }

  for (const service of services) {
    const sourcePath = sourcePathForEntity(service);
    if (!sourceByPath.has(sourcePath)) continue;
    for (const imported of reachableLocalImports(sourcePath, sourceByPath, { stopAtPath: isServiceSourcePath })) {
      for (const dependency of (entitiesBySourcePath.get(imported.sourcePath) || []).filter((entity) => ["service", "cloud_function"].includes(entity.entityType))) {
        add({ sourceEntityId: service.id, targetEntityId: dependency.id, type: "service_uses_service", sourcePath: imported.importedFrom, offset: imported.offset, importChain: imported.chain });
      }
    }
  }

  const databaseOperation = /\b(?:prisma\s*\.|sequelize\s*\.|mongoose\s*\.|knex\s*\(|\.query\s*\(|SELECT\s+|INSERT\s+|UPDATE\s+|DELETE\s+)/i;
  for (const route of routes) {
    const sourcePath = sourcePathForEntity(route);
    const file = sourceByPath.get(sourcePath);
    if (!file) continue;
    const localDatabases = databases.filter((item) => sourcePathForEntity(item) === sourcePath);
    const imported = reachableLocalImports(sourcePath, sourceByPath, { stopAtPath: isServiceSourcePath })
      .filter((row) => !isServiceSourcePath(row.sourcePath));
    const importedPaths = imported.map((row) => row.sourcePath);
    const operationScope = [{ sourcePath, chain: [] }, ...imported.map((row) => ({ sourcePath: row.sourcePath, chain: row.chain }))]
      .find((row) => databaseOperation.test(sourceByPath.get(row.sourcePath)?.text || ""));
    if (!operationScope) continue;
    const linkedDatabases = databases.filter((item) => localDatabases.includes(item) || importedPaths.includes(sourcePathForEntity(item)));
    for (const database of linkedDatabases) {
      const operationFile = sourceByPath.get(operationScope.sourcePath);
      add({ sourceEntityId: route.id, targetEntityId: database.id, type: "api_uses_database", sourcePath: operationScope.sourcePath, offset: operationFile.text.search(databaseOperation), importChain: operationScope.chain });
    }
  }
  for (const service of services) {
    const sourcePath = sourcePathForEntity(service);
    const file = sourceByPath.get(sourcePath);
    if (!file) continue;
    const imported = reachableLocalImports(sourcePath, sourceByPath, { stopAtPath: isServiceSourcePath })
      .filter((row) => !isServiceSourcePath(row.sourcePath));
    const importedPaths = imported.map((row) => row.sourcePath);
    const operationScope = [{ sourcePath, chain: [] }, ...imported.map((row) => ({ sourcePath: row.sourcePath, chain: row.chain }))]
      .find((row) => databaseOperation.test(sourceByPath.get(row.sourcePath)?.text || ""));
    if (!operationScope) continue;
    for (const database of databases.filter((item) => sourcePathForEntity(item) === sourcePath || importedPaths.includes(sourcePathForEntity(item)))) {
      const operationFile = sourceByPath.get(operationScope.sourcePath);
      add({ sourceEntityId: service.id, targetEntityId: database.id, type: "service_uses_database", sourcePath: operationScope.sourcePath, offset: operationFile.text.search(databaseOperation), importChain: operationScope.chain });
    }
  }
  for (const connection of databases.filter((item) => item.entityType === "database_connection")) {
    const sourcePath = sourcePathForEntity(connection);
    for (const table of databases.filter((item) => item.entityType === "database_table" && sourcePathForEntity(item) === sourcePath)) {
      add({ sourceEntityId: connection.id, targetEntityId: table.id, type: "database_contains_table", sourcePath, offset: table.chronology?.sourceOffset || 0 });
    }
  }
  return [...links.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function applyApplicationHierarchy(functionalities, applicationLinks) {
  const entityById = new Map(functionalities.map((entity) => [entity.id, entity]));
  const ordered = functionalities.slice().sort((left, right) => {
    const leftTime = Date.parse(left.chronology?.sourceModifiedAt || "") || 0;
    const rightTime = Date.parse(right.chronology?.sourceModifiedAt || "") || 0;
    return leftTime - rightTime
      || Number(left.chronology?.discoveryOrder || 0) - Number(right.chronology?.discoveryOrder || 0)
      || Number(left.chronology?.sourceOffset || 0) - Number(right.chronology?.sourceOffset || 0)
      || left.id.localeCompare(right.id);
  });
  ordered.forEach((entity, index) => {
    entity.chronology = { ...(entity.chronology || {}), order: index, basis: "source_modified_at_then_stable_source_order" };
  });
  const priority = { contains_subpage: 0, contains_feature: 1, contains_ui_element: 2, has_ui_feature: 3, ui_calls_api: 4, api_calls_service: 5, ui_uses_service: 5.5, service_uses_service: 5.75, service_uses_database: 6, api_uses_database: 6, database_contains_table: 7 };
  const candidatesByTarget = new Map();
  for (const link of applicationLinks) {
    const rows = candidatesByTarget.get(link.targetEntityId) || [];
    rows.push(link);
    candidatesByTarget.set(link.targetEntityId, rows);
  }
  const createsCycle = (sourceId, targetId) => {
    let current = sourceId;
    const visited = new Set([targetId]);
    while (current) {
      if (visited.has(current)) return true;
      visited.add(current);
      current = entityById.get(current)?.parentEntityId || "";
    }
    return false;
  };
  for (const entity of ordered) {
    const candidates = (candidatesByTarget.get(entity.id) || []).slice().sort((left, right) =>
      (priority[left.type] ?? 99) - (priority[right.type] ?? 99)
      || Number(entityById.get(left.sourceEntityId)?.chronology?.order ?? 999999) - Number(entityById.get(right.sourceEntityId)?.chronology?.order ?? 999999)
      || left.sourceEntityId.localeCompare(right.sourceEntityId));
    const parentLink = candidates.find((link) => entityById.has(link.sourceEntityId) && !createsCycle(link.sourceEntityId, entity.id));
    entity.parentEntityId = parentLink?.sourceEntityId || "";
    entity.parentRelationshipType = parentLink?.type || "";
  }
  const depthFor = (entity, visited = new Set()) => {
    if (!entity?.parentEntityId || visited.has(entity.id)) return 1;
    visited.add(entity.id);
    return 1 + depthFor(entityById.get(entity.parentEntityId), visited);
  };
  for (const entity of functionalities) {
    entity.hierarchyDepth = depthFor(entity);
    const connectorCount = applicationLinks.filter((link) => link.sourceEntityId === entity.id || link.targetEntityId === entity.id).length;
    entity.metrics = { ...(entity.metrics || {}), connectorCount };
  }
  // Source order records when a file was observed, not the sequence in which
  // a capability should be delivered. Build a deterministic dependency-aware
  // sequence: providers come before consumers (data -> service -> API -> UI),
  // while parent/child feature links keep their natural direction. This is an
  // explicitly marked inference, never a claim about historical execution.
  const precedence = new Map(functionalities.map((entity) => [entity.id, new Set()]));
  const hierarchyTypes = new Set(["contains_subpage", "contains_feature", "contains_ui_element", "has_ui_feature", "database_contains_table"]);
  for (const link of applicationLinks) {
    if (!precedence.has(link.sourceEntityId) || !precedence.has(link.targetEntityId)) continue;
    if (hierarchyTypes.has(link.type)) precedence.get(link.sourceEntityId).add(link.targetEntityId);
    else precedence.get(link.targetEntityId).add(link.sourceEntityId);
  }
  const phaseFor = (entity) => {
    if (String(entity.entityType || "").startsWith("database_")) return { rank: 0, label: "Data foundation" };
    if (["service", "cloud_function"].includes(entity.entityType)) return { rank: 1, label: "Service layer" };
    if (entity.entityType === "api_route") return { rank: 2, label: "API and integration" };
    if (["ui_surface", "ui_element", "ui_feature"].includes(entity.entityType)) return { rank: 3, label: "User experience" };
    return { rank: 4, label: "Supporting capability" };
  };
  const compareEntities = (left, right) => {
    const leftOrder = [phaseFor(left).rank, Number(left.chronology?.discoveryOrder || 0), Number(left.chronology?.sourceOffset || 0), left.id];
    const rightOrder = [phaseFor(right).rank, Number(right.chronology?.discoveryOrder || 0), Number(right.chronology?.sourceOffset || 0), right.id];
    for (let index = 0; index < leftOrder.length; index += 1) {
      if (leftOrder[index] < rightOrder[index]) return -1;
      if (leftOrder[index] > rightOrder[index]) return 1;
    }
    return 0;
  };
  const entityByIdForTimeline = new Map(functionalities.map((entity) => [entity.id, entity]));
  const remaining = new Set(functionalities.map((entity) => entity.id));
  const deliveryOrder = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter((id) => [...precedence.entries()].every(([source, targets]) => !targets.has(id) || !remaining.has(source)))
      .map((id) => entityByIdForTimeline.get(id))
      .filter(Boolean)
      .sort(compareEntities);
    // Real applications can contain cycles. Break one deterministically and
    // retain the inferred confidence marker instead of hiding those entities.
    const next = ready[0] || [...remaining].map((id) => entityByIdForTimeline.get(id)).filter(Boolean).sort(compareEntities)[0];
    if (!next) break;
    remaining.delete(next.id);
    deliveryOrder.push(next);
  }
  deliveryOrder.forEach((entity, index) => {
    const phase = phaseFor(entity);
    entity.chronology = {
      ...(entity.chronology || {}),
      order: index,
      deliveryOrder: index + 1,
      deliveryPhase: phase.label,
      deliveryPhaseRank: phase.rank,
      basis: "dependency_aware_delivery_inference",
      inferred: true,
      confidence: 0.72
    };
  });
  return applicationLinks.map((link) => ({
    ...link,
    hierarchy: entityById.get(link.targetEntityId)?.parentEntityId === link.sourceEntityId
  }));
}

function isUiObjectiveAnchor(entity = {}) {
  return entity.entityType === "ui_surface"
    && ["major_feature", "page"].includes(String(entity.sourceHints?.ui?.role || ""));
}

function isStandaloneObjectiveAnchor(entity = {}) {
  return ["api_route", "service", "cloud_function", "database_connection"].includes(entity.entityType)
    || !entity.entityType
    || entity.entityType === "functionality";
}

function nearestMajorFunctionalityEntity(entity, entitiesById) {
  let current = entity;
  const visited = new Set();
  let fallback = null;
  while (current?.id && !visited.has(current.id)) {
    visited.add(current.id);
    // A page/major UI feature is the best business-facing anchor for the API,
    // service, data, controls, and handlers that collectively deliver it.
    if (isUiObjectiveAnchor(current)) return current;
    if (!fallback && isStandaloneObjectiveAnchor(current)) fallback = current;
    current = entitiesById.get(current.parentEntityId);
  }
  return fallback || entity;
}

function objectiveLabel(projectName, majorFunctionalities) {
  const labels = majorFunctionalities.map((item) => item.label).filter(Boolean);
  if (!labels.length) return `${projectName || "Project"} source-derived objective`;
  if (labels.length === 1) return `Deliver ${labels[0]}`;
  return `Deliver ${labels.slice(0, 2).join(" and ")}${labels.length > 2 ? ` + ${labels.length - 2} connected capabilities` : ""}`;
}

function stableEvidence(items = []) {
  const seen = new Set();
  return items.flatMap((item) => item?.evidence || []).filter((evidence) => {
    if (!evidence?.id || seen.has(evidence.id)) return false;
    seen.add(evidence.id);
    return true;
  });
}

/**
 * Collapses source-level observations into decision-sized capabilities. The
 * raw entities remain in `functionalities`; this projection deliberately
 * keeps buttons, handlers, routes, services, and data records as evidence and
 * features rather than making every one a separate top-level ledger branch.
 */
export function deriveProjectObjectives({ projectName = "Project", functionalities = [], applicationLinks = [] } = {}) {
  const entityById = new Map(functionalities.filter((item) => item?.id).map((item) => [item.id, item]));
  const grouped = new Map();
  for (const entity of functionalities) {
    const anchor = nearestMajorFunctionalityEntity(entity, entityById);
    const anchorId = anchor?.id || entity.id;
    if (!grouped.has(anchorId)) grouped.set(anchorId, { anchor: anchor || entity, entities: [] });
    grouped.get(anchorId).entities.push(entity);
  }

  const majorFunctionalities = Array.from(grouped.values()).map(({ anchor, entities }) => {
    const featureEntities = entities.filter((entity) => entity.id !== anchor.id);
    const id = `major-functionality:${anchor.id}`;
    return {
      id,
      sourceEntityId: anchor.id,
      label: anchor.label || "Observed capability",
      category: anchor.category || "other",
      entityType: "major_functionality",
      observedCurrent: {
        inferenceRole: "observed_current",
        sourceOnly: true,
        description: `Source evidence shows the coordinated ${anchor.label || "capability"} implementation. It does not establish a historical selection decision.`
      },
      evidence: stableEvidence(entities),
      featureIds: featureEntities.map((entity) => entity.id),
      features: featureEntities.map((entity) => ({
        id: entity.id,
        label: entity.label,
        category: entity.category,
        entityType: entity.entityType,
        parentEntityId: entity.parentEntityId || "",
        evidenceIds: (entity.evidence || []).map((evidence) => evidence.id).filter(Boolean)
      })),
      sourceEntityIds: entities.map((entity) => entity.id),
      metrics: {
        sourceEntityCount: entities.length,
        featureCount: featureEntities.length,
        connectorCount: entities.reduce((total, entity) => total + Number(entity.metrics?.connectorCount || 0), 0),
        relativeCyclomaticComplexity: Math.max(...entities.map((entity) => Number(entity.metrics?.relativeCyclomaticComplexity || 0)), 0)
      }
    };
  }).sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));

  const majorByEntity = new Map();
  for (const major of majorFunctionalities) for (const entityId of major.sourceEntityIds) majorByEntity.set(entityId, major.id);
  const neighbours = new Map(majorFunctionalities.map((item) => [item.id, new Set()]));
  for (const link of applicationLinks) {
    const sourceId = majorByEntity.get(link.sourceEntityId);
    const targetId = majorByEntity.get(link.targetEntityId);
    if (!sourceId || !targetId || sourceId === targetId) continue;
    neighbours.get(sourceId)?.add(targetId);
    neighbours.get(targetId)?.add(sourceId);
  }
  const objectives = [];
  const seen = new Set();
  for (const major of majorFunctionalities) {
    if (seen.has(major.id)) continue;
    const componentIds = [];
    const queue = [major.id];
    seen.add(major.id);
    while (queue.length) {
      const current = queue.shift();
      componentIds.push(current);
      for (const next of neighbours.get(current) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    const members = componentIds.map((id) => majorFunctionalities.find((item) => item.id === id)).filter(Boolean);
    const objectiveId = `project-objective:${shortId(`${projectName}:${componentIds.sort().join("|")}`, 24)}`;
    objectives.push({
      id: objectiveId,
      label: objectiveLabel(projectName, members),
      description: "A source-derived technical objective that groups capabilities connected by observed application relationships. It does not replace or infer the original product brief.",
      majorFunctionalityIds: members.map((item) => item.id),
      featureCount: members.reduce((total, item) => total + item.features.length, 0),
      evidence: stableEvidence(members)
    });
    members.forEach((item) => { item.objectiveId = objectiveId; });
  }
  return { objectives, majorFunctionalities };
}

export function scoreArchitectureAlternative(input = {}) {
  const dimensions = {
    evidenceCoverage: clamp(input.evidenceCoverage),
    functionalityFit: clamp(input.functionalityFit),
    compatibilityFeasibility: clamp(input.compatibilityFeasibility),
    reversibility: clamp(input.reversibility),
    maintainability: clamp(input.maintainability),
    estimatedChangeCost: clamp(input.estimatedChangeCost),
    dataMigrationRisk: clamp(input.dataMigrationRisk),
    dependencyOperationalRisk: clamp(input.dependencyOperationalRisk),
    uncertainty: clamp(input.uncertainty)
  };
  const positive = dimensions.evidenceCoverage * 0.35
    + dimensions.functionalityFit * 0.25
    + dimensions.compatibilityFeasibility * 0.15
    + dimensions.reversibility * 0.10
    + dimensions.maintainability * 0.15;
  const penalties = dimensions.estimatedChangeCost * 0.20
    + dimensions.dataMigrationRisk * 0.15
    + dimensions.dependencyOperationalRisk * 0.10
    + dimensions.uncertainty * 0.15;
  return { dimensions, positive, penalties, score: Number(clamp(positive - penalties).toFixed(4)) };
}

const STATIC_PATTERNS = {
  ui: [
    ["route-lazy-boundary", "Introduce a route-level lazy-loading boundary", "Defer the detected UI surface behind a route-level loading boundary while preserving its observed contract."],
    ["ui-state-boundary", "Isolate UI state behind a view-model boundary", "Move the observed UI state and side effects behind a view-model boundary without changing externally observed behavior."]
  ],
  api: [
    ["contract-validation-boundary", "Introduce request/response contract validation", "Place a schema validation boundary around the observed API contract before invoking its implementation."],
    ["transport-adapter", "Isolate the API transport adapter", "Separate the observed transport route from the application implementation behind an adapter."]
  ],
  data: [
    ["repository-boundary", "Introduce a repository boundary", "Place the observed persistence access behind a repository interface to make storage substitutions reversible."],
    ["forward-compatible-migration", "Use a forward-compatible data migration path", "Preserve the current data boundary while adding an additive, reversible migration path."]
  ],
  integration: [
    ["integration-adapter", "Isolate the external integration adapter", "Wrap the observed integration call in a provider adapter with an explicit failure boundary."],
    ["bounded-retry-policy", "Add a bounded retry and timeout policy", "Use a bounded retry/timeout policy around the observed integration boundary without changing business decisions."]
  ],
  security: [
    ["policy-middleware", "Centralize authorization policy middleware", "Move the observed security checks into a centralized policy middleware boundary."],
    ["audit-boundary", "Add an authorization audit boundary", "Record authorization outcomes at the observed security boundary without changing access policy."]
  ],
  test: [
    ["contract-fixtures", "Add contract fixtures", "Represent the observed test boundary through stable contract fixtures for compatible implementation alternatives."],
    ["test-matrix", "Introduce a focused test matrix", "Organize the observed tests into a small behavior matrix that can validate deferred alternatives."]
  ],
  runtime: [
    ["runtime-profile", "Separate runtime configuration profiles", "Keep the observed runtime configuration while introducing explicit environment profiles."],
    ["health-check-boundary", "Add a runtime health-check boundary", "Expose an explicit health boundary around the observed runtime configuration and dependencies."]
  ]
};

function staticCandidate(functionality, [pattern, title, description]) {
  const evidenceIds = functionality.evidence.map((evidence) => evidence.id);
  const scoring = scoreArchitectureAlternative({
    evidenceCoverage: evidenceIds.length ? 1 : 0,
    functionalityFit: 0.9,
    compatibilityFeasibility: 0.84,
    reversibility: pattern.includes("migration") ? 0.62 : 0.8,
    maintainability: 0.74,
    estimatedChangeCost: pattern.includes("migration") ? 0.38 : 0.18,
    dataMigrationRisk: functionality.category === "data" && pattern.includes("migration") ? 0.22 : 0.04,
    dependencyOperationalRisk: functionality.category === "integration" ? 0.14 : 0.08,
    uncertainty: 0.16
  });
  return {
    id: `candidate-${shortId(`${functionality.id}:${pattern}`, 24)}`,
    functionalityId: functionality.id,
    title,
    description,
    pattern,
    evidenceIds,
    generatedBy: "static_evidence_patterns",
    dispositionReason: "not_enough_evidence_to_determine_why_not_selected",
    blockingConflict: false,
    ...scoring
  };
}

function validateCandidateEvidence(candidate, functionality) {
  const known = new Set((functionality.evidence || []).map((evidence) => evidence.id));
  return Array.isArray(candidate.evidenceIds) && candidate.evidenceIds.length > 0 && candidate.evidenceIds.every((id) => known.has(id));
}

async function defaultModelRunner({ model, apiKey, input, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        input,
        max_output_tokens: 1200,
        text: { format: MODEL_RESPONSE_FORMAT }
      })
    });
    if (!response.ok) throw new Error(`model_http_${response.status}`);
    const payload = await response.json();
    const output = payload.output_text || (payload.output || []).flatMap((item) => item.content || []).map((item) => item.text || "").join("");
    return JSON.parse(output);
  } finally {
    clearTimeout(timeout);
  }
}

async function modelAssistedCandidates(functionalities, { env = process.env, modelRunner = defaultModelRunner } = {}) {
  const enabled = String(env.PROJECT_BRANCH_DISCOVERY_MODEL_ASSIST_ENABLED ?? "true").toLowerCase() === "true";
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  const model = String(env.PROJECT_BRANCH_DISCOVERY_MODEL || env.OPENAI_DEFAULT_MODEL || "").trim();
  const maxCalls = Math.max(0, Math.min(Number(env.PROJECT_BRANCH_DISCOVERY_MAX_MODEL_CALLS || 8), 8));
  const timeoutMs = Math.max(1000, Math.min(Number(env.PROJECT_BRANCH_DISCOVERY_MODEL_TIMEOUT_MS || 15000), 60000));
  if (!enabled || !apiKey || !model || !maxCalls || !functionalities.length) {
    return { candidates: [], status: enabled ? "unavailable" : "disabled", calls: 0, rejected: 0, model: model || null };
  }
  const batches = [];
  for (let index = 0; index < functionalities.length && batches.length < maxCalls; index += 10) batches.push(functionalities.slice(index, index + 10));
  const candidates = [];
  let rejected = 0;
  let status = "completed";
  for (const batch of batches) {
    const facts = batch.map((functionality) => ({
      id: functionality.id,
      label: functionality.label,
      category: functionality.category,
      evidence: functionality.evidence.slice(0, 8).map((evidence) => ({ id: evidence.id, reference: bounded(evidence.reference, 320) }))
    }));
    const prompt = [
      "You are an architecture-candidate assistant. You may only suggest alternatives supported by the supplied evidence IDs.",
      "Do not claim historical choices, do not evaluate or approve changes, do not invoke tools, browse, execute code, or request files.",
      "Return strict JSON object: { alternatives: [{ functionalityId, title, description, pattern, evidenceIds, rationale }] }.",
      "Every evidenceIds item must exactly match a supplied ID for that functionality. Omit unsupported suggestions.",
      JSON.stringify({ functionalities: facts })
    ].join("\n");
    try {
      const raw = await modelRunner({ model, apiKey, input: prompt, timeoutMs });
      const parsed = ModelAlternativesSchema.parse(raw);
      for (const proposal of parsed.alternatives) {
        const functionality = batch.find((item) => item.id === proposal.functionalityId);
        if (!functionality || !validateCandidateEvidence(proposal, functionality)) { rejected += 1; continue; }
        const scoring = scoreArchitectureAlternative({
          evidenceCoverage: 1,
          functionalityFit: 0.86,
          compatibilityFeasibility: 0.76,
          reversibility: 0.72,
          maintainability: 0.72,
          estimatedChangeCost: 0.23,
          dataMigrationRisk: functionality.category === "data" ? 0.18 : 0.05,
          dependencyOperationalRisk: functionality.category === "integration" ? 0.16 : 0.08,
          uncertainty: 0.24
        });
        candidates.push({
          id: `candidate-${shortId(`${functionality.id}:${proposal.pattern}:${proposal.title}`, 24)}`,
          ...proposal,
          generatedBy: "bounded_model_assist",
          dispositionReason: "not_enough_evidence_to_determine_why_not_selected",
          blockingConflict: false,
          ...scoring
        });
      }
    } catch (error) {
      status = error?.name === "AbortError" ? "timed_out" : error instanceof z.ZodError || error instanceof SyntaxError ? "malformed_output" : "unavailable";
    }
  }
  return { candidates, status, calls: batches.length, rejected, model };
}

function sourcePathFromReference(reference = "") {
  const separator = String(reference).lastIndexOf(":");
  return separator > 0 ? String(reference).slice(0, separator) : "";
}

function codeUnitCandidates(functionality, file) {
  const candidates = [];
  const add = (kind, label, offset = 0) => {
    const normalizedLabel = bounded(label, 220);
    if (!normalizedLabel) return;
    candidates.push({ kind, label: normalizedLabel, offset: Math.max(0, Number(offset) || 0) });
  };
  const text = String(file?.text || "");
  const category = String(functionality?.category || "other").toLowerCase();
  const functionPattern = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|\bdef\s+([A-Za-z_][\w]*)\s*\(|\bclass\s+([A-Za-z_$][\w$]*)\b/g;
  const addFunctions = () => {
    for (const match of text.matchAll(functionPattern)) {
      const name = match[1] || match[2] || match[3] || match[4];
      if (name) add("callable", `Code unit: ${name}`, match.index);
    }
  };
  if (category === "api") {
    const route = functionality.sourceHints?.route;
    if (route?.path) add("route_handler", `${route.method || "Route"} handler ${route.path}`, 0);
    addFunctions();
  } else if (category === "data") {
    for (const match of text.matchAll(/\b(?:model|table|collection)\s+([A-Za-z_][\w]*)|\bCREATE\s+TABLE\s+([A-Za-z_][\w.]*)|\b(?:prisma|sequelize|mongoose|knex)\b/gi)) {
      add("data_unit", `Data unit: ${match[1] || match[2] || "persistence boundary"}`, match.index);
    }
  } else if (category === "integration") {
    for (const match of text.matchAll(/\b(fetch|axios(?:\.(?:get|post|put|patch|delete))?|graphql|webhook|stripe|twilio|sendgrid|redis|kafka)\b/gi)) {
      add("integration_call", `Integration call: ${match[1]}`, match.index);
    }
  } else if (category === "security") {
    for (const match of text.matchAll(/\b(authenticate|authorization|authorize|jwt|oidc|session|csrf|rbac|permission|passport|bcrypt)\b/gi)) {
      add("security_control", `Security control: ${match[1]}`, match.index);
    }
  } else if (category === "test") {
    for (const match of text.matchAll(/\b(test|it|describe)\s*\(\s*["'`]([^"'`]+)/g)) {
      add("test_case", `Test: ${match[2] || match[1]}`, match.index);
    }
  } else if (category === "runtime") {
    for (const match of text.matchAll(/^\s*([A-Za-z][\w.-]{1,80})\s*[:=]/gm)) {
      add("runtime_setting", `Runtime setting: ${match[1]}`, match.index);
    }
  } else {
    addFunctions();
  }
  const seen = new Set();
  return candidates
    .sort((left, right) => left.offset - right.offset || left.label.localeCompare(right.label))
    .filter((candidate) => {
      const key = `${candidate.kind}:${candidate.label.toLowerCase()}:${candidate.offset}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SUBFUNCTIONALITIES_PER_FUNCTIONALITY);
}

function deriveSubfunctionalities(functionality, sourceByPath) {
  const results = [];
  const seen = new Set();
  for (const sourceEvidence of functionality.evidence || []) {
    const sourcePath = sourcePathFromReference(sourceEvidence.reference);
    const file = sourceByPath.get(sourcePath);
    if (!file) continue;
    const candidates = codeUnitCandidates(functionality, file);
    const fallback = candidates.length ? candidates : [{ kind: "source_unit", label: `Source unit: ${sourceEvidence.reference}`, offset: 0 }];
    for (const candidate of fallback) {
      if (results.length >= MAX_SUBFUNCTIONALITIES_PER_FUNCTIONALITY) break;
      const key = `${sourcePath}:${candidate.kind}:${candidate.label}:${candidate.offset}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const evidence = evidenceFor({
        relativePath: sourcePath,
        text: file.text,
        offset: candidate.offset,
        label: `subfunction:${functionality.id}:${candidate.kind}:${candidate.label}`,
        digest: file.digest
      });
      results.push({
        id: `subfunctionality:${shortId(`${functionality.id}:${key}`, 24)}`,
        parentFunctionalityId: functionality.id,
        label: candidate.label,
        kind: candidate.kind,
        sourcePath,
        sourceOffset: candidate.offset,
        reference: evidence.reference,
        evidence: [evidence],
        parentEvidenceIds: [sourceEvidence.id],
        sourceDigest: functionality.sourceDigest
      });
    }
  }
  if (results.length) return results;
  const fallbackPath = sourcePathFromReference(functionality.evidence?.[0]?.reference) || "unknown source";
  return [{
    id: `subfunctionality:${shortId(`${functionality.id}:fallback:${fallbackPath}`, 24)}`,
    parentFunctionalityId: functionality.id,
    label: `Source unit: ${fallbackPath}`,
    kind: "source_unit",
    sourcePath: fallbackPath,
    sourceOffset: 0,
    reference: functionality.evidence?.[0]?.reference || fallbackPath,
    evidence: [],
    parentEvidenceIds: (functionality.evidence || []).map((item) => item.id).filter(Boolean),
    sourceDigest: functionality.sourceDigest
  }];
}

function resolveLocalImport(fromPath, specifier, sourceByPath) {
  if (!specifier?.startsWith(".")) return "";
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  const candidates = [base, ...SOURCE_EXTENSIONS].map((extension, index) => index ? `${base}${extension}` : base);
  candidates.push(`${base}/index.js`, `${base}/index.jsx`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/__init__.py`);
  return candidates.find((candidate) => sourceByPath.has(candidate)) || "";
}

function deriveInferredChains(functionalities, sourceByPath) {
  const byPath = new Map();
  const routes = [];
  for (const functionality of functionalities) {
    for (const subfunctionality of functionality.subfunctionalities || []) {
      const rows = byPath.get(subfunctionality.sourcePath) || [];
      rows.push({ functionality, subfunctionality });
      byPath.set(subfunctionality.sourcePath, rows);
    }
    if (functionality.category === "api" && functionality.sourceHints?.route?.path) routes.push(functionality);
  }
  const chains = new Map();
  const add = ({ source, target, kind, confidence, evidenceIds }) => {
    if (!source || !target || source.functionality.id === target.functionality.id) return;
    const key = `${kind}:${source.subfunctionality.id}:${target.subfunctionality.id}`;
    if (chains.has(key)) return;
    chains.set(key, {
      id: `static-flow:${shortId(key, 24)}`,
      sourceSubfunctionalityId: source.subfunctionality.id,
      targetSubfunctionalityId: target.subfunctionality.id,
      kind,
      confidence,
      evidenceIds: [...new Set(evidenceIds.filter(Boolean))]
    });
  };
  for (const [sourcePath, sourceRows] of byPath) {
    const file = sourceByPath.get(sourcePath);
    if (!file) continue;
    const source = sourceRows.slice().sort((left, right) => left.subfunctionality.sourceOffset - right.subfunctionality.sourceOffset)[0];
    if (!source) continue;
    for (const match of file.text.matchAll(/(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(|import\s*\()["']([^"']+)["']/g)) {
      const targetPath = resolveLocalImport(sourcePath, match[1], sourceByPath);
      const target = (byPath.get(targetPath) || []).find((item) => item.functionality.id !== source.functionality.id);
      add({ source, target, kind: "static_import", confidence: 0.8, evidenceIds: source.subfunctionality.evidence.map((item) => item.id) });
    }
    if (source.functionality.category !== "ui") continue;
    for (const match of file.text.matchAll(/(?:fetch\s*\(|axios(?:\.(?:get|post|put|patch|delete))?\s*\()\s*["'`]([^"'`?#]+)/g)) {
      const requestPath = String(match[1]).replace(/\/$/, "");
      const targetFunctionality = routes.find((route) => String(route.sourceHints?.route?.path || "").replace(/\/$/, "") === requestPath);
      const target = targetFunctionality ? (targetFunctionality.subfunctionalities || [])[0] : null;
      add({
        source,
        target: target ? { functionality: targetFunctionality, subfunctionality: target } : null,
        kind: "static_request_route",
        confidence: 0.95,
        evidenceIds: source.subfunctionality.evidence.map((item) => item.id)
      });
    }
  }
  return [...chains.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export async function analyzeProjectArchitecture({ project, env = process.env, modelRunner, skipModel = false } = {}) {
  if (!project?.workspaceDir) throw new Error("A managed project workspace is required for architecture discovery.");
  const scanned = await collectSourceFiles(project.workspaceDir);
  const sourceFiles = [];
  const sourceByPath = new Map();
  const registry = new Map();
  for (const file of scanned.files) {
    const raw = await fs.readFile(file.absolute, "utf8").catch(() => "");
    if (!raw) continue;
    const digest = sha256(raw);
    const text = redactSecretShapedValues(raw);
    const item = {
      relativePath: file.relativePath,
      text,
      digest,
      size: file.size,
      modifiedAt: file.modifiedAt,
      discoveryOrder: file.discoveryOrder
    };
    sourceFiles.push({ path: item.relativePath, digest, size: item.size, modifiedAt: item.modifiedAt, discoveryOrder: item.discoveryOrder, redacted: text !== raw });
    sourceByPath.set(item.relativePath, item);
    detectFileFunctionalities(registry, item);
  }
  const sourceDigest = sha256(sourceFiles.map((file) => `${file.path}:${file.digest}`).sort().join("\n"));
  const highestCyclomaticComplexity = Math.max(1, ...Array.from(registry.values()).map((functionality) => Number(functionality.metrics?.cyclomaticComplexity || 1)));
  const functionalities = Array.from(registry.values())
    .map((functionality) => ({
      ...functionality,
      sourceDigest,
      evidence: functionality.evidence.slice(0, 20),
      metrics: {
        ...functionality.metrics,
        relativeCyclomaticComplexity: Number((Number(functionality.metrics?.cyclomaticComplexity || 1) / highestCyclomaticComplexity).toFixed(4))
      },
      subfunctionalities: []
    }))
    .sort((left, right) =>
      Number(left.chronology?.discoveryOrder || 0) - Number(right.chronology?.discoveryOrder || 0)
      || Number(left.chronology?.sourceOffset || 0) - Number(right.chronology?.sourceOffset || 0)
      || left.id.localeCompare(right.id));
  // Application topology is rendered as its actual UI surfaces, API routes,
  // and database records.  Do not manufacture source-unit descendants or
  // generic implementation signals for those entities.
  functionalities.forEach((functionality) => {
    functionality.subfunctionalities = functionality.entityType && functionality.entityType !== "functionality"
      ? []
      : deriveSubfunctionalities(functionality, sourceByPath);
  });
  const applicationLinks = applyApplicationHierarchy(functionalities, deriveApplicationLinks(functionalities, sourceByPath));
  const { objectives, majorFunctionalities } = deriveProjectObjectives({
    projectName: project.name,
    functionalities,
    applicationLinks
  });
  const inferredChains = deriveInferredChains(functionalities.filter((functionality) => !functionality.entityType || functionality.entityType === "functionality"), sourceByPath);
  // Alternatives are considered against decision-sized capabilities, never
  // against every button, handler, or other elementary source observation.
  const staticCandidates = majorFunctionalities
    .flatMap((functionality) => (STATIC_PATTERNS[functionality.category] || []).map((pattern) => staticCandidate(functionality, pattern)));
  const modelAssist = skipModel
    ? { candidates: [], status: "skipped_for_idempotency", calls: 0, rejected: 0, model: null }
    : await modelAssistedCandidates(majorFunctionalities, { env, modelRunner });
  const all = [...staticCandidates, ...modelAssist.candidates];
  const unique = new Map();
  for (const candidate of all) {
    const functionality = majorFunctionalities.find((item) => item.id === candidate.functionalityId);
    if (!functionality || !validateCandidateEvidence(candidate, functionality)) continue;
    const key = `${candidate.functionalityId}:${safeKey(candidate.pattern)}:${safeKey(candidate.title)}`;
    if (!unique.has(key) || unique.get(key).score < candidate.score) unique.set(key, candidate);
  }
  const candidates = Array.from(unique.values()).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const publishedCandidates = candidates.filter((candidate) => candidate.score >= PUBLISH_THRESHOLD && !candidate.blockingConflict);
  const suppressedCandidates = candidates.filter((candidate) => !publishedCandidates.includes(candidate)).map((candidate) => ({
    ...candidate,
    suppressionReason: candidate.blockingConflict ? "blocking_policy_or_security_conflict" : "below_branch_value_threshold"
  }));
  return {
    version: ANALYSIS_VERSION,
    projectId: project.id,
    projectOrigin: project.provenance?.origin || project.origin || "unknown_legacy",
    sourceDigest,
    analyzedAt: new Date().toISOString(),
    scan: { fileCount: sourceFiles.length, byteCount: scanned.totalBytes, limited: scanned.limited, excluded: "secrets, dependencies, build output, VCS metadata, uploads, large and binary files" },
    sourceFiles,
    functionalities,
    objectives,
    majorFunctionalities,
    applicationLinks,
    inferredChains,
    candidates,
    publishedCandidates,
    suppressedCandidates,
    modelAssist: {
      status: modelAssist.status,
      calls: modelAssist.calls,
      rejectedUncitedOrMalformed: modelAssist.rejected,
      model: modelAssist.model,
      bounded: true,
      staticFallbackAuthoritative: true
    }
  };
}

function analysisPath(root, projectId, sourceDigest, version = ANALYSIS_VERSION) {
  return path.join(root, "runtime", "project-branch-discovery", safeKey(projectId), `${sourceDigest}.v${version}.json`);
}

function legacyAnalysisPath(root, projectId, sourceDigest) {
  return path.join(root, "runtime", "project-branch-discovery", safeKey(projectId), `${sourceDigest}.json`);
}

export async function readProjectArchitectureAnalysis({ root, projectId, sourceDigest }) {
  const filePath = analysisPath(root, projectId, sourceDigest);
  if (await fs.pathExists(filePath)) return fs.readJson(filePath).catch(() => null);
  const legacyPath = legacyAnalysisPath(root, projectId, sourceDigest);
  return (await fs.pathExists(legacyPath)) ? fs.readJson(legacyPath).catch(() => null) : null;
}

export async function readLatestProjectArchitectureAnalysis({ root, projectId }) {
  const directory = path.join(root, "runtime", "project-branch-discovery", safeKey(projectId));
  if (!(await fs.pathExists(directory))) return null;
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".json"));
  const reports = await Promise.all(files.map((file) => fs.readJson(path.join(directory, file)).catch(() => null)));
  return reports.filter(Boolean).sort((a, b) => new Date(b.analyzedAt || 0).getTime() - new Date(a.analyzedAt || 0).getTime())[0] || null;
}

export async function writeProjectArchitectureAnalysis({ root, report }) {
  const filePath = analysisPath(root, report.projectId, report.sourceDigest);
  await fs.ensureDir(path.dirname(filePath));
  if (await fs.pathExists(filePath)) return fs.readJson(filePath).catch(() => report);
  await fs.writeJson(filePath, report, { spaces: 2 });
  return report;
}

function decisionId(projectId, functionalityId, sourceDigest, suffix = "current") {
  return `architecture:${shortId(projectId, 14)}:${shortId(functionalityId, 14)}:${sourceDigest.slice(0, 12)}:${suffix}`.slice(0, 160);
}

function fitnessVector(candidate) {
  return {
    evaluatorVersion: "project-architecture-branch-score-v1",
    dimensions: Object.entries(candidate.dimensions).map(([name, value]) => ({ name, value, direction: name.includes("Risk") || name.includes("Cost") || name === "uncertainty" ? "minimize" : "maximize", normalizedValue: value, confidence: name === "uncertainty" ? 1 - value : value, missing: false })),
    aggregation: { method: "weighted_sum", version: "project-architecture-branch-score-v1", score: candidate.score }
  };
}

async function existingBranch(store, tenantId, workspaceId, candidateDecisionId, inferenceRoles) {
  const rows = await store.listBranches({ tenantId, workspaceId, decisionId: candidateDecisionId, limit: 20 });
  const acceptedRoles = new Set(Array.isArray(inferenceRoles) ? inferenceRoles : [inferenceRoles]);
  return rows.find((branch) => acceptedRoles.has(branch.candidate?.inferenceRole)) || null;
}

/**
 * Publishes source observations and evidence-cited possibilities. Static source
 * analysis cannot create a historical selected/deferred/rejected disposition;
 * only a later governed actor may do that through Decision Continuity.
 */
export async function publishArchitectureBranches({ report, store, tenantId, workspaceId, actor, principalId }) {
  const branches = [];
  const decisionFunctionalities = Array.isArray(report.majorFunctionalities) && report.majorFunctionalities.length
    ? report.majorFunctionalities
    : report.functionalities || [];
  for (const functionality of decisionFunctionalities) {
    // Major functionalities are the decision-sized aggregates used by the
    // ledger; sourceEntityId preserves the concrete application entity that
    // can safely anchor the visual topology and its cited branch link.
    const sourceEntityId = functionality.sourceEntityId || functionality.id;
    const currentDecisionId = decisionId(report.projectId, functionality.id, report.sourceDigest, "current");
    let current = await existingBranch(store, tenantId, workspaceId, currentDecisionId, "observed_current");
    if (!current) {
      current = await store.createBranch({
        workspaceId,
        decisionId: currentDecisionId,
        objective: `Observed current implementation: ${functionality.label}`,
        branchType: "implementation",
        origin: { source: "other", correlationId: report.sourceDigest },
        candidate: {
          inferenceRole: "observed_current",
          functionalityId: functionality.id,
          sourceEntityId,
          objectiveId: functionality.objectiveId || "",
          featureIds: functionality.featureIds || [],
          sourceDigest: report.sourceDigest,
          description: functionality.observedCurrent?.description || "Observed from source scan.",
          decisionRationale: "The current implementation is source-observed. Source evidence can establish what exists, but cannot establish who selected it or why."
        },
        assumptions: ["This record is a source-derived current implementation observation, not a historical selection claim."],
        evidence: functionality.evidence,
        autoReconsideration: false,
        allowRejectedReconsideration: false,
        disposition: { reason: "observed_current_source_evidence", alternativesConsidered: [] },
        producedBy: { agentId: "project-architecture-discovery", actorId: principalId, source: "source-analysis" },
        executionProvenance: { provider: "static-source-analysis", promptVersion: "project-architecture-branch-v1", environment: "bounded" }
      }, { tenantId, actor });
    }
    branches.push({ id: current.id, functionalityId: functionality.id, sourceEntityId, title: functionality.label, status: current.status, inferenceRole: "observed_current", sourceDigest: report.sourceDigest, score: null, autoReconsideration: false, evidenceIds: functionality.evidence.map((evidence) => evidence.id) });
    const alternatives = report.publishedCandidates.filter((candidate) => candidate.functionalityId === functionality.id);
    for (const candidate of alternatives) {
      const alternativeDecisionId = decisionId(report.projectId, functionality.id, report.sourceDigest, shortId(candidate.id, 10));
      let branch = await existingBranch(store, tenantId, workspaceId, alternativeDecisionId, ["anticipated_alternative", "deferred_alternative"]);
      if (!branch) {
        branch = await store.createBranch({
          workspaceId,
          decisionId: alternativeDecisionId,
          parentBranchId: current.id,
          objective: candidate.title,
          branchType: "proposal",
          origin: { source: "other", correlationId: report.sourceDigest },
          candidate: {
            inferenceRole: "anticipated_alternative",
            functionalityId: functionality.id,
            sourceEntityId,
            objectiveId: functionality.objectiveId || "",
            featureIds: functionality.featureIds || [],
            sourceDigest: report.sourceDigest,
            pattern: candidate.pattern,
            description: candidate.description,
            generatedBy: candidate.generatedBy,
            score: candidate.score,
            scoreBreakdown: candidate.dimensions,
            decisionRationale: `This is an evidence-supported possibility, but source inspection alone cannot prove a historical selection, deferral, or rejection. It is available for future governed comparison (analysis score ${candidate.score}).`
          },
          assumptions: ["This is a source-supported future architecture candidate, not an asserted historical decision."],
          evidence: functionality.evidence.filter((evidence) => candidate.evidenceIds.includes(evidence.id)),
          fitnessVector: fitnessVector(candidate),
          revisitTriggers: [`project-source-changed:${shortId(report.projectId, 16)}`, `architecture-reconsider:${shortId(functionality.id, 16)}`],
          autoReconsideration: false,
          allowRejectedReconsideration: false,
          disposition: { reason: "source_anticipated_not_historical", alternativesConsidered: [current.id] },
          producedBy: { agentId: "project-architecture-discovery", actorId: principalId, source: candidate.generatedBy },
          executionProvenance: { provider: candidate.generatedBy === "bounded_model_assist" ? "openai-bounded-assist" : "static-source-analysis", modelId: candidate.generatedBy === "bounded_model_assist" ? report.modelAssist.model || undefined : undefined, promptVersion: "project-architecture-branch-v1", environment: "bounded" }
        }, { tenantId, actor });
      }
      const inferenceRole = branch.candidate?.inferenceRole === "deferred_alternative" ? "deferred_alternative" : "anticipated_alternative";
      branches.push({ id: branch.id, functionalityId: functionality.id, sourceEntityId, title: candidate.title, status: branch.status, inferenceRole, sourceDigest: report.sourceDigest, score: candidate.score, autoReconsideration: branch.autoReconsideration === true, historicalClaim: false, evidenceIds: candidate.evidenceIds });
    }
  }
  return branches;
}

export function publicArchitectureAnalysis(report) {
  if (!report) return null;
  return {
    version: report.version,
    projectId: report.projectId,
    projectOrigin: report.projectOrigin || "unknown_legacy",
    sourceDigest: report.sourceDigest,
    analyzedAt: report.analyzedAt,
    scan: report.scan,
    functionalities: report.functionalities,
    objectives: report.objectives || [],
    majorFunctionalities: report.majorFunctionalities || report.functionalities || [],
    applicationLinks: report.applicationLinks || [],
    inferredChains: report.inferredChains || [],
    assignments: report.assignments || [],
    branches: report.branches || [],
    publishedCandidates: report.publishedCandidates || [],
    publishedBranchCount: (report.branches || []).filter((branch) => ["deferred_alternative", "anticipated_alternative"].includes(branch.inferenceRole)).length,
    anticipatedBranchCount: (report.branches || []).filter((branch) => ["deferred_alternative", "anticipated_alternative"].includes(branch.inferenceRole)).length,
    suppressedCandidates: report.suppressedCandidates || [],
    modelAssist: report.modelAssist,
    idempotent: Boolean(report.idempotent)
  };
}
