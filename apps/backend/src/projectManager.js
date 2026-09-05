import { spawn } from "node:child_process";
import fs from "fs-extra";
import net from "node:net";
import path from "node:path";
import AdmZip from "adm-zip";
import { nanoid } from "nanoid";
import {
  containerLogs,
  createContainer,
  hasDockerSocket,
  inspectContainer,
  listContainers,
  listNetworks,
  listVolumes,
  removeContainer,
  removeNetwork,
  removeVolume,
  startContainer,
  stopContainer
} from "./dockerClient.js";
import { ensureProjectAgentTopologies, prepareProjectAgentTopology, removeProjectAgentTopology, syncProjectAgentIdentity, syncProjectAgentTopology } from "./projectAgents.js";
import { ensureProjectHuggingFaceModelWorkspace, ensureProjectQAgenticFramework, installProjectOrchestratorSeed } from "./projectBootstrap.js";
import { normalizeEnterpriseTag } from "./enterprisePortfolio.js";

const runningProjects = new Map();
const ignoredWorkspaceEntries = new Set(["node_modules", "dist", ".git", ".vite"]);
const largeModelArtifactExtensions = new Set([
  ".bin",
  ".ckpt",
  ".gguf",
  ".onnx",
  ".pth",
  ".pt",
  ".safetensors"
]);
const maxExportableFileBytes = Number(process.env.PLUTOMIX_MAX_EXPORT_FILE_BYTES || 512 * 1024 * 1024);
const PROJECT_ORIGINS = new Set(["plutomix_created", "imported", "unknown_legacy"]);

export function projectProvenance(project = {}) {
  const explicit = project?.provenance && typeof project.provenance === "object" ? project.provenance : {};
  const explicitOrigin = String(explicit.origin || project?.origin || "").trim().toLowerCase();
  if (PROJECT_ORIGINS.has(explicitOrigin)) {
    return {
      ...explicit,
      origin: explicitOrigin,
      recordedAt: String(explicit.recordedAt || project?.createdAt || ""),
      source: String(explicit.source || (project?.origin ? "legacy_origin_field" : "project_registry"))
    };
  }
  // Runtime status is not provenance. The one safe legacy exception is an
  // untouched imported record; running/stopped legacy records remain unknown.
  if (project?.status === "imported") {
    return {
      origin: "imported",
      recordedAt: String(project?.createdAt || ""),
      source: "legacy_import_status"
    };
  }
  // `productDecision` is written by PlutoMix project creation and is not
  // populated by the archive-import path. It is therefore durable legacy
  // evidence of creation, unlike mutable runtime status.
  if (project?.productDecision && typeof project.productDecision === "object" && Object.keys(project.productDecision).length) {
    return {
      origin: "plutomix_created",
      recordedAt: String(project?.createdAt || ""),
      source: "legacy_plutomix_product_decision"
    };
  }
  return {
    origin: "unknown_legacy",
    recordedAt: "",
    source: "provenance_not_recorded"
  };
}

function slugify(value) {
  return String(value || "project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "project";
}

function projectsRoot() {
  return process.env.PROJECTS_ROOT || "/workspace/apps";
}

function tenantProjectsRoot({ tenantId = "", tenantInstanceKey = "" } = {}) {
  if (!tenantId) return projectsRoot();
  const key = String(tenantInstanceKey || "").trim();
  if (!/^tenant-[a-f0-9]{16}$/.test(key)) throw new Error("A valid tenant instance key is required for a tenant project.");
  return path.join(projectsRoot(), "tenants", key);
}

async function managedProjectWorkspace(project) {
  const workspaceRoot = path.resolve(projectsRoot());
  const workspaceDir = path.resolve(String(project?.workspaceDir || ""));
  const folderName = String(project?.folderName || "").trim();
  const relativePath = path.relative(workspaceRoot, workspaceDir);
  const segments = relativePath.split(path.sep).filter(Boolean);
  const recordedTenantKey = String(project?.tenantInstanceKey || "").trim();
  const validFolder = Boolean(folderName) && folderName === path.basename(folderName) && ![".", ".."].includes(folderName);
  const legacyLayout = validFolder && segments.length === 1 && segments[0] === folderName;
  const tenantLayout = validFolder &&
    segments.length === 3 &&
    segments[0] === "tenants" &&
    /^tenant-[a-f0-9]{16}$/.test(segments[1]) &&
    segments[2] === folderName &&
    (!recordedTenantKey || recordedTenantKey === segments[1]);

  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath) || (!legacyLayout && !tenantLayout)) {
    throw new Error(`Refusing to delete project workspace outside ${workspaceRoot}.`);
  }

  // Reject a managed-looking path whose parent is a symlink escaping the
  // project root. Missing workspaces remain deletable from the registry.
  const [realRoot, realParent] = await Promise.all([
    fs.realpath(workspaceRoot).catch(() => workspaceRoot),
    fs.realpath(path.dirname(workspaceDir)).catch(() => "")
  ]);
  if (realParent) {
    const realRelativeParent = path.relative(realRoot, realParent);
    if (realRelativeParent.startsWith(`..${path.sep}`) || path.isAbsolute(realRelativeParent)) {
      throw new Error(`Refusing to delete project workspace outside ${workspaceRoot}.`);
    }
  }
  return workspaceDir;
}

function migrateLegacyWorkspaceDir(project) {
  const workspaceDir = String(project?.workspaceDir || "");
  // Older registry records used the removed /workspace/money mount. Keep the
  // project identity and migrate only that exact obsolete container prefix.
  if (!workspaceDir.startsWith("/workspace/money/")) return project;
  const folderName = String(project?.folderName || path.basename(workspaceDir)).trim();
  if (!folderName) return project;
  return { ...project, workspaceDir: path.join(projectsRoot(), folderName) };
}

function templateDir() {
  return process.env.GENERATED_SITE_DIR || "/workspace/generated-site";
}

function projectHostUrl() {
  return process.env.PROJECT_HOST_URL || "http://localhost";
}

export function projectPreviewUrl(port) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error(`Invalid project preview port: ${port}.`);
  }
  const template = String(process.env.PROJECT_PREVIEW_URL_TEMPLATE || "").trim();
  if (template) {
    if (!template.includes("{port}")) {
      throw new Error("PROJECT_PREVIEW_URL_TEMPLATE must contain the {port} placeholder.");
    }
    const rendered = template.replaceAll("{port}", String(numericPort));
    let parsed;
    try {
      parsed = new URL(rendered);
    } catch {
      throw new Error("PROJECT_PREVIEW_URL_TEMPLATE must produce an absolute HTTP or HTTPS URL.");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("PROJECT_PREVIEW_URL_TEMPLATE must produce an absolute HTTP or HTTPS URL.");
    }
    return rendered;
  }
  return `${projectHostUrl().replace(/\/$/, "")}:${numericPort}`;
}

function registryPath() {
  return process.env.PROJECTS_REGISTRY_PATH || "/workspace/project/runtime/projects.json";
}

function exportsRoot() {
  return process.env.PROJECT_EXPORTS_ROOT || "/workspace/project/runtime/exports";
}

function parentGitignorePath() {
  return process.env.PROJECTS_GITIGNORE_PATH || path.join(projectsRoot(), ".gitignore");
}

function projectUrl(port) {
  return projectPreviewUrl(port);
}

function projectRuntimeMode() {
  return String(process.env.PROJECT_RUNTIME_MODE || "process").toLowerCase();
}

function normalizedRelativePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

export function shouldSkipProjectArtifact(relativePath, stat = null) {
  const normalizedPath = String(relativePath || "").split(path.sep).join("/");
  const extension = path.extname(normalizedPath).toLowerCase();
  return (
    normalizedPath.startsWith("models/huggingface/repositories/") ||
    (normalizedPath.startsWith("models/huggingface/") && largeModelArtifactExtensions.has(extension)) ||
    Number(stat?.size || 0) > maxExportableFileBytes
  );
}

async function resolveExecutableFromPath(command) {
  if (command.includes(path.sep)) return command;
  const pathEntries = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, command);
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return command;
}

function projectContainerName(project) {
  return `plutomix-project-${slugify(project.id)}`;
}

function defaultContainerName() {
  return process.env.GENERATED_SITE_CONTAINER || "plutomix-generated-site";
}

async function readRegistry() {
  await fs.ensureDir(path.dirname(registryPath()));
  if (!(await fs.pathExists(registryPath()))) return [];
  const rows = await fs.readJson(registryPath());
  if (!Array.isArray(rows)) return [];
  const migratedRows = rows.map(migrateLegacyWorkspaceDir);
  if (migratedRows.some((row, index) => row.workspaceDir !== rows[index].workspaceDir)) {
    await writeRegistry(migratedRows);
  }
  return migratedRows;
}

async function writeRegistry(projects) {
  await fs.ensureDir(path.dirname(registryPath()));
  await fs.writeJson(registryPath(), projects, { spaces: 2 });
}

async function reserveProjectFolder(name, scope = {}) {
  const root = tenantProjectsRoot(scope);
  await fs.ensureDir(root);
  const baseSlug = slugify(name);
  let folderName = baseSlug;
  let counter = 2;
  while (await fs.pathExists(path.join(root, folderName))) {
    folderName = `${baseSlug}-${counter}`;
    counter += 1;
  }
  return {
    folderName,
    workspaceDir: path.join(root, folderName)
  };
}

