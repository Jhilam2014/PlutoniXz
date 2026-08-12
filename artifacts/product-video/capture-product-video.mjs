import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "captures");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];

page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(60000);
page.on("pageerror", (error) => errors.push(error.message));

async function settle(milliseconds = 1200) {
  await page.waitForTimeout(milliseconds);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      body { overflow: hidden !important; }
    `
  }).catch(() => {});
}

async function capture(name) {
  await settle(500);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: false });
}

await page.goto("http://localhost:5173", { waitUntil: "commit" });
await page.locator(".workspace-tabs").waitFor({ state: "visible" });
await page.waitForFunction(() => document.querySelectorAll(".project-select-inline option").length > 2);
await settle(1000);

const projectSelect = page.locator(".project-select-inline");
const projectOptions = await projectSelect.locator("option").evaluateAll((options) =>
  options.map((option) => ({ value: option.value, label: option.textContent.trim() }))
);
const captureProject = projectOptions.find((option) => /BrushX/i.test(option.label))
  || projectOptions.find((option) => /voiceX/i.test(option.label))
  || projectOptions.find((option) => option.value && !option.value.startsWith("__"));

if (captureProject) {
  await projectSelect.selectOption(captureProject.value);
  await page.waitForFunction((projectId) => {
    const select = document.querySelector(".project-select-inline");
    return select?.value === projectId && document.querySelector(".project-flow-toggle");
  }, captureProject.value);
  await settle(1800);
  const startButton = page.locator("button[aria-label='Start selected project instance']");
  if (await startButton.isEnabled()) {
    await startButton.click();
  }
  await page.locator("iframe[title='Generated webpage preview']").waitFor({ state: "visible" });
  await page.frameLocator("iframe[title='Generated webpage preview']").locator("body").waitFor({ state: "visible" });
  await settle(4000);
}

await capture("01-builder-workspace");

const instruction = page.locator(".chat-input-shell textarea");
await instruction.fill("Build a customer operations workspace connected to our live account and finance data, with reviewable workflows and clear failure states.");
await capture("02-gotham-builder");

await page.locator(".composer-actions .primary-action").click();
const requiredDataModal = page.locator(".required-data-modal");
await requiredDataModal.waitFor({ state: "visible" });
await capture("03-required-data");
await requiredDataModal.locator("button[aria-label*='Close'], .icon-button").last().click();
await requiredDataModal.waitFor({ state: "detached" });

const flowToggle = page.locator(".project-flow-toggle");
if (await flowToggle.count()) {
  if ((await flowToggle.getAttribute("aria-expanded")) !== "true") await flowToggle.click();
  const detailAction = page.locator(".functionality-detail-action");
  await detailAction.scrollIntoViewIfNeeded();
  await detailAction.click();
  const functionalityModal = page.locator(".functionality-detail-modal");
  await functionalityModal.waitFor({ state: "visible" });
  await capture("04-functionality-analysis");
  await functionalityModal.locator("button[aria-label='Close functionality analysis']").click();
}

await page.locator(".workspace-tabs button", { hasText: "PlutoniX" }).click();
const d3Frame = page.locator("iframe[title='PlutoniX graphical model']");
await d3Frame.waitFor({ state: "visible" });
await page.frameLocator("iframe[title='PlutoniX graphical model']").locator("#graph[data-render-ms]").waitFor({ state: "visible" });
await settle(1600);
await capture("05-agentic-system-d3");

const d3Page = page.frameLocator("iframe[title='PlutoniX graphical model']");
await d3Page.locator("button[data-view-mode='explore']").click();
await d3Page.locator("#graph[data-view-mode='explore']").waitFor({ state: "visible" });
await settle(1600);
const brushXNode = d3Page.locator("g.node", { hasText: "BrushX" }).first();
if (await brushXNode.count()) {
  await brushXNode.focus();
  await brushXNode.press("Enter");
  await d3Page.locator("#insight[aria-hidden='false']").waitFor({ state: "visible" });
  await settle(900);
}
await capture("06-agentic-system-d3-explore");

const controlPlaneTab = page.locator(".agentic-system-subtabs button", { hasText: /Control plane/i });
if (await controlPlaneTab.count()) {
  await controlPlaneTab.click();
  await settle(1800);
  await capture("07-control-plane");
}

await page.locator(".workspace-tabs button", { hasText: /^Agents$/ }).click();
await page.locator(".agents-workspace-tab").waitFor({ state: "visible" });
await settle(2200);
await capture("08-agent-memory");

await page.locator(".workspace-tabs button", { hasText: /Cloud Hosting/ }).click();
await settle(2200);
await capture("09-hosting");

await page.locator(".workspace-tabs button", { hasText: /^Builder$/ }).click();
await settle(1200);
await capture("10-builder-close");

console.log(JSON.stringify({
  project: captureProject?.label || "default",
  captures: 10,
  errors
}, null, 2));

await browser.close();
