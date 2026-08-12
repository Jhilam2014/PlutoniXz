import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "render");
const titles = [
  ["01", "PLUTONIX", "From instruction to a working digital product"],
  ["02", "GOTHAM BUILDER", "Plan, execute and refine in one operational workspace"],
  ["03", "REAL DATA, NOT INVENTED DATA", "Minimal source requests before agents continue"],
  ["04", "FUNCTIONALITY ANALYSIS", "Every requirement, sub-function and assigned agent"],
  ["05", "PLUTONIX GRAPHICAL MODEL", "Project-first topology across every active build"],
  ["06", "EXPLORE THE GRAPH", "Trace relationships and inspect every node"],
  ["07", "CONTROL PLANE", "Health, approval gates and self-improvement evidence"],
  ["08", "GLOBAL AGENT MEMORY", "Inspectable capabilities, roles and vector status"],
  ["09", "CLOUD HOSTING", "Controlled deployment with runtime and provider choices"],
  ["10", "BUILD WITH EVIDENCE", "PlutoniX"]
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

for (const [number, title, subtitle] of titles) {
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          html, body { width: 1920px; height: 1080px; margin: 0; background: transparent; }
          body { position: relative; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          .card {
            position: absolute;
            left: 68px;
            bottom: 70px;
            width: 1040px;
            height: 148px;
            border-left: 8px solid #14b8a6;
            padding: 25px 32px;
            color: #fff;
            background: rgba(15, 23, 42, 0.92);
            box-shadow: 0 20px 55px rgba(2, 6, 23, 0.28);
          }
          h1 { margin: 0; font-size: 44px; line-height: 1; letter-spacing: 0; font-weight: 850; }
          p { margin: 17px 0 0; color: #cbd5e1; font-size: 25px; line-height: 1; font-weight: 650; }
        </style>
      </head>
      <body>
        <section class="card">
          <h1>${title}</h1>
          <p>${subtitle}</p>
        </section>
      </body>
    </html>
  `);
  await page.screenshot({ path: path.join(outputDir, `title-${number}.png`), omitBackground: true });
}

await browser.close();