function projectWorkspaceFromIgnoreInput(folderNameOrWorkspace) {
  const value = String(folderNameOrWorkspace || "");
  return path.isAbsolute(value) ? value : path.join(projectsRoot(), value);
}

async function readProjectIgnoreFile(gitignorePath) {
  if (!(await fs.pathExists(gitignorePath))) return "";
  const stat = await fs.stat(gitignorePath);
  if (!stat.isFile()) {
    throw new Error(
      `Project ignore registry must be a regular file: ${gitignorePath}. ` +
      "Set PROJECTS_GITIGNORE_PATH to a writable file path."
    );
  }
  return fs.readFile(gitignorePath, "utf8");
}

async function ensureProjectIgnored(folderNameOrWorkspace) {
  const gitignorePath = parentGitignorePath();
  await fs.ensureDir(path.dirname(gitignorePath));
  const existing = await readProjectIgnoreFile(gitignorePath);
  const projectPath = projectWorkspaceFromIgnoreInput(folderNameOrWorkspace);
  const relativeEntry = path.relative(path.dirname(gitignorePath), projectPath).split(path.sep).join("/");
  const requiredEntries = [`${relativeEntry}/`];
  const nextEntries = requiredEntries.filter((entry) => !existing.split(/\r?\n/).includes(entry));
  if (!nextEntries.length) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await fs.writeFile(gitignorePath, `${existing}${prefix}${nextEntries.join("\n")}\n`);
}

async function removeProjectIgnoreEntry(folderNameOrWorkspace) {
  const gitignorePath = parentGitignorePath();
  if (!(await fs.pathExists(gitignorePath))) return;
  const projectPath = projectWorkspaceFromIgnoreInput(folderNameOrWorkspace);
  const target = `${path.relative(path.dirname(gitignorePath), projectPath).split(path.sep).join("/")}/`;
  const legacyTarget = `${path.basename(projectPath)}/`;
  const entries = (await readProjectIgnoreFile(gitignorePath)).split(/\r?\n/);
  await fs.writeFile(gitignorePath, `${entries.filter((entry) => entry !== target && entry !== legacyTarget).join("\n").replace(/\n+$/, "")}\n`);
}

function publicProject(project) {
  const provenance = projectProvenance(project);
  return {
    ...project,
    provenance,
    origin: provenance.origin,
    previewUrl: projectUrl(project.port),
    containerName: project.isDefault ? defaultContainerName() : projectContainerName(project)
  };
}

