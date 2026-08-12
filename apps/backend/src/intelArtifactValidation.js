import { spawn } from "node:child_process";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { profileArtifactValidation } from "./intelProfiles.js";

function safeChangedFilePaths(workspaceDir, changedFiles = []) {
  const root = path.resolve(workspaceDir);
  return changedFiles.map((file) => {
    const relative = String(file || "").replaceAll("\\", "/").replace(/^\/+/, "");
    const absolute = path.resolve(root, relative);
    if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) throw new Error("Intel validation rejected a changed file outside the workspace.");
    return { relative, absolute };
  });
}

async function commandAvailable(command, versionArgs = ["--version"]) {
  return new Promise((resolve) => {
    const child = spawn(command, versionArgs, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function runCommand(command, args, cwd, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, CI: "1", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    const output = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: "failed", detail: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        status: code === 0 ? "passed" : "failed",
        detail: code === 0 ? `${command} ${args.join(" ")} passed.` : `${command} ${args.join(" ")} exited with ${signal || code}: ${Buffer.concat(output).toString("utf8").slice(-800)}`
      });
    });
  });
}

async function findRenderedPdf(renderRoot) {
  const entries = await fs.readdir(renderRoot).catch(() => []);
  const pdf = entries.find((entry) => /\.pdf$/i.test(entry));
  return pdf ? path.join(renderRoot, pdf) : "";
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(1, 4).toString("ascii") !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function renderPdfForInspection(pdfPath, renderRoot) {
  if (!(await commandAvailable("pdftoppm", ["-v"]))) {
    return { status: "failed", detail: "pdftoppm is unavailable, so rendered PDF inspection cannot be claimed." };
  }
  const render = await runCommand("pdftoppm", ["-png", "-f", "1", "-singlefile", pdfPath, path.join(renderRoot, "page")], renderRoot, 60_000);
  const image = path.join(renderRoot, "page.png");
  const buffer = await fs.readFile(image).catch(() => null);
  const dimensions = buffer ? pngDimensions(buffer) : null;
  const rendered = render.status === "passed" && Boolean(dimensions) && dimensions.width >= 200 && dimensions.height >= 200;
  return {
    status: rendered ? "passed" : "failed",
    detail: rendered
      ? `Rendered a ${dimensions.width}×${dimensions.height} first page for visual inspection.`
      : render.status === "passed"
        ? "The rendered first page was not a usable PNG image."
        : render.detail
  };
}

async function convertOfficeDocumentToPdf(documentPath, renderRoot) {
  if (!(await commandAvailable("soffice"))) {
    return { status: "failed", detail: "LibreOffice Writer is unavailable, so DOCX rendered visual inspection cannot be claimed." };
  }
  const conversion = await runCommand("soffice", ["--headless", "--convert-to", "pdf", "--outdir", renderRoot, documentPath], renderRoot, 120_000);
  const pdfPath = conversion.status === "passed" ? await findRenderedPdf(renderRoot) : "";
  return pdfPath
    ? { status: "passed", pdfPath }
    : { status: "failed", detail: conversion.status === "passed" ? "LibreOffice did not produce a PDF preview for the DOCX deliverable." : conversion.detail };
}

async function validateCodeProject(workspaceDir, profileId) {
  const packagePath = path.join(workspaceDir, "package.json");
  if (!(await fs.pathExists(packagePath))) {
    return [{ id: "project-commands", status: "passed", detail: "No package.json was found; project command validation is not applicable." }];
  }
  const manifest = await fs.readJson(packagePath).catch(() => ({}));
  const scripts = manifest.scripts || {};
  const packageManager = String(manifest.packageManager || "").startsWith("pnpm") ? "pnpm" : String(manifest.packageManager || "").startsWith("yarn") ? "yarn" : "npm";
  if (!(await commandAvailable(packageManager))) {
    return [{ id: "project-commands", status: "failed", detail: `${packageManager} is required to run ${profileId} project validation but is unavailable.` }];
  }
  const relevant = ["lint", "test", "typecheck", "build"].filter((name) => scripts[name]);
  if (!relevant.length) {
    return [{ id: "project-commands", status: "passed", detail: "No lint, test, typecheck, or build script is defined for this project." }];
  }
  const rows = [];
  for (const script of relevant) {
    rows.push({ id: `project-${script}`, ...(await runCommand(packageManager, ["run", script], workspaceDir)) });
  }
  return rows;
}

async function validateDocumentRender(files) {
  const document = files.find((file) => /\.(pdf|docx)$/i.test(file.relative));
  if (!document) return [{ id: "render-inspection", status: "failed", detail: "No PDF or DOCX deliverable was available for rendered visual inspection." }];
  const renderRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-document-render-"));
  try {
    let pdfPath = document.absolute;
    const checks = [];
  if (/\.docx$/i.test(document.relative)) {
    try {
      const zip = new AdmZip(document.absolute);
      if (!zip.getEntry("word/document.xml")) return [{ id: "document-structure", status: "failed", detail: "The DOCX file does not contain word/document.xml." }];
    } catch {
      return [{ id: "document-structure", status: "failed", detail: "The DOCX deliverable could not be opened." }];
    }
    checks.push({ id: "document-structure", status: "passed", detail: "DOCX structure contains word/document.xml." });
    const converted = await convertOfficeDocumentToPdf(document.absolute, renderRoot);
    if (converted.status !== "passed") return [...checks, { id: "render-inspection", status: "failed", detail: converted.detail }];
    pdfPath = converted.pdfPath;
  } else {
    const header = await fs.readFile(document.absolute).then((buffer) => buffer.subarray(0, 5).toString("utf8")).catch(() => "");
    if (header !== "%PDF-") return [{ id: "pdf-structure", status: "failed", detail: "The requested PDF deliverable has an invalid header." }];
    checks.push({ id: "pdf-structure", status: "passed", detail: "PDF header is valid." });
  }
    return [...checks, { id: "render-inspection", ...(await renderPdfForInspection(pdfPath, renderRoot)) }];
  } finally {
    await fs.remove(renderRoot);
  }
}

async function validateWorkbook(files) {
  const workbook = files.find((file) => /\.xlsx$/i.test(file.relative));
  if (!workbook) return [{ id: "formula-reference-check", status: "failed", detail: "No XLSX workbook was available for formula validation." }];
  try {
    const zip = new AdmZip(workbook.absolute);
    const sheets = zip.getEntries().filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.entryName));
    if (!sheets.length) return [{ id: "formula-reference-check", status: "failed", detail: "The workbook has no worksheet XML entries." }];
    const source = zip.getEntries()
      .filter((entry) => /^xl\/(?:worksheets\/sheet\d+|sharedStrings)\.xml$/.test(entry.entryName))
      .map((entry) => entry.getData().toString("utf8"))
      .join("\n");
    const errors = source.match(/#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/g) || [];
    const checks = [{
      id: "formula-reference-check",
      status: errors.length ? "failed" : "passed",
      detail: errors.length ? `Workbook contains formula error values: ${[...new Set(errors)].join(", ")}.` : `Workbook contains ${sheets.length} worksheet${sheets.length === 1 ? "" : "s"} with no stored formula-reference errors.`
    }];
    if (!(await commandAvailable("soffice"))) {
      return [...checks, { id: "workbook-recalculation", status: "failed", detail: "LibreOffice Calc is unavailable, so workbook recalculation and rendered preview cannot be claimed." }];
    }
    const renderRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-workbook-render-"));
    try {
      const conversion = await runCommand("soffice", ["--headless", "--convert-to", "pdf", "--outdir", renderRoot, workbook.absolute], renderRoot, 120_000);
      const pdfPath = conversion.status === "passed" ? await findRenderedPdf(renderRoot) : "";
      if (!pdfPath) {
        return [...checks, {
          id: "workbook-recalculation",
          status: "failed",
          detail: conversion.status === "passed" ? "LibreOffice Calc did not produce a PDF workbook preview." : conversion.detail
        }];
      }
      const rendered = await renderPdfForInspection(pdfPath, renderRoot);
      return [
        ...checks,
        { id: "workbook-recalculation", status: "passed", detail: "LibreOffice Calc recalculated and exported the workbook for validation." },
        { id: "workbook-preview", ...rendered }
      ];
    } finally {
      await fs.remove(renderRoot);
    }
  } catch {
    return [{ id: "formula-reference-check", status: "failed", detail: "The XLSX workbook could not be opened for formula and reference validation." }];
  }
}

export async function validateIntelProfileOutput({ profile, workspaceDir, changedFiles = [] } = {}) {
  const files = safeChangedFilePaths(workspaceDir, changedFiles);
  const checks = profileArtifactValidation(profile, changedFiles).checks.map((check) => ({ id: check.id, status: check.passed ? "passed" : "failed", detail: check.detail }));
  if (profile?.id === "web-application" || profile?.id === "api-service") {
    checks.push(...await validateCodeProject(workspaceDir, profile.id));
  }
  if (profile?.id === "document-pdf") checks.push(...await validateDocumentRender(files));
  if (profile?.id === "spreadsheet") checks.push(...await validateWorkbook(files));
  return {
    status: checks.some((check) => check.status === "failed") ? "failed" : checks.some((check) => check.status === "skipped") ? "passed_with_skips" : "passed",
    profileId: profile?.id || "",
    checks
  };
}
