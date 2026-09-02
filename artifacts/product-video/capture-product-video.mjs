import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(root, "captures");
const appUrl = process.env.PLUTOMIX_PRODUCT_DEMO_URL || "http://localhost:5173";
const errors = [];
const captured = [];

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(60000);
page.on("pageerror", (error) => errors.push(error.message));

async function settle(milliseconds = 1200) {
  await page.waitForTimeout(milliseconds);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      body { overflow-x: hidden !important; }
    `
  }).catch(() => {});
}

async function capture(name) {
  await settle(650);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: false });
  captured.push(name);
}

async function clickWorkspace(label) {
  const button = page.locator(".workspace-tabs > button", { hasText: label }).first();
  await button.waitFor({ state: "visible" });
  await button.click();
}

await page.goto(appUrl, { waitUntil: "commit" });
const developmentProfileButton = page.getByRole("button", { name: "Use enabled development profile" });
const developmentProfileAvailable = await developmentProfileButton
  .waitFor({ state: "visible", timeout: 5000 })
  .then(() => true)
  .catch(() => false);
if (developmentProfileAvailable) {
  page.once("dialog", (dialog) => dialog.accept("PlutoMix Demo User"));
  await developmentProfileButton.click();
}
await page.locator(".workspace-tabs").waitFor({ state: "visible" });
await settle(1800);

const instructionEditor = page.getByRole("textbox", { name: "Gotham instruction" });

await clickWorkspace(/^Builder$/);
const projectSelect = page.locator(".project-select");
await projectSelect.waitFor({ state: "visible" });
const availableProjects = await projectSelect.locator("option").evaluateAll((options) => options.map((option) => ({
  text: option.textContent?.trim() || "",
  value: option.value
})));
const selectedProject = availableProjects.find((option) => /mapex/i.test(option.text))
  || availableProjects.find((option) => option.value && !/plutomix system/i.test(option.text));
if (selectedProject) {
  await projectSelect.selectOption(selectedProject.value);
  await settle(2200);
}
await instructionEditor.waitFor({ state: "visible" });
await capture("01-builder-workspace");

await instructionEditor.fill(
  "Create a customer-operations workspace with real account and finance data, explicit review points, and clear failure states."
);
await capture("02-builder-evidence-gate");

await clickWorkspace(/^PlutoMix$/);
const analysisTab = page.locator(".agentic-system-subtabs button", { hasText: /^Analysis$/ }).first();
await analysisTab.waitFor({ state: "visible" });
await analysisTab.click();
await page.locator(".plutomix-analysis-workspace").waitFor({ state: "visible" });
await page.locator(".plutomix-analysis-portfolio").waitFor({ state: "visible" });
await settle(5000);
await capture("03-analysis-portfolio");

const openPortfolioMap = page.locator("button[aria-label^='Open the portfolio intelligence popup']").first();
if (await openPortfolioMap.count()) {
  await openPortfolioMap.click();
  await page.locator(".portfolio-brain-detail-dialog").waitFor({ state: "visible" });
  await settle(1600);
  await capture("04-portfolio-intelligence");
  await page.locator(".portfolio-brain-detail-actions button", { hasText: /^Close$/ }).click();
  await page.locator(".portfolio-brain-detail-dialog").waitFor({ state: "detached" });
} else {
  await capture("04-portfolio-intelligence");
}

const preferredApplication = page.locator(".plutomix-analysis-directory-item", { hasText: /mapex/i }).first();
const fallbackApplication = page.locator(".plutomix-analysis-directory-item").first();
const application = await preferredApplication.count()
  ? preferredApplication
  : (await fallbackApplication.count() ? fallbackApplication : null);
if (application) {
  await application.click();
  await page.locator(".plutomix-analysis-application").waitFor({ state: "visible" });
  await settle(4000);
}
await capture("05-application-decisions");

const governance = page.locator(".enterprise-brain-governance").first();
if (await governance.count()) {
  await governance.scrollIntoViewIfNeeded();
  await capture("06-governed-brainx");
} else {
  await capture("06-governed-brainx");
}

const decisionMap = page.locator(".application-decision-map").first();
if (await decisionMap.count()) {
  await decisionMap.scrollIntoViewIfNeeded();
  await settle(2500);
  const expandGraph = decisionMap.getByRole("button", { name: /Expand graph|Expand delivery decision graph/i }).first();
  if (await expandGraph.count() && await expandGraph.isEnabled()) {
    await expandGraph.click();
    await page.locator(".application-decision-map-detail-dialog").waitFor({ state: "visible" });
    await settle(1800);
    await capture("07-delivery-decision-graph");
    await page.getByRole("button", { name: "Close delivery decision graph detail" }).click();
    await page.locator(".application-decision-map-detail-dialog").waitFor({ state: "detached" });
  } else {
    await capture("07-delivery-decision-graph");
  }
} else {
  await capture("07-delivery-decision-graph");
}

const productDocumentTab = page.locator(".agentic-system-subtabs button", { hasText: /^Product Document$/ }).first();
await productDocumentTab.click();
await page.locator(".product-document-panel").waitFor({ state: "visible" });
await settle(1800);
await capture("08-product-document");

await clickWorkspace(/^Cloud Hosting$/);
await page.locator(".cloud-hosting").waitFor({ state: "visible" }).catch(() => page.locator("main").waitFor({ state: "visible" }));
await settle(1800);
await capture("09-hosting");

await clickWorkspace(/^Builder$/);
await instructionEditor.waitFor({ state: "visible" });
await settle(1200);
await capture("10-builder-close");

console.log(JSON.stringify({ appUrl, captures: captured, errors }, null, 2));

await browser.close();