async function detectBackendInterface(project) {
  if (!project?.workspaceDir || project.isDefault) return null;
  const backendServerPath = path.join(project.workspaceDir, "backend", "src", "server.js");
  const candidateSpecPaths = [
    "openapi.json",
    "openapi.yaml",
    "openapi.yml",
    "swagger.json",
    "swagger.yaml",
    "swagger.yml",
    path.join("openapi", "openapi.json"),
    path.join("openapi", "swagger.json"),
    path.join("backend", "openapi.json"),
    path.join("backend", "swagger.json")
  ];
  const existingSpecPath = (
    await Promise.all(candidateSpecPaths.map(async (relativePath) => ((await fs.pathExists(path.join(project.workspaceDir, relativePath))) ? relativePath : "")))
  ).find(Boolean);
  const result = {
    available: false,
    label: "Backend",
    url: "",
    apiBaseUrl: `${projectUrl(project.port)}/api`,
    docsUrl: "",
    openApiUrl: "",
    routeCount: 0,
    routes: [],
    source: ""
  };

  if (await fs.pathExists(backendServerPath)) {
    const source = await fs.readFile(backendServerPath, "utf8");
    const routes = [...source.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*(?:\[\s*)?["'`]([^"'`]+)["'`]/gi)]
      .map((match) => ({ method: match[1].toUpperCase(), path: match[2] }))
      .filter((route) => route.path && !/^\/api\/health\/?$/.test(route.path));
    const docsRoute = routes.find((route) => /\/(?:api\/docs|swagger|swagger-ui)(?:\/|$)/i.test(route.path));
    const openApiRoute = routes.find((route) => /openapi|swagger\.json/i.test(route.path));
    result.routes = routes.slice(0, 20);
    result.routeCount = routes.length;
    if (docsRoute) {
      result.docsUrl = `${projectUrl(project.port)}${docsRoute.path}`;
      result.url = result.docsUrl;
      result.source = "swagger-route";
    } else if (openApiRoute) {
      result.openApiUrl = `${projectUrl(project.port)}${openApiRoute.path}`;
      result.url = result.openApiUrl;
      result.source = "openapi-route";
    } else if (routes.length) {
      result.url = result.apiBaseUrl;
      result.source = "backend-routes";
    }
  }

  if (!result.url && existingSpecPath) {
    result.openApiUrl = `${projectUrl(project.port)}/${existingSpecPath.split(path.sep).join("/")}`;
    result.url = result.openApiUrl;
    result.source = "openapi-file";
  }

  result.available = Boolean(result.url);
  return result.available ? result : null;
}

async function publicProjectWithBackendInterface(project) {
  const visibleProject = publicProject(project);
  return {
    ...visibleProject,
    backendInterface: await detectBackendInterface(visibleProject)
  };
}

async function managedProjectRuntime(project) {
  if (!project || project.isDefault) {
    return { status: "running", managed: false, port: Number(project?.port || 0) };
  }

  if (projectRuntimeMode() === "docker") {
    if (!hasDockerSocket()) {
      return { status: "stopped", managed: true, mode: "docker", containerName: projectContainerName(project), port: project.port };
    }
    const containerName = projectContainerName(project);
    const container = await inspectContainer(containerName);
    return {
      status: container?.State?.Running ? "running" : container ? "stopped" : "not-found",
      managed: true,
      mode: "docker",
      containerName,
      port: project.port
    };
  }

  const child = runningProjects.get(project.id);
  const running = Boolean(child && child.exitCode === null && !child.killed);
  if (child && !running) runningProjects.delete(project.id);
  return {
    status: running ? "running" : "stopped",
    managed: true,
    mode: "process",
    pid: running ? child.pid : null,
    port: project.port
  };
}

async function publicProjectWithRuntime(project) {
  const [visibleProject, runtime] = await Promise.all([
    publicProjectWithBackendInterface(project),
    managedProjectRuntime(project)
  ]);
  return {
    ...visibleProject,
    status: runtime.status === "running" ? "running" : "stopped",
    runtime
  };
}

function canAccessProject(project, user = {}) {
  if (project?.visibility === "shared") return true;
  if (project?.tenantId) return Boolean(user.tenantId && user.tenantId === project.tenantId);
  const ownerUserId = project?.ownerUserId || "anonymous";
  const identities = new Set([
    user.id,
    user.subject,
    user.issuer && user.subject ? `${user.issuer}:${user.subject}` : "",
    ...(Array.isArray(user.aliases) ? user.aliases : [])
  ].map((value) => String(value || "").trim()).filter(Boolean));
  // Older local projects were created before external identity binding and
  // deliberately remain accessible through the legacy anonymous owner.
  if (!identities.size) identities.add("anonymous");
  return identities.has(ownerUserId);
}

async function copyWorkspace(sourceDir, targetDir, { excludePaths = [] } = {}) {
  const excluded = excludePaths.map((entry) => String(entry || "").split(path.sep).join("/").replace(/^\/+|\/+$/g, "")).filter(Boolean);
  const isExcluded = (source) => {
    const relativePath = path.relative(sourceDir, source).split(path.sep).join("/");
    return excluded.some((entry) => relativePath === entry || relativePath.startsWith(`${entry}/`));
  };
  await fs.ensureDir(targetDir);
  const entries = await fs.readdir(sourceDir);
  for (const entry of entries) {
    if (ignoredWorkspaceEntries.has(entry)) continue;
    await fs.copy(path.join(sourceDir, entry), path.join(targetDir, entry), {
      filter: async (source) => {
        if (isExcluded(source)) return false;
        if (source.split(path.sep).some((part) => ignoredWorkspaceEntries.has(part))) return false;
        const stat = await fs.stat(source).catch(() => null);
        if (!stat?.isFile()) return true;
        return !shouldSkipProjectArtifact(normalizedRelativePath(sourceDir, source), stat);
      }
    });
  }
}

async function writeCleanGeneratedProjectSeed(workspaceDir, projectName) {
  const generatedDir = path.join(workspaceDir, "src", "generated");
  await fs.ensureDir(generatedDir);
  const serializedName = JSON.stringify(String(projectName || "New project"));
  await fs.writeFile(path.join(generatedDir, "generatedPage.jsx"), [
    `const projectName = ${serializedName};`,
    "",
    "export default function GeneratedPage() {",
    "  return (",
    '    <main className="plutomix-generation-pending" data-plutomix-generation-state="pending">',
    '      <span>PlutoMix project</span>',
    "      <h1>{projectName}</h1>",
    "      <p>The initial Gotham build has not completed yet.</p>",
    "    </main>",
    "  );",
    "}",
    ""
  ].join("\n"));
  await fs.writeFile(path.join(generatedDir, "generatedPage.css"), [
    ":root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #172033; background: #f5f7fb; }",
    "* { box-sizing: border-box; }",
    "body { margin: 0; min-width: 320px; min-height: 100vh; }",
    ".plutomix-generation-pending { min-height: 100vh; display: grid; place-content: center; gap: 12px; padding: 32px; text-align: center; background: linear-gradient(145deg, #eef3ff, #f8fbff); }",
    ".plutomix-generation-pending span { color: #4274d9; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }",
    ".plutomix-generation-pending h1 { margin: 0; color: #293681; font-size: clamp(32px, 7vw, 72px); }",
    ".plutomix-generation-pending p { margin: 0; color: #526077; }",
    ""
  ].join("\n"));
  await fs.writeJson(path.join(generatedDir, "metadata.json"), {
    status: "awaiting_initial_generation",
    projectName: String(projectName || "New project"),
    generatedAt: null
  }, { spaces: 2 });
  await fs.writeFile(path.join(generatedDir, "README.generated.md"), "# Generated project surface\n\nThis clean placeholder is replaced by the first successful Gotham build.\n");
}

async function ensureFileLines(filePath, requiredLines) {
  const existing = (await fs.pathExists(filePath)) ? await fs.readFile(filePath, "utf8") : "";
  const currentLines = existing.split(/\r?\n/);
  const missingLines = requiredLines.filter((line) => !currentLines.includes(line));
  if (!missingLines.length) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await fs.writeFile(filePath, `${existing}${prefix}${missingLines.join("\n")}\n`);
}

async function writeStandaloneDockerReadme(workspaceDir, port) {
  const readmePath = path.join(workspaceDir, "README.md");
  const blockStart = "<!-- plutomix-standalone-docker:start -->";
  const blockEnd = "<!-- plutomix-standalone-docker:end -->";
  const block = [
    blockStart,
    "## Standalone Docker",
    "",
    "This project is packaged to run outside PlutoMix with its own Docker Compose stack.",
    "",
    "1. Copy `.env.example` to `.env` and adjust values if needed.",
    "2. Start the app:",
    "",
    "```bash",
    "docker compose up --build",
    "```",
    "",
    `3. Open the frontend at http://localhost:${port}.`,
    "4. The backend health endpoint is available at http://localhost:8080/api/health.",
    "",
    "The Docker files are project-local and do not require the PlutoMix backend, PlutoMix frontend, MCP service, or shared preview volume.",
    blockEnd
  ].join("\n");
  const existing = (await fs.pathExists(readmePath)) ? await fs.readFile(readmePath, "utf8") : "";
  const pattern = new RegExp(`${blockStart}[\\s\\S]*?${blockEnd}`, "m");
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trim()}${existing.trim() ? "\n\n" : ""}${block}\n`;
  await fs.writeFile(readmePath, next);
}

async function ensureProjectFiles(workspaceDir, port) {
  await fs.ensureDir(workspaceDir);
  const packagePath = path.join(workspaceDir, "package.json");
  if (!(await fs.pathExists(packagePath))) {
    await fs.writeJson(
      packagePath,
      {
        name: "@plutomix/exported-app",
        version: "1.0.0",
        private: true,
        type: "module",
        scripts: {
          dev: `node ./run-vite.mjs --host 0.0.0.0 --port ${port}`,
          build: "node ./run-vite.mjs build",
          preview: `node ./run-vite.mjs preview --host 0.0.0.0 --port ${port}`,
          "hf:models:add": "node scripts/huggingface-models.mjs add",
          "hf:models:download": "node scripts/huggingface-models.mjs download",
          "hf:models:build": "node scripts/huggingface-models.mjs build",
          "hf:models:status": "node scripts/huggingface-models.mjs status"
        },
        dependencies: {
          "@vitejs/plugin-react": "4.3.4",
          vite: "6.0.7",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          nanoid: "3.3.15"
        },
        overrides: {
          postcss: {
            nanoid: "3.3.15"
          }
        },
        devDependencies: {}
      },
      { spaces: 2 }
    );
  } else {
    const packageJson = await fs.readJson(packagePath);
    packageJson.scripts = {
      ...(packageJson.scripts || {}),
      dev: `node ./run-vite.mjs --host 0.0.0.0 --port ${port}`,
      build: "node ./run-vite.mjs build",
      preview: `node ./run-vite.mjs preview --host 0.0.0.0 --port ${port}`,
      "hf:models:add": "node scripts/huggingface-models.mjs add",
      "hf:models:download": "node scripts/huggingface-models.mjs download",
      "hf:models:build": "node scripts/huggingface-models.mjs build",
      "hf:models:status": "node scripts/huggingface-models.mjs status"
    };
    packageJson.dependencies = {
      ...(packageJson.dependencies || {}),
      "@vitejs/plugin-react": "4.3.4",
      vite: "6.0.7",
      nanoid: "3.3.15"
    };
    packageJson.overrides = {
      ...(packageJson.overrides || {}),
      postcss: {
        ...(packageJson.overrides?.postcss || {}),
        nanoid: "3.3.15"
      }
    };
    await fs.writeJson(packagePath, packageJson, { spaces: 2 });
  }
  await ensureProjectHuggingFaceModelWorkspace(workspaceDir, { port }, { source: "plutomix-project-files" });

  await fs.writeFile(
    path.join(workspaceDir, "run-vite.mjs"),
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { spawn } from "node:child_process";',
      "",
      "const candidates = [",
      '  path.resolve(process.cwd(), "node_modules", "vite", "bin", "vite.js"),',
      '  path.resolve(process.cwd(), "..", "..", "node_modules", "vite", "bin", "vite.js")',
      "];",
      "",
      "const viteBin = candidates.find((candidate) => fs.existsSync(candidate));",
      "",
      "if (!viteBin) {",
      '  console.error(`Unable to locate Vite. Checked:\\n${candidates.map((candidate) => `- ${candidate}`).join("\\n")}`);',
      "  process.exit(1);",
      "}",
      "",
      "const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {",
      '  stdio: "inherit",',
      "  env: process.env",
      "});",
      "",
      'child.on("exit", (code, signal) => {',
      "  if (signal) process.kill(process.pid, signal);",
      "  process.exit(code ?? 1);",
      "});",
      "",
      'child.on("error", (error) => {',
      "  console.error(error);",
      "  process.exit(1);",
      "});",
      ""
    ].join("\n")
  );

  await fs.writeFile(
    path.join(workspaceDir, ".env"),
    [
      `FRONTEND_PORT=${port}`,
      "BACKEND_PORT=8080",
      "DATABASE_PORT=5432",
      "POSTGRES_DB=appdb",
      "POSTGRES_USER=appuser",
      "POSTGRES_PASSWORD=appsecret",
      "DATABASE_URL=postgres://appuser:appsecret@database:5432/appdb",
      "VITE_PUBLIC_BASE=/",
      "VITE_API_BASE=http://localhost:8080",
      ""
    ].join("\n")
  );
  await fs.writeFile(
    path.join(workspaceDir, ".env.example"),
    [
      `FRONTEND_PORT=${port}`,
      "BACKEND_PORT=8080",
      "DATABASE_PORT=5432",
      "POSTGRES_DB=appdb",
      "POSTGRES_USER=appuser",
      "POSTGRES_PASSWORD=change-me",
      "DATABASE_URL=postgres://appuser:change-me@database:5432/appdb",
      "VITE_PUBLIC_BASE=/",
      "VITE_API_BASE=http://localhost:8080",
      ""
    ].join("\n")
  );
  await ensureFileLines(path.join(workspaceDir, ".dockerignore"), [
    "node_modules",
    "dist",
    ".git",
    ".vite",
    ".env",
    "*.log",
    "runtime",
    "exports"
  ]);
  await fs.writeFile(
    path.join(workspaceDir, "Dockerfile"),
    [
      "FROM node:22-alpine",
      "WORKDIR /app",
      "COPY package*.json ./",
      "RUN npm install",
      "COPY . .",
      `EXPOSE ${port}`,
      `CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "${port}"]`,
      ""
    ].join("\n")
  );
  await fs.ensureDir(path.join(workspaceDir, "backend", "src"));
  await fs.writeJson(
    path.join(workspaceDir, "backend", "package.json"),
    {
      name: "@plutomix/exported-backend",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        start: "node src/server.js",
        dev: "node --watch src/server.js"
      },
      dependencies: {
        cors: "^2.8.5",
        express: "^4.21.2",
        pg: "^8.13.1"
      }
    },
    { spaces: 2 }
  );
  await fs.writeFile(
    path.join(workspaceDir, "backend", "src", "server.js"),
    [
      'import cors from "cors";',
      'import express from "express";',
      'import pg from "pg";',
      "",
      "const app = express();",
      "const port = Number(process.env.BACKEND_PORT || 8080);",
      "const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });",
      "app.use(cors());",
      "app.use(express.json());",
      'app.get("/api/health", async (_req, res) => {',
      "  try {",
      "    await pool.query('select 1');",
      '    res.json({ status: "ok", database: "connected" });',
      "  } catch (error) {",
      '    res.status(500).json({ status: "error", database: "unavailable", message: error.message });',
      "  }",
      "});",
      'app.listen(port, "0.0.0.0", () => console.log(`Exported app backend listening on ${port}`));',
      ""
    ].join("\n")
  );
  await fs.writeFile(
    path.join(workspaceDir, "backend", "Dockerfile"),
    [
      "FROM node:22-alpine",
      "WORKDIR /app",
      "COPY package*.json ./",
      "RUN npm install",
      "COPY . .",
      "EXPOSE 8080",
      'CMD ["npm", "run", "start"]',
      ""
    ].join("\n")
  );
  await fs.writeFile(
    path.join(workspaceDir, "docker-compose.yml"),
    [
      "services:",
      "  frontend:",
      "    build: .",
      "    ports:",
      `      - "\${FRONTEND_PORT:-${port}}:${port}"`,
      "    env_file:",
      "      - .env",
      "    depends_on:",
      "      - backend",
      "  backend:",
      "    build: ./backend",
      "    ports:",
      '      - "${BACKEND_PORT:-8080}:8080"',
      "    env_file:",
      "      - .env",
      "    depends_on:",
      "      database:",
      "        condition: service_healthy",
      "  database:",
      "    image: postgres:16-alpine",
      "    ports:",
      '      - "${DATABASE_PORT:-5432}:5432"',
      "    environment:",
      "      POSTGRES_DB: ${POSTGRES_DB:-appdb}",
      "      POSTGRES_USER: ${POSTGRES_USER:-appuser}",
      "      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-appsecret}",
      "    volumes:",
      "      - app_database:/var/lib/postgresql/data",
      "    healthcheck:",
      '      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-appuser} -d ${POSTGRES_DB:-appdb}"]',
      "      interval: 5s",
      "      timeout: 5s",
      "      retries: 10",
      "volumes:",
      "  app_database:",
      ""
    ].join("\n")
  );
  await writeStandaloneDockerReadme(workspaceDir, port);
}

async function linkTemplateNodeModules(workspaceDir) {
  if (projectRuntimeMode() === "docker") return;
  const target = path.join(templateDir(), "node_modules");
  const link = path.join(workspaceDir, "node_modules");
  if ((await fs.pathExists(link)) || !(await fs.pathExists(target))) return;
  try {
    await fs.symlink(target, link, "dir");
  } catch {
    // Best effort only. Exported projects still include package.json for npm install.
  }
}

async function extractZipSafely(archivePath, targetDir) {
  const zip = new AdmZip(archivePath);
  const root = path.resolve(targetDir);
  for (const entry of zip.getEntries()) {
    const targetPath = path.resolve(targetDir, entry.entryName);
    if (!targetPath.startsWith(`${root}${path.sep}`) && targetPath !== root) {
      throw new Error(`Project archive contains an unsafe path: ${entry.entryName}`);
    }
    if (entry.isDirectory) {
      await fs.ensureDir(targetPath);
      continue;
    }
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, entry.getData());
  }
}

export async function listProjects(options = {}) {
  const projects = await readRegistry();
  const user = options.user || { id: "anonymous" };
  return [
    publicProject({
      id: "default",
      name: "Generated site",
      port: Number(process.env.GENERATED_SITE_PORT || 5174),
      workspaceDir: templateDir(),
      previewUrl: process.env.GENERATED_SITE_URL || "http://localhost:5174",
      isDefault: true,
      status: "running"
    }),
    ...(await Promise.all(projects.filter((project) => canAccessProject(project, user)).map(publicProjectWithRuntime)))
  ];
}

export async function getProject(projectId, options = {}) {
  if (!projectId || projectId === "default") {
    return (await listProjects(options))[0];
  }
  const project = (await readRegistry()).find((row) => row.id === projectId);
  return project && canAccessProject(project, options.user || { id: "anonymous" }) ? publicProjectWithRuntime(project) : null;
}

/**
 * Bind a managed project to its first authorized Decision Continuity tenant.
 * The binding is intentionally project metadata, not a replacement for the
 * identity-membership boundary: callers must already hold the desired
 * decision permission before invoking this function.
 */
export async function bindProjectDecisionContinuity(projectId, { user = {}, tenantId, principalId } = {}) {
  if (!projectId || projectId === "default") {
    const error = new Error("Architecture discovery requires a managed imported or PlutoMix-created project.");
    error.code = "managed_project_required";
    error.status = 400;
    throw error;
  }
  if (!tenantId || !principalId) {
    const error = new Error("An authorized project tenant and principal are required.");
    error.code = "project_binding_invalid";
    error.status = 400;
    throw error;
  }
  const projects = await readRegistry();
  const index = projects.findIndex((row) => row.id === projectId);
  if (index === -1 || !canAccessProject(projects[index], user)) {
    const error = new Error("Project not found.");
    error.code = "project_not_found";
    error.status = 404;
    throw error;
  }
  const project = projects[index];
  const existing = project.decisionContinuity || null;
  if (existing?.tenantId && existing.tenantId !== tenantId) {
    const error = new Error("This managed project is already bound to a different Decision Continuity tenant.");
    error.code = "project_tenant_binding_denied";
    error.status = 403;
    throw error;
  }
  if (existing?.workspaceId && existing.workspaceId !== project.id) {
    const error = new Error("This managed project has an invalid Decision Continuity workspace binding.");
    error.code = "project_workspace_binding_invalid";
    error.status = 409;
    throw error;
  }
  const decisionContinuity = existing || {
    tenantId,
    workspaceId: project.id,
    boundAt: new Date().toISOString(),
    boundByPrincipalId: principalId
  };
  const updated = { ...project, decisionContinuity, updatedAt: new Date().toISOString() };
  projects[index] = updated;
  await writeRegistry(projects);
  return publicProjectWithRuntime(updated);
}

/** Read-only project access check for the Decision Continuity boundary. */
export async function getProjectDecisionContinuity(projectId, { user = {}, tenantId } = {}) {
  if (!projectId || projectId === "default") {
    const error = new Error("Architecture discovery requires a managed imported or PlutoMix-created project.");
    error.code = "managed_project_required";
    error.status = 400;
    throw error;
  }
  const project = (await readRegistry()).find((row) => row.id === projectId);
  if (!project || !canAccessProject(project, user)) {
    const error = new Error("Project not found.");
    error.code = "project_not_found";
    error.status = 404;
    throw error;
  }
  if (project.decisionContinuity?.tenantId && project.decisionContinuity.tenantId !== tenantId) {
    const error = new Error("This managed project is already bound to a different Decision Continuity tenant.");
    error.code = "project_tenant_binding_denied";
    error.status = 403;
    throw error;
  }
  if (project.decisionContinuity?.workspaceId && project.decisionContinuity.workspaceId !== project.id) {
    const error = new Error("This managed project has an invalid Decision Continuity workspace binding.");
    error.code = "project_workspace_binding_invalid";
    error.status = 409;
    throw error;
  }
  return publicProjectWithRuntime(project);
}

export async function updateProjectIdentity(projectId, updates = {}, options = {}) {
  if (!projectId || projectId === "default") throw new Error("The shared generated-site project cannot be renamed.");
  const projects = await readRegistry();
  const index = projects.findIndex((row) => row.id === projectId);
  if (index === -1) throw new Error("Project not found.");
  const project = projects[index];
  if (!canAccessProject(project, options.user || { id: "anonymous" })) throw new Error("Project not found.");

  const nextName = String(updates.name ?? project.name).trim();
  if (nextName.length < 2 || nextName.length > 80) throw new Error("Project name must be 2-80 characters.");
  const requestedWorkspaceName = updates.workspaceName === undefined ? project.folderName : String(updates.workspaceName || "").trim();
  const nextFolderName = slugify(requestedWorkspaceName || nextName);
  if (nextFolderName.length < 2 || nextFolderName.length > 80) throw new Error("Workspace name must be 2-80 characters.");
  const enterpriseIdProvided = Object.prototype.hasOwnProperty.call(updates, "enterpriseId");
  const enterpriseNameProvided = Object.prototype.hasOwnProperty.call(updates, "enterpriseName");
  const enterpriseUpdateRequested = enterpriseIdProvided || enterpriseNameProvided;
  let enterprise = project.enterprise || null;
  if (enterpriseUpdateRequested) {
    const explicitEnterpriseId = enterpriseIdProvided ? String(updates.enterpriseId || "").trim() : "";
    const explicitEnterpriseName = enterpriseNameProvided ? String(updates.enterpriseName || "").trim() : "";
    const clearEnterprise = (enterpriseIdProvided && !explicitEnterpriseId && !enterpriseNameProvided)
      || (enterpriseNameProvided && !explicitEnterpriseName && !enterpriseIdProvided)
      || (enterpriseIdProvided && enterpriseNameProvided && !explicitEnterpriseId && !explicitEnterpriseName);
    const requestedEnterpriseId = explicitEnterpriseId
      || (enterpriseIdProvided
        ? (explicitEnterpriseName ? slugify(explicitEnterpriseName) : "")
        : project.enterprise?.id || (explicitEnterpriseName ? slugify(explicitEnterpriseName) : ""));
    const requestedEnterpriseName = enterpriseNameProvided
      ? explicitEnterpriseName
      : (explicitEnterpriseId && explicitEnterpriseId !== project.enterprise?.id
        ? explicitEnterpriseId
        : project.enterprise?.name || explicitEnterpriseId);
    if (clearEnterprise || (!requestedEnterpriseName && !requestedEnterpriseId)) {
      enterprise = null;
    } else {
      const normalizedEnterprise = normalizeEnterpriseTag({
        enterpriseId: requestedEnterpriseId,
        enterpriseName: requestedEnterpriseName || requestedEnterpriseId
      });
      if (!normalizedEnterprise.enterpriseId || normalizedEnterprise.enterpriseId.length < 2) {
        throw new Error("Enterprise ID must be 2-80 characters.");
      }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(normalizedEnterprise.enterpriseId)) {
        throw new Error("Enterprise ID may contain lowercase letters, numbers, and hyphens only.");
      }
      if (normalizedEnterprise.enterpriseName.length < 2 || normalizedEnterprise.enterpriseName.length > 80) {
        throw new Error("Enterprise name must be 2-80 characters.");
      }
      const sameEnterprise = project.enterprise?.id === normalizedEnterprise.enterpriseId
        && project.enterprise?.name === normalizedEnterprise.enterpriseName;
      enterprise = {
        id: normalizedEnterprise.enterpriseId,
        name: normalizedEnterprise.enterpriseName,
        taggedAt: sameEnterprise && project.enterprise?.taggedAt ? project.enterprise.taggedAt : new Date().toISOString(),
        taggedByUserId: options.user?.id || project.enterprise?.taggedByUserId || "anonymous"
      };
    }
  }

  let workspaceDir = project.workspaceDir;
  if (nextFolderName !== project.folderName) {
    if (projects.some((row) => row.id !== project.id && row.tenantId === project.tenantId && row.folderName === nextFolderName)) {
      throw new Error("Workspace name is already in use.");
    }
    const workspaceRoot = path.resolve(tenantProjectsRoot(project));
    const currentWorkspaceDir = path.resolve(project.workspaceDir);
    const nextWorkspaceDir = path.resolve(path.join(workspaceRoot, nextFolderName));
    if (path.dirname(currentWorkspaceDir) !== workspaceRoot || path.dirname(nextWorkspaceDir) !== workspaceRoot) {
      throw new Error(`Refusing to rename project workspace outside ${workspaceRoot}.`);
    }
    if (await fs.pathExists(nextWorkspaceDir)) throw new Error("Workspace folder already exists.");
    if (projectRuntimeMode() === "docker" && hasDockerSocket()) {
      const containerName = projectContainerName(project);
      const container = await inspectContainer(containerName);
      if (container?.State?.Running) await stopContainer(containerName);
    } else {
      const child = runningProjects.get(project.id);
      if (child && child.exitCode === null) child.kill("SIGTERM");
      runningProjects.delete(project.id);
    }
    await fs.move(currentWorkspaceDir, nextWorkspaceDir);
    await removeProjectIgnoreEntry(project.workspaceDir);
    await ensureProjectIgnored(nextWorkspaceDir);
    workspaceDir = nextWorkspaceDir;
  }

  const updatedProject = {
    ...project,
    name: nextName,
    folderName: nextFolderName,
    workspaceDir,
    enterprise,
    status: nextFolderName !== project.folderName ? "stopped" : project.status,
    updatedAt: new Date().toISOString()
  };
  projects[index] = updatedProject;
  await writeRegistry(projects);
  await syncProjectAgentIdentity(publicProject(updatedProject));
  return publicProject(updatedProject);
}

async function updateProjectRuntimeStatus(projectId, status) {
  if (!projectId || projectId === "default") return null;
  const projects = await readRegistry();
  const index = projects.findIndex((row) => row.id === projectId);
  if (index === -1) return null;
  projects[index] = {
    ...projects[index],
    status,
    updatedAt: new Date().toISOString()
  };
  await writeRegistry(projects);
  return publicProject(projects[index]);
}

async function isLocalPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

async function dockerHostPorts() {
  if (!hasDockerSocket()) return new Set();
  try {
    const containers = await listContainers();
    return new Set(
      containers
        .flatMap((container) => container.Ports || [])
        .map((port) => Number(port.PublicPort))
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

async function nextPort(projects, options = {}) {
  const start = Number(process.env.PROJECT_PORT_START || 5300);
  const end = Number(process.env.PROJECT_PORT_END || 5399);
  const ignoredProjectId = options.ignoreProjectId || null;
  const used = new Set(
    projects
      .filter((project) => project.id !== ignoredProjectId)
      .map((project) => Number(project.port))
  );
  for (const port of options.excludePorts || []) used.add(Number(port));
  for (const port of await dockerHostPorts()) used.add(port);
  for (let port = start; port <= end; port += 1) {
    if (!used.has(port) && (await isLocalPortAvailable(port))) return port;
  }
  throw new Error(`No free project ports in ${start}-${end}.`);
}

function projectPortRangeSize() {
  const start = Number(process.env.PROJECT_PORT_START || 5300);
  const end = Number(process.env.PROJECT_PORT_END || 5399);
  return Math.max(1, end - start + 1);
}

async function reassignProjectPort(project, failedPorts = []) {
  const projects = await readRegistry();
  const index = projects.findIndex((row) => row.id === project.id);
  const next = await nextPort(projects, {
    ignoreProjectId: project.id,
    excludePorts: failedPorts
  });
  const existingProcess = runningProjects.get(project.id);
  if (existingProcess && existingProcess.exitCode === null && !existingProcess.killed) existingProcess.kill("SIGTERM");
  runningProjects.delete(project.id);
  const updatedProject = {
    ...(index === -1 ? project : projects[index]),
    port: next,
    updatedAt: new Date().toISOString()
  };
  await ensureProjectFiles(updatedProject.workspaceDir, next);
  if (index !== -1) {
    projects[index] = updatedProject;
    await writeRegistry(projects);
  }
  return publicProject(updatedProject);
}

export async function createProject(name, structuredRequest = null, options = {}) {
  const projects = await readRegistry();
  const { folderName, workspaceDir } = await reserveProjectFolder(name, options);
  const id = `${folderName}-${nanoid(6)}`;
  const port = await nextPort(projects);
  try {
    // The shared generated-site workspace contains the most recently rendered
    // app. Reuse its stable Vite shell, but never seed a new project with that
    // mutable generated surface or its assets.
    await copyWorkspace(templateDir(), workspaceDir, { excludePaths: ["src/generated"] });
    await writeCleanGeneratedProjectSeed(workspaceDir, name);
    await ensureProjectFiles(workspaceDir, port);
    await installProjectOrchestratorSeed(workspaceDir, { emit: options.emit });
    await linkTemplateNodeModules(workspaceDir);
    await ensureProjectIgnored(workspaceDir);
  } catch (error) {
    await fs.remove(workspaceDir);
    throw error;
  }

  const createdAt = new Date().toISOString();
  const project = {
    id,
    name,
    folderName,
    port,
    workspaceDir,
    status: "created",
    initialBuildStatus: "pending",
    provenance: {
      origin: "plutomix_created",
      recordedAt: createdAt,
      source: "plutomix_project_creation"
    },
    ownerUserId: options.user?.id || "anonymous",
    ownerName: options.user?.name || "Local user",
    ownerPrincipalId: options.principalId || options.user?.principalId || "",
    tenantId: options.tenantId || "",
    tenantInstanceKey: options.tenantInstanceKey || "",
    enterprise: options.enterprise ? { id: options.enterprise.id, name: options.enterprise.label || options.enterprise.name } : null,
    agentSource: options.agentSource || "global_community",
    decisionContinuity: options.tenantId ? {
      tenantId: options.tenantId,
      workspaceId: id,
      boundAt: createdAt,
      boundByPrincipalId: options.principalId || options.user?.principalId || ""
    } : null,
    brandingPalette: options.brandingPalette || null,
    productDecision: structuredRequest?.productDecision || null,
    previewStrategy: structuredRequest?.productDecision?.previewStrategy || "browser",
    media: [],
    createdAt,
    updatedAt: createdAt
  };
  projects.push(project);
  await writeRegistry(projects);
  try {
    await ensureProjectQAgenticFramework(workspaceDir, project, { source: "plutomix-new-project-generation" });
    await prepareProjectAgentTopology(
      publicProject(project),
      structuredRequest || {
        objective: `Create and maintain ${name}.`,
        pageType: "managed_app_project",
        topic: name,
        sections: ["project", "runtime", "playground"],
        media: []
      }
    );
  } catch (error) {
    // Registration is already durable at this point. Preserve its identity so
    // the API can scope and expose the failed initial instruction instead of
    // leaving an unselectable orphan in the project registry.
    error.project = publicProject(project);
    throw error;
  }
  return publicProject(project);
}

export async function updateProjectInitialBuildStatus(projectId, status) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (!projectId || projectId === "default") return null;
  if (!["pending", "ready", "failed"].includes(normalizedStatus)) throw new Error("Invalid initial project build status.");
  const projects = await readRegistry();
  const index = projects.findIndex((row) => row.id === projectId);
  if (index === -1) return null;
  projects[index] = {
    ...projects[index],
    initialBuildStatus: normalizedStatus,
    initialBuildCompletedAt: normalizedStatus === "pending" ? null : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await writeRegistry(projects);
  return publicProject(projects[index]);
}

export async function importProject(name, archivePath, options = {}) {
  const projects = await readRegistry();
  const { folderName, workspaceDir } = await reserveProjectFolder(name, options);
  const id = `${folderName}-${nanoid(6)}`;
  const port = await nextPort(projects);
  await fs.ensureDir(workspaceDir);
  await extractZipSafely(archivePath, workspaceDir);

  const entries = await fs.readdir(workspaceDir);
  if (entries.length === 1) {
    const first = path.join(workspaceDir, entries[0]);
    const stat = await fs.stat(first);
    if (stat.isDirectory()) {
      const nestedEntries = await fs.readdir(first);
      for (const entry of nestedEntries) {
        await fs.move(path.join(first, entry), path.join(workspaceDir, entry), { overwrite: true });
      }
      await fs.remove(first);
    }
  }

  await ensureProjectFiles(workspaceDir, port);
  await linkTemplateNodeModules(workspaceDir);
  await ensureProjectIgnored(workspaceDir);
  const createdAt = new Date().toISOString();
  const project = {
    id,
    name,
    folderName,
    port,
    workspaceDir,
    status: "imported",
    provenance: {
      origin: "imported",
      recordedAt: createdAt,
      source: "plutomix_project_import"
    },
    ownerUserId: options.user?.id || "anonymous",
    ownerName: options.user?.name || "Local user",
    ownerPrincipalId: options.principalId || options.user?.principalId || "",
    tenantId: options.tenantId || "",
    tenantInstanceKey: options.tenantInstanceKey || "",
    enterprise: options.enterprise ? { id: options.enterprise.id, name: options.enterprise.label || options.enterprise.name } : null,
    agentSource: options.agentSource || "global_community",
    decisionContinuity: options.tenantId ? {
      tenantId: options.tenantId,
      workspaceId: id,
      boundAt: createdAt,
      boundByPrincipalId: options.principalId || options.user?.principalId || ""
    } : null,
    media: [],
    createdAt,
    updatedAt: createdAt
  };
  projects.push(project);
  await writeRegistry(projects);
  await ensureProjectHuggingFaceModelWorkspace(workspaceDir, project, { source: "plutomix-project-import" });
  await syncProjectAgentTopology(publicProject(project), {
    objective: `Maintain and improve the imported project ${name}.`,
    pageType: "imported_app_project",
    topic: name,
    sections: ["project", "runtime", "playground"],
    media: []
  });
  return publicProject(project);
}

export async function startProject(project, options = {}) {
  if (!project || project.isDefault) return { status: "default", containerName: defaultContainerName() };
  if (projectRuntimeMode() === "docker") return startDockerProject(project, options);
  return startProcessProject(project);
}

export async function startProjectInstance(project, options = {}) {
  if (!project) throw new Error("Project not found.");
  const readyProject = await ensureProjectPreviewWithRuntimeRecovery(project, {
    previewTimeoutMs: Number(options.previewTimeoutMs || process.env.PROJECT_INSTANCE_START_TIMEOUT_MS || 30000),
    allowPreviewTimeout: options.allowPreviewTimeout === true,
    emit: options.emit,
    source: "project-instance-start"
  });
  if (project.isDefault) return { ...readyProject, status: "running" };
  const updatedProject = await updateProjectRuntimeStatus(project.id, "running");
  return {
    ...(updatedProject || readyProject),
    ...readyProject,
    status: "running"
  };
}

export async function stopProjectInstance(project) {
  if (!project) throw new Error("Project not found.");
  if (projectRuntimeMode() === "docker") {
    if (!hasDockerSocket()) throw new Error("Docker socket is unavailable; project container cannot be stopped.");
    const containerName = project.isDefault ? defaultContainerName() : projectContainerName(project);
    const container = await inspectContainer(containerName);
    if (container?.State?.Running) await stopContainer(containerName);
    if (project.isDefault) {
      return {
        ...publicProject(project),
        status: "stopped",
        runtime: { status: container ? "stopped" : "not-found", containerName }
      };
    }
    const updatedProject = await updateProjectRuntimeStatus(project.id, "stopped");
    return {
      ...(updatedProject || publicProject(project)),
      status: "stopped",
      runtime: { status: container ? "stopped" : "not-found", containerName }
    };
  }

  if (project.isDefault) {
    return {
      ...publicProject(project),
      status: "running",
      runtime: { status: "default-process-unmanaged", containerName: null }
    };
  }

  const child = runningProjects.get(project.id);
  const wasRunning = Boolean(child && child.exitCode === null && !child.killed);
  if (wasRunning) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  runningProjects.delete(project.id);
  const updatedProject = await updateProjectRuntimeStatus(project.id, "stopped");
  return {
    ...(updatedProject || publicProject(project)),
    status: "stopped",
    runtime: { status: wasRunning ? "stopped" : "already-stopped", containerName: null }
  };
}

async function resolveDockerProjectConfiguration(project) {
  const backendContainerName = process.env.PLUTOMIX_BACKEND_CONTAINER || process.env.HOSTNAME;
  const backend = await inspectContainer(backendContainerName);
  if (!backend) throw new Error(`PlutoMix backend container ${backendContainerName} could not be inspected.`);

  const workspacePath = path.resolve(project.workspaceDir);
  const workspaceMount = (backend.Mounts || [])
    .filter((mount) => workspacePath === mount.Destination || workspacePath.startsWith(`${mount.Destination}${path.sep}`))
    .sort((left, right) => right.Destination.length - left.Destination.length)[0];
  if (!workspaceMount?.Source) {
    throw new Error(`No host mount exposes project workspace ${project.workspaceDir}.`);
  }

  const relativeWorkspace = path.relative(workspaceMount.Destination, workspacePath);
  const hostWorkspace = path.join(workspaceMount.Source, relativeWorkspace);
  const networkName = process.env.PROJECT_RUNTIME_NETWORK || Object.keys(backend.NetworkSettings?.Networks || {})[0];
  if (!networkName) throw new Error("PlutoMix backend is not attached to a Docker network.");
  const runtimeHostIp = String(process.env.PROJECT_RUNTIME_HOST_IP || "0.0.0.0").trim();
  if (!net.isIP(runtimeHostIp)) throw new Error("PROJECT_RUNTIME_HOST_IP must be a valid IPv4 or IPv6 address.");
  const previewAllowedHost = String(process.env.PROJECT_PREVIEW_ALLOWED_HOST || "").trim();
  if (/[\r\n=]/.test(previewAllowedHost)) throw new Error("PROJECT_PREVIEW_ALLOWED_HOST is invalid.");
  const runtimeEnvironment = ["CI=1", "NO_COLOR=1"];
  if (previewAllowedHost) runtimeEnvironment.push(`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=${previewAllowedHost}`);

  return {
    Image: process.env.PROJECT_RUNTIME_IMAGE || backend.Config?.Image,
    WorkingDir: project.workspaceDir,
    Cmd: [
      "sh",
      "-lc",
      "npm install --include=optional --prefer-offline --no-audit --no-fund && " +
        `npm run dev -- --host 0.0.0.0 --port ${project.port}`
    ],
    Env: runtimeEnvironment,
    ExposedPorts: { [`${project.port}/tcp`]: {} },
    Labels: {
      "com.plutomix.runtime": "project",
      "com.plutomix.project-id": project.id
    },
    HostConfig: {
      Binds: [`${hostWorkspace}:${project.workspaceDir}`],
      Mounts: [
        {
          Type: "volume",
          Source: `${projectContainerName(project)}-node-modules`,
          Target: path.join(project.workspaceDir, "node_modules")
        }
      ],
      NetworkMode: networkName,
      PortBindings: {
        [`${project.port}/tcp`]: [{ HostIp: runtimeHostIp, HostPort: String(project.port) }]
      },
      RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 }
    }
  };
}

function hasExpectedDockerConfiguration(container, project) {
  const portBinding = container.HostConfig?.PortBindings?.[`${project.port}/tcp`]?.[0];
  const expectedHostIp = String(process.env.PROJECT_RUNTIME_HOST_IP || "0.0.0.0").trim();
  const dependencyMount = (container.Mounts || []).find(
    (mount) => mount.Destination === path.join(project.workspaceDir, "node_modules") && mount.Type === "volume"
  );
  return (
    container.Config?.WorkingDir === project.workspaceDir &&
    portBinding?.HostPort === String(project.port) &&
    (portBinding?.HostIp || "0.0.0.0") === expectedHostIp &&
    Boolean(dependencyMount)
  );
}

function isStaleDockerNetworkError(error) {
  const message = String(error?.message || error || "");
  return /failed to set up container networking|network [a-f0-9]{12,} not found|network .* not found/i.test(message);
}

async function createDockerProjectContainer(project, containerName) {
  const configuration = await resolveDockerProjectConfiguration(project);
  if (!configuration.Image) throw new Error("No Docker image is available for the project runtime.");
  await createContainer(containerName, configuration);
  return inspectContainer(containerName);
}

async function startDockerProject(project, options = {}) {
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  if (!hasDockerSocket()) throw new Error("Docker socket is unavailable; project container cannot be started.");
  const containerName = projectContainerName(project);
  let container = await inspectContainer(containerName);
  let status = "already-running";

  const nodeModulesPath = path.join(project.workspaceDir, "node_modules");
  try {
    if ((await fs.lstat(nodeModulesPath)).isSymbolicLink()) await fs.remove(nodeModulesPath);
  } catch {
    // A project does not need a host node_modules directory in Docker mode.
  }

  if (container && !hasExpectedDockerConfiguration(container, project)) {
    await removeContainer(containerName);
    container = null;
    status = "recreated";
  }

  if (!container) {
    container = await createDockerProjectContainer(project, containerName);
    status = status === "recreated" ? "recreated" : "created";
  }
  if (!container?.State?.Running) {
    try {
      await startContainer(containerName);
      status = ["created", "recreated"].includes(status) ? `${status}-and-started` : "restarted";
    } catch (error) {
      if (!isStaleDockerNetworkError(error)) throw error;
      emit("project-runtime-network-recovery", `Docker network reference for ${project.name} is stale; recreating its runtime container on the current PlutoMix network.`, {
        projectId: project.id,
        containerName,
        error: error.message
      });
      await removeContainer(containerName);
      container = await createDockerProjectContainer(project, containerName);
      await startContainer(containerName);
      status = "network-recreated-and-started";
    }
  }
  return {
    status,
    containerName,
    healthUrl: `http://${containerName}:${project.port}`
  };
}

async function startProcessProject(project) {
  const existing = runningProjects.get(project.id);
  if (existing && existing.exitCode === null && !existing.killed) {
    return { status: "already-running", containerName: null, healthUrl: `http://127.0.0.1:${project.port}` };
  }
  if (existing) runningProjects.delete(project.id);
  await linkTemplateNodeModules(project.workspaceDir);
  const npmArguments = ["run", "dev", "--", "--host", "0.0.0.0", "--port", String(project.port)];
  const command = await resolveExecutableFromPath("npm");
  const commandArguments = npmArguments;
  const child = spawn(command, commandArguments, {
    cwd: project.workspaceDir,
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
    stdio: "ignore",
    detached: false
  });
  runningProjects.set(project.id, child);
  child.on("exit", () => runningProjects.delete(project.id));
  await new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error) => {
      child.off("spawn", onSpawn);
      runningProjects.delete(project.id);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
  const runtime = { status: "started", containerName: null, healthUrl: `http://127.0.0.1:${project.port}` };
  Object.defineProperty(runtime, "process", {
    value: child,
    enumerable: false
  });
  return runtime;
}

export async function waitForProjectPreview(project, healthUrl, timeoutMs = 90000) {
  if (!project) return true;
  const deadline = Date.now() + timeoutMs;
  const url = healthUrl || `http://127.0.0.1:${project.port}`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      // Vite can reject an internal Docker hostname with 403 while still being
      // fully ready on the public localhost port used by the Playground.
      if (response.status < 500) return true;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Project preview did not become ready on port ${project.port}.`);
}

export async function ensureProjectPreview(project, options = {}) {
  const previewTimeoutMs = options.previewTimeoutMs;
  const allowPreviewTimeout = options.allowPreviewTimeout === true;
  if (!project) throw new Error("Project not found.");
  if (project.isDefault) {
    if (projectRuntimeMode() === "docker") {
      if (!hasDockerSocket()) throw new Error("Docker socket is unavailable; generated-site container cannot be started.");
      const containerName = defaultContainerName();
      const container = await inspectContainer(containerName);
      if (!container) throw new Error(`Generated-site container ${containerName} does not exist.`);
      let status = "already-running";
      if (!container.State?.Running) {
        await startContainer(containerName);
        status = "restarted";
      }
      await waitForProjectPreview(
        project,
        process.env.GENERATED_SITE_INTERNAL_URL || `http://${containerName}:${project.port}`,
        30000
      );
      return { ...publicProject(project), runtime: { status, containerName } };
    }
    return publicProject(project);
  }
  const runtime = await startProject(project, { emit: options.emit });
  try {
    await waitForProjectPreview(project, runtime.healthUrl, previewTimeoutMs);
  } catch (error) {
    if (allowPreviewTimeout && /Project preview did not become ready/i.test(error.message)) {
      return { ...publicProject(project), runtime, previewWarning: error.message };
    }
    error.runtime = runtime;
    throw error;
  }
  return { ...publicProject(project), runtime };
}

async function runtimeFailureMessage(project, runtime) {
  if (projectRuntimeMode() === "docker" && runtime?.containerName) {
    const container = await inspectContainer(runtime.containerName);
    if (container && !container.State?.Running) {
      const logs = (await containerLogs(runtime.containerName)).replace(/\u0000/g, "").trim();
      return [
        `Project runtime exited on port ${project.port}; not retrying more ports.`,
        logs ? `Container log tail:\n${logs.slice(-3000)}` : null
      ].filter(Boolean).join("\n");
    }

    if (container?.State?.Running) {
      const logs = (await containerLogs(runtime.containerName)).replace(/\u0000/g, "").trim();
      return [
        `Project runtime started on port ${project.port}, but the playground preview did not become ready yet. Not retrying more ports because the port was already assigned successfully.`,
        logs ? `Container log tail:\n${logs.slice(-3000)}` : null
      ].filter(Boolean).join("\n");
    }
  }

  if (projectRuntimeMode() !== "docker") {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (runtime?.process?.exitCode !== null || !runningProjects.has(project.id)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  if (projectRuntimeMode() !== "docker" && runtime?.process && runtime.process.exitCode !== null) {
    return `Project runtime process exited on port ${project.port}; not retrying more ports.`;
  }

  if (projectRuntimeMode() !== "docker" && !runningProjects.has(project.id)) {
    return `Project runtime process exited on port ${project.port}; not retrying more ports.`;
  }

  if (projectRuntimeMode() !== "docker" && runtime) {
    return `Project runtime process started on port ${project.port}, but the playground preview did not become ready yet. Not retrying more ports because the port was already assigned successfully.`;
  }

  return null;
}

function isPortAllocationError(error) {
  const message = [
    error?.message,
    error?.cause?.message,
    error?.stderr,
    error?.stdout
  ].filter(Boolean).join("\n");
  return /(?:EADDRINUSE|address already in use|port is already allocated|Ports are not available|Bind for .* failed|listen tcp .* bind)/i.test(message);
}

export async function ensureProjectPreviewWithPortRetry(project, options = {}) {
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const maxAttempts = Number(options.maxAttempts || projectPortRangeSize());
  const previewTimeoutMs = Number(options.previewTimeoutMs || process.env.PROJECT_PREVIEW_PORT_RETRY_TIMEOUT_MS || 120000);
  let currentProject = project;
  const failedPorts = [];
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await ensureProjectPreview(currentProject, { previewTimeoutMs });
    } catch (error) {
      lastError = error;
      if (!currentProject || currentProject.isDefault) break;
      const runtimeMessage = await runtimeFailureMessage(currentProject, error.runtime);
      if (runtimeMessage) {
        lastError = new Error(runtimeMessage);
        break;
      }
      if (!isPortAllocationError(error)) {
        lastError = new Error(
          `${error.message} Not retrying more ports because the failure was not a port allocation error.`
        );
        break;
      }
      failedPorts.push(Number(currentProject.port));
      if (attempt >= maxAttempts) break;
      const previousPort = currentProject.port;
      try {
        currentProject = await reassignProjectPort(currentProject, failedPorts);
      } catch (reassignError) {
        lastError = reassignError;
        break;
      }
      emit("project-port-reassigned", `Port ${previousPort} could not be allocated; retrying ${currentProject.name} on port ${currentProject.port}`, {
        projectId: currentProject.id,
        previousPort,
        port: currentProject.port,
        reason: error.message
      });
    }
  }

  const triedPorts = failedPorts.filter(Boolean).join(", ");
  const suffix = triedPorts ? ` Tried ports: ${triedPorts}.` : "";
  throw new Error(`${lastError?.message || `Project preview did not become ready after ${maxAttempts} attempts.`}${suffix}`);
}

export async function rebuildProjectRuntime(project, options = {}) {
  if (!project) throw new Error("Project not found.");
  if (project.isDefault) throw new Error("The shared generated-site project cannot be rebuilt from the playground.");

  if (projectRuntimeMode() === "docker") {
    if (!hasDockerSocket()) throw new Error("Docker socket is unavailable; project container cannot be rebuilt.");
    await removeContainer(projectContainerName(project));
  } else {
    const child = runningProjects.get(project.id);
    if (child && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 1500);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    runningProjects.delete(project.id);
  }

  return ensureProjectPreviewWithPortRetry(project, {
    emit: options.emit,
    previewTimeoutMs: options.previewTimeoutMs
  });
}

export async function ensureProjectPreviewWithRuntimeRecovery(project, options = {}) {
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const source = options.source || "project-build";
  try {
    return await ensureProjectPreviewWithPortRetry(project, options);
  } catch (initialError) {
    if (!project || project.isDefault) throw initialError;
    emit("project-runtime-recovery-start", `Project runtime did not become ready after ${source}; rebuilding the runtime and retrying the preview.`, {
      stage: "runtime-recovery",
      source,
      projectId: project.id,
      projectName: project.name,
      error: initialError.message
    });
    try {
      const rebuiltProject = await rebuildProjectRuntime(project, options);
      emit("project-runtime-recovery-complete", `Project runtime rebuild recovered ${rebuiltProject.name}.`, {
        stage: "runtime-recovery",
        source,
        projectId: rebuiltProject.id,
        port: rebuiltProject.port,
        runtimeStatus: rebuiltProject.runtime?.status || "rebuilt"
      });
      return rebuiltProject;
    } catch (rebuildError) {
      throw new Error(`${initialError.message}\nAutomatic runtime rebuild also failed: ${rebuildError.message}`);
    }
  }
}

export async function startRegisteredProjects() {
  const projects = await readRegistry();
  await ensureProjectAgentTopologies(projects.map(publicProject));
  const autoStartProjects = String(process.env.PROJECTS_AUTO_START_ON_BOOT || "0") === "1";
  if (!autoStartProjects) {
    if (projectRuntimeMode() === "docker" && hasDockerSocket()) {
      const containers = await listContainers();
      const projectRuntimes = containers.filter((container) => {
        const labels = container.Labels || {};
        const names = Array.isArray(container.Names) ? container.Names : [];
        return labels["com.plutomix.runtime"] === "project"
          || names.some((name) => String(name).replace(/^\//, "").startsWith("plutomix-project-"));
      });
      await Promise.all(
        projectRuntimes
          .filter((container) => container.State === "running")
          .map((container) => stopContainer(container.Id))
      );
    } else {
      await Promise.all([...runningProjects.entries()].map(async ([projectId, child]) => {
        if (child && child.exitCode === null && !child.killed) {
          child.kill("SIGTERM");
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 1500);
            child.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        }
        runningProjects.delete(projectId);
      }));
    }
    const stoppedProjects = projects.map((project) => ({
      ...project,
      status: "stopped",
      updatedAt: new Date().toISOString()
    }));
    await writeRegistry(stoppedProjects);
    return stoppedProjects.map((project) => ({
      ...publicProject(project),
      runtime: { status: "stopped", autoStart: false }
    }));
  }
  const readyProjects = [];
  for (const project of projects) {
    await linkTemplateNodeModules(project.workspaceDir);
    try {
      readyProjects.push(await ensureProjectPreviewWithPortRetry(publicProject(project)));
    } catch {
      // Keep backend startup resilient; selecting the project later will retry.
      readyProjects.push(publicProject(project));
    }
  }
  return readyProjects;
}

export async function saveProjectMedia(project, files, options = {}) {
  if (!project || project.isDefault) throw new Error("Select a created or imported project before uploading media.");
  const projects = await readRegistry();
  const index = projects.findIndex((row) => row.id === project.id);
  if (index === -1) throw new Error("Project not found.");

  const uploadsDir = path.join(project.workspaceDir, "public", "uploads");
  await fs.ensureDir(uploadsDir);
  const media = [];
  for (const file of files) {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const targetPath = path.join(uploadsDir, safeName);
    await fs.move(file.path, targetPath, { overwrite: true });
    media.push({
      id: nanoid(8),
      name: file.originalname,
      path: `public/uploads/${safeName}`,
      urlPath: `/uploads/${safeName}`,
      mimeType: file.mimetype,
      size: file.size,
      purpose: options.purpose || "media"
    });
  }
  projects[index].media = [...(projects[index].media || []), ...media];
  if (options.purpose === "app-icon" && media[0]) {
    projects[index].appIcon = media[0];
  }
  projects[index].updatedAt = new Date().toISOString();
  await writeRegistry(projects);
  return media;
}

export async function removeProjectMedia(project, mediaIds = [], options = {}) {
  if (!project || project.isDefault || !mediaIds.length) return { removed: [], project };
  const projects = await readRegistry();
  const index = projects.findIndex((row) => row.id === project.id);
  if (index === -1) throw new Error("Project not found.");

  const removeIds = new Set(mediaIds);
  const currentMedia = projects[index].media || [];
  const removed = currentMedia.filter((item) => removeIds.has(item.id) && (options.allowAppIcon || item.purpose !== "app-icon"));
  projects[index].media = currentMedia.filter((item) => !removed.some((removedItem) => removedItem.id === item.id));
  if (projects[index].appIcon && removed.some((item) => item.id === projects[index].appIcon.id)) {
    delete projects[index].appIcon;
  }
  projects[index].updatedAt = new Date().toISOString();
  await writeRegistry(projects);

  if (options.deleteFiles !== false) {
    const workspaceRoot = path.resolve(project.workspaceDir);
    for (const item of removed) {
      const relativePath = String(item.path || "").replace(/^\/+/, "");
      if (!relativePath) continue;
      const targetPath = path.resolve(project.workspaceDir, relativePath);
      if (targetPath === workspaceRoot || !targetPath.startsWith(`${workspaceRoot}${path.sep}`)) continue;
      await fs.remove(targetPath).catch(() => {});
    }
  }

  return { removed, project: publicProject(projects[index]) };
}

function composeProjectNames(project) {
  const namespace = project.tenantInstanceKey ? `${project.tenantInstanceKey}-` : "";
  const folderName = `${namespace}${String(project.folderName || slugify(project.name))}`;
  return new Set([folderName, folderName.replace(/-/g, "_"), folderName.replace(/-/g, "")]);
}

async function deleteDockerProjectResources(project) {
  if (!hasDockerSocket()) throw new Error("Docker socket is unavailable; project containers and database volumes cannot be deleted.");
  const containerName = projectContainerName(project);
  const composeNames = composeProjectNames(project);
  const containers = await listContainers();
  const containerIds = new Set([
    containerName,
    `${containerName}-backend`,
    `${containerName}-database`
  ]);
  for (const container of containers) {
    const labels = container.Labels || {};
    if (
      labels["com.plutomix.project-id"] === project.id ||
      composeNames.has(labels["com.docker.compose.project"])
    ) {
      containerIds.add(container.Id);
    }
  }
  for (const id of containerIds) await removeContainer(id);

  const networks = await listNetworks();
  const networkIds = new Set();
  for (const network of networks) {
    const labels = network.Labels || {};
    if (
      labels["com.plutomix.project-id"] === project.id ||
      composeNames.has(labels["com.docker.compose.project"])
    ) {
      networkIds.add(network.Id);
    }
  }
  for (const id of networkIds) await removeNetwork(id);

  const volumes = await listVolumes();
  const volumeNames = new Set([
    `${containerName}-node-modules`,
    `${containerName}-database`,
    `${containerName}-database-data`
  ]);
  for (const name of composeNames) volumeNames.add(`${name}_app_database`);
  for (const volume of volumes) {
    const labels = volume.Labels || {};
    if (
      labels["com.plutomix.project-id"] === project.id ||
      composeNames.has(labels["com.docker.compose.project"])
    ) {
      volumeNames.add(volume.Name);
    }
  }
  for (const name of volumeNames) await removeVolume(name);
  return {
    containers: [...containerIds],
    volumes: [...volumeNames],
    networks: [...networkIds]
  };
}

export async function deleteProject(projectId, options = {}) {
  if (!projectId || projectId === "default") throw new Error("The shared generated-site project cannot be deleted.");
  const projects = await readRegistry();
  const project = projects.find((row) => row.id === projectId);
  if (!project) throw new Error("Project not found.");
  if (!canAccessProject(project, options.user || { id: "anonymous" })) throw new Error("Project not found.");

  const workspaceDir = await managedProjectWorkspace(project);

  let runtimeResources = { containers: [], volumes: [], networks: [] };
  if (projectRuntimeMode() === "docker") {
    runtimeResources = await deleteDockerProjectResources(project);
  } else {
    const child = runningProjects.get(project.id);
    if (child && child.exitCode === null) child.kill("SIGTERM");
    runningProjects.delete(project.id);
  }

  await removeProjectAgentTopology(project);
  await fs.remove(workspaceDir);
  await fs.remove(path.join(exportsRoot(), `${slugify(project.name)}-app.zip`));
  await removeProjectIgnoreEntry(workspaceDir);
  await writeRegistry(projects.filter((row) => row.id !== project.id));
  return {
    id: project.id,
    name: project.name,
    folderName: project.folderName,
    workspaceDir,
    port: project.port,
    deleted: true,
    runtimeResources
  };
}

export async function exportProject(project) {
  if (!project) throw new Error("Project not found.");
  const sourceDir = project.workspaceDir;
  const exportDir = exportsRoot();
  const stagingDir = path.join(exportDir, `_staging-${project.id || "default"}-${Date.now()}`);
  await fs.ensureDir(exportDir);
  await copyWorkspace(sourceDir, stagingDir);
  await ensureProjectFiles(stagingDir, project.port || 5174);

  const zip = new AdmZip();
  const addDir = async (dir, zipDir = "") => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoredWorkspaceEntries.has(entry.name)) continue;
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.join(zipDir, entry.name).split(path.sep).join("/");
      if (entry.isDirectory()) {
        await addDir(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (shouldSkipProjectArtifact(relativePath, stat)) continue;
        zip.addLocalFile(absolutePath, path.dirname(relativePath) === "." ? "" : path.dirname(relativePath));
      }
    }
  };
  await addDir(stagingDir);

  const fileName = `${slugify(project.name)}-app.zip`;
  const outputPath = path.join(exportDir, fileName);
  zip.writeZip(outputPath);
  await fs.remove(stagingDir);
  return { outputPath, fileName };
}
