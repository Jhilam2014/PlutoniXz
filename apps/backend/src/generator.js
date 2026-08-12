import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { nanoid } from "nanoid";

const generatedDir = process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site");
const generatedSourceDir = path.join(generatedDir, "src", "generated");

function cleanInstruction(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

function titleCase(value) {
  return String(value || "digital product")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function routeKey(value) {
  return String(value || "page")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "page";
}

function componentNameForRoute(key) {
  return `${String(key || "page")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("")}Page`;
}

function textHasSignal(text, signal) {
  if (signal.includes(" ")) return text.includes(signal);
  return new RegExp(`\b${signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`).test(text);
}

function textHasAnySignal(text, signals) {
  return signals.some((signal) => textHasSignal(text, signal));
}

function normalizeRoute(route, fallbackIndex) {
  const key = routeKey(route?.key || route?.title || `page-${fallbackIndex + 1}`);
  const pathName = String(route?.path || `/${key}`).trim();
  const cleanPath = key === "home" || pathName === "/" ? "/" : `/${pathName.replace(/^#+/, "").replace(/^\/+/, "")}`;
  return {
    key,
    path: cleanPath,
    title: route?.title || titleCase(key),
    description: route?.description || `${titleCase(key)} page generated for the requested website scope.`,
    sections: Array.isArray(route?.sections) ? route.sections : []
  };
}

function defaultRoutesForRequest(request) {
  const text = `${request?.pageType || ""} ${request?.sourceInstruction || ""} ${request?.objective || ""}`.toLowerCase();
  const routes = [
    { key: "home", path: "/", title: "Home", description: "Primary positioning and conversion entry point." }
  ];
  if (text.includes("platform") || text.includes("saas") || text.includes("product")) {
    routes.push({ key: "features", path: "/features", title: "Features", description: "Capability modules, workflows, and product outcomes." });
  }
  if (text.includes("services") || text.includes("agency") || text.includes("business")) {
    routes.push({ key: "services", path: "/services", title: "Services", description: "Service packages, delivery model, and engagement options." });
  }
  if (text.includes("projects") || text.includes("case stud")) {
    routes.push({ key: "projects", path: "/projects", title: "Projects", description: "Project examples, case studies, and proof." });
  }
  if (textHasAnySignal(text, ["shop", "store", "catalog", "commerce", "ecommerce", "bag", "bags", "handbag", "luggage"])) {
    routes.push({ key: "catalog", path: "/catalog", title: "Catalog", description: "Products, merchandising, materials, and buying path." });
  }
  if (text.includes("dashboard") || text.includes("admin") || text.includes("portal")) {
    routes.push({ key: "dashboard", path: "/dashboard", title: "Dashboard", description: "Operational metrics, panels, states, and workflows." });
  }
  if (text.includes("pricing")) {
    routes.push({ key: "pricing", path: "/pricing", title: "Pricing", description: "Plans, comparison, and conversion options." });
  }
  routes.push(
    { key: "about", path: "/about", title: "About", description: "Story, credibility, trust, and operating principles." },
    { key: "contact", path: "/contact", title: "Contact", description: "Lead capture and next-step CTA." }
  );
  if (routes.length < 5) {
    routes.splice(1, 0, { key: "services", path: "/services", title: "Services", description: "Services and capabilities." });
    routes.splice(2, 0, { key: "projects", path: "/projects", title: "Projects", description: "Work examples and outcomes." });
  }
  const seen = new Set();
  return routes.filter((route) => {
    const key = routeKey(route.key);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveRoutes(request) {
  if (request?.siteStructure !== "multi_page") return [];
  const rawRoutes = Array.isArray(request?.routePlan) && request.routePlan.length ? request.routePlan : defaultRoutesForRequest(request);
  const seen = new Set();
  return rawRoutes
    .map((route, index) => normalizeRoute(route, index))
    .filter((route) => {
      if (seen.has(route.key)) return false;
      seen.add(route.key);
      return true;
    });
}

function isMultiPageRequest(request, routes) {
  return request?.siteStructure === "multi_page" && routes.length > 1;
}

function isBagBusiness(request) {
  const text = `${request?.topic || ""} ${request?.sourceInstruction || ""}`.toLowerCase();
  return text.includes("bag") || text.includes("handbag") || text.includes("luggage") || text.includes("backpack");
}

function buildCommerceModel(request) {
  const bagBusiness = isBagBusiness(request);
  if (bagBusiness) {
    return {
      brand: "Atelier Carry",
      eyebrow: "Generated commerce experience",
      headline: "Premium bags for workdays, weekends, and everything in motion",
      subhead:
        "A refined bag business storefront with bestsellers, material storytelling, trust cues, and a conversion-ready product journey.",
      cta: "Shop signature bags",
      secondaryCta: "Explore materials",
      stats: [
        { label: "Signature styles", value: "24" },
        { label: "Avg. rating", value: "4.9" },
        { label: "Ships in", value: "48h" }
      ],
      products: [
        {
          name: "The Metro Tote",
          price: "$168",
          tag: "Work essential",
          description: "Structured vegan leather tote with padded laptop sleeve and hidden zip pocket."
        },
        {
          name: "Aero Crossbody",
          price: "$96",
          tag: "Everyday carry",
          description: "Compact hands-free profile with brushed hardware and adjustable woven strap."
        },
        {
          name: "Weekender 42",
          price: "$220",
          tag: "Travel ready",
          description: "Cabin-friendly duffle with shoe garage, trolley sleeve, and weather-resistant canvas."
        }
      ],
      materials: ["Italian recycled nylon", "Plant-based leather", "Solid brass hardware", "Organic cotton lining"],
      workflow: ["Choose your silhouette", "Pick material and color", "Add monogramming", "Ship with carbon-neutral delivery"]
    };
  }

  const topic = titleCase(request?.topic || "product");
  return {
    brand: `${topic} Command Center`,
    eyebrow: "Generated by PlutoniX",
    headline: `${topic} experiences designed for teams that move fast`,
    subhead: cleanInstruction(request?.sourceInstruction || request?.objective),
    cta: `Launch ${topic}`,
    secondaryCta: "Review workflow",
    stats: [
      { label: "Build velocity", value: "4.8x" },
      { label: "Conversion lift", value: "31%" },
      { label: "Design score", value: "A+" }
    ],
    products: [
      {
        name: "Strategy-led structure",
        price: "A+",
        tag: "Positioning",
        description: "Clear outcomes, confident hierarchy, and scan-friendly sections."
      },
      {
        name: "Runtime-ready polish",
        price: "Live",
        tag: "Preview",
        description: "Spacing, contrast, and calls to action prepared for real-time review."
      },
      {
        name: "Composable sections",
        price: "Modular",
        tag: "System",
        description: "Blocks can evolve into pricing, onboarding, demos, or workflow pages."
      }
    ],
    materials: ["Responsive layout", "Professional typography", "Accessible contrast", "Reusable React modules"],
    workflow: ["Capture intent", "Plan file operations", "Apply generated source", "Restart preview container"]
  };
}

function catalogDataSource(model) {
  return `export const catalog = ${JSON.stringify(model, null, 2)};
`;
}

function pageSource(instructionHash) {
  return `import { catalog } from "./catalogData.js";

export const generatedMetadata = {
  instructionHash: ${JSON.stringify(instructionHash)},
  generatedAt: ${JSON.stringify(new Date().toISOString())}
};

export default function GeneratedPage() {
  return (
    <main className="generated-page">
      <section className="hero">
        <nav className="nav">
          <strong>{catalog.brand}</strong>
          <div>
            <a href="#catalog">Catalog</a>
            <a href="#materials">Materials</a>
            <a href="#workflow">Experience</a>
          </div>
        </nav>
        <div className="hero-grid">
          <div className="hero-copy">
            <span>{catalog.eyebrow}</span>
            <h1>{catalog.headline}</h1>
            <p>{catalog.subhead}</p>
            <div className="hero-actions">
              <a className="primary" href="#catalog">{catalog.cta}</a>
              <a className="secondary" href="#materials">{catalog.secondaryCta}</a>
            </div>
          </div>
          <div className="insight-panel">
            <h2>Storefront snapshot</h2>
            <p>Generated through Codex workflow file operations and refreshed in its preview container.</p>
            <div className="panel-grid">
              {catalog.stats.map((stat) => (
                <div key={stat.label}>
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="catalog-section" id="catalog">
        <div className="section-intro">
          <span>Generated catalog</span>
          <h2>Merchandised for fast browsing and confident checkout.</h2>
        </div>
        <div className="product-grid">
          {catalog.products.map((product) => (
            <article key={product.name} className="product-card">
              <div className="product-visual">
                <span>{product.tag}</span>
              </div>
              <div>
                <h3>{product.name}</h3>
                <strong>{product.price}</strong>
                <p>{product.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="materials" id="materials">
        <div>
          <span>Material story</span>
          <h2>Every detail supports trust, durability, and premium positioning.</h2>
        </div>
        <ul>
          {catalog.materials.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="workflow" id="workflow">
        <div>
          <span>Buying experience</span>
          <h2>Simple enough to browse, structured enough to scale.</h2>
        </div>
        <ol>
          {catalog.workflow.map((step, index) => (
            <li key={step}>
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="launch">
        <h2>{catalog.cta}</h2>
        <p>Regenerate from PlutoniX to add, modify, or delete files in this generated app.</p>
      </section>
    </main>
  );
}
`;
}

function siteStructureSource(request, routes) {
  return `export const siteStructure = ${JSON.stringify(
    {
      siteStructure: request.siteStructure || "single_page",
      complexityScaling: request.complexityScaling || null,
      routes
    },
    null,
    2
  )};
`;
}

function pageModuleSource(route) {
  const componentName = componentNameForRoute(route.key);
  const title = route.title || titleCase(route.key);
  const description = route.description || `${title} page generated for the requested site.`;
  const key = route.key;

  if (key === "home") {
    return `import { catalog } from "../catalogData.js";

export default function ${componentName}() {
  return (
    <section className="site-page route-home">
      <div className="route-hero-copy">
        <span>{catalog.eyebrow}</span>
        <h1>{catalog.headline}</h1>
        <p>{catalog.subhead}</p>
        <div className="hero-actions">
          <a className="primary" href="#/contact">{catalog.cta}</a>
          <a className="secondary" href="#/services">Explore the site</a>
        </div>
      </div>
      <div className="route-panel-grid">
        {catalog.stats.map((stat) => (
          <article key={stat.label} className="metric-card">
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
`;
  }

  if (key === "services" || key === "features") {
    return `import { catalog } from "../catalogData.js";

export default function ${componentName}() {
  return (
    <section className="site-page">
      <div className="section-intro">
        <span>${title}</span>
        <h1>${description}</h1>
        <p>Structured into route-level content so users can browse capabilities without a long flattened landing page.</p>
      </div>
      <div className="route-grid">
        {catalog.workflow.map((step, index) => (
          <article key={step} className="route-card">
            <strong>{String(index + 1).padStart(2, "0")}</strong>
            <h3>{step}</h3>
            <p>Clear delivery step with supporting copy, proof, and follow-through.</p>
          </article>
        ))}
      </div>
    </section>
  );
}
`;
  }

  if (key === "projects" || key === "catalog") {
    return `import { catalog } from "../catalogData.js";

export default function ${componentName}() {
  return (
    <section className="site-page">
      <div className="section-intro">
        <span>${title}</span>
        <h1>${description}</h1>
        <p>Each item is separated into a dedicated browsing route to support scalable navigation and future detail pages.</p>
      </div>
      <div className="product-grid route-product-grid">
        {catalog.products.map((product) => (
          <article key={product.name} className="product-card">
            <div className="product-visual"><span>{product.tag}</span></div>
            <div>
              <h3>{product.name}</h3>
              <strong>{product.price}</strong>
              <p>{product.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
`;
  }

  if (key === "pricing") {
    return `import { catalog } from "../catalogData.js";

export default function ${componentName}() {
  return (
    <section className="site-page">
      <div className="section-intro">
        <span>${title}</span>
        <h1>${description}</h1>
        <p>Pricing is isolated as its own route so offer framing, comparison, FAQs, and CTA logic can evolve independently.</p>
      </div>
      <div className="route-grid">
        {catalog.products.map((product) => (
          <article key={product.name} className="route-card">
            <span>{product.tag}</span>
            <h3>{product.name}</h3>
            <strong>{product.price}</strong>
            <p>{product.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
`;
  }

  if (key === "dashboard") {
    return `import { catalog } from "../catalogData.js";

export default function ${componentName}() {
  return (
    <section className="site-page">
      <div className="section-intro">
        <span>${title}</span>
        <h1>${description}</h1>
        <p>Operational pages stay route-level so metrics, filters, states, and workflows can expand without cluttering Home.</p>
      </div>
      <div className="route-panel-grid">
        {catalog.stats.map((stat) => (
          <article key={stat.label} className="metric-card">
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
`;
  }

  return `import { catalog } from "../catalogData.js";

export default function ${componentName}() {
  return (
    <section className="site-page">
      <div className="section-intro">
        <span>${title}</span>
        <h1>${description}</h1>
        <p>This route gives the site a scalable page boundary instead of forcing every concern into a single landing page.</p>
      </div>
      <div className="materials route-materials">
        <div>
          <span>Trust signals</span>
          <h2>Built for credibility, clarity, and future expansion.</h2>
        </div>
        <ul>
          {catalog.materials.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
      <div className="launch route-launch">
        <h2>{catalog.cta}</h2>
        <p>Use the Contact route or regenerate this project to expand the website further.</p>
      </div>
    </section>
  );
}
`;
}

function multiPageSource(instructionHash, routes) {
  const imports = routes
    .map((route) => `import ${componentNameForRoute(route.key)} from "./pages/${componentNameForRoute(route.key)}.jsx";`)
    .join("\n");
  const registry = routes
    .map((route) => `  ${JSON.stringify(route.key)}: ${componentNameForRoute(route.key)}`)
    .join(",\n");

  return `import { useEffect, useState } from "react";
import { catalog } from "./catalogData.js";
import { siteStructure } from "./siteStructure.js";
${imports}

export const generatedMetadata = {
  instructionHash: ${JSON.stringify(instructionHash)},
  generatedAt: ${JSON.stringify(new Date().toISOString())},
  siteStructure: "multi_page"
};

const pageComponents = {
${registry}
};

function normalizeHashRoute() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  return raw.startsWith("/") ? raw : "/" + raw;
}

function findRouteByPath(pathname) {
  return siteStructure.routes.find((route) => route.path === pathname) || siteStructure.routes[0];
}

export default function GeneratedPage() {
  const [activePath, setActivePath] = useState(() => normalizeHashRoute());
  useEffect(() => {
    const onHashChange = () => setActivePath(normalizeHashRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const activeRoute = findRouteByPath(activePath);
  const ActivePage = pageComponents[activeRoute.key] || ${componentNameForRoute(routes[0]?.key || "home")};

  return (
    <main className="generated-page multi-page-site">
      <nav className="nav site-nav">
        <strong>{catalog.brand}</strong>
        <div className="site-nav-links">
          {siteStructure.routes.map((route) => (
            <a key={route.key} className={route.path === activeRoute.path ? "active" : ""} href={"#" + route.path}>
              {route.title}
            </a>
          ))}
        </div>
      </nav>
      <ActivePage />
    </main>
  );
}
`;
}

function cssSource() {
  return `:root {
  color: #142033;
  background: #f6f7fb;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
body { margin: 0; }
a { color: inherit; text-decoration: none; }

.generated-page {
  min-height: 100vh;
  background:
    linear-gradient(130deg, rgba(15, 118, 110, 0.12), transparent 38%),
    linear-gradient(155deg, rgba(37, 99, 235, 0.12), transparent 44%),
    #f6f7fb;
}

.hero {
  min-height: 88vh;
  padding: 28px;
  display: grid;
  grid-template-rows: auto 1fr;
}

.nav {
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
  height: 60px;
  border: 1px solid #d8e1ee;
  border-radius: 8px;
  padding: 0 18px;
  background: rgba(255, 255, 255, 0.88);
  display: flex;
  align-items: center;
  justify-content: space-between;
  backdrop-filter: blur(16px);
}

.nav div { display: flex; gap: 18px; color: #526174; font-size: 14px; }

.hero-grid {
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(320px, 0.92fr);
  gap: 36px;
  align-items: center;
}

.hero-copy span,
.section-intro span,
.materials span,
.workflow span {
  color: #0f766e;
  font-weight: 800;
  text-transform: uppercase;
  font-size: 12px;
  letter-spacing: 0.08em;
}

.hero-copy h1 {
  margin: 14px 0 18px;
  font-size: clamp(44px, 7vw, 82px);
  line-height: 0.96;
  letter-spacing: 0;
}

.hero-copy p {
  max-width: 690px;
  color: #536174;
  font-size: 20px;
  line-height: 1.55;
}

.hero-actions { margin-top: 28px; display: flex; flex-wrap: wrap; gap: 12px; }

.primary,
.secondary {
  min-height: 48px;
  padding: 0 18px;
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  font-weight: 800;
}

.primary { color: #fff; background: #0f766e; box-shadow: 0 16px 32px rgba(15, 118, 110, 0.22); }
.secondary { border: 1px solid #d8e1ee; background: #fff; }

.insight-panel,
.product-card,
.materials,
.workflow {
  border: 1px solid #d8e1ee;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.1);
}

.insight-panel { padding: 24px; }
.insight-panel h2 { margin: 0 0 8px; font-size: 24px; }
.insight-panel p { color: #64748b; margin: 0; line-height: 1.6; }

.panel-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 24px; }
.panel-grid div { border: 1px solid #d8e1ee; border-radius: 8px; background: #fff; padding: 14px; }
.panel-grid strong { display: block; font-size: 26px; }
.panel-grid span { color: #64748b; font-size: 12px; }

.catalog-section {
  max-width: 1180px;
  margin: 0 auto;
  padding: 20px 28px 72px;
}

.section-intro {
  max-width: 760px;
  margin-bottom: 18px;
}

.section-intro h2,
.materials h2,
.workflow h2 {
  margin: 10px 0 0;
  font-size: 32px;
  line-height: 1.15;
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.product-card {
  overflow: hidden;
}

.product-visual {
  min-height: 180px;
  background:
    radial-gradient(circle at 30% 20%, rgba(255,255,255,.75), transparent 28%),
    linear-gradient(135deg, #172033, #0f766e);
  display: flex;
  align-items: flex-end;
  padding: 16px;
  color: #fff;
  font-weight: 800;
}

.product-card div:last-child { padding: 18px; }
.product-card h3 { margin: 0 0 8px; font-size: 22px; }
.product-card strong { color: #0f766e; }
.product-card p { color: #64748b; line-height: 1.55; margin: 10px 0 0; }

.materials,
.workflow {
  max-width: 1124px;
  margin: 0 auto 26px;
  padding: 28px;
  display: grid;
  grid-template-columns: 0.9fr 1.1fr;
  gap: 28px;
}

.materials ul,
.workflow ol {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}

.materials li,
.workflow li {
  min-height: 56px;
  padding: 12px;
  border-radius: 8px;
  background: #f8fafc;
  display: flex;
  align-items: center;
  gap: 12px;
}

.workflow li strong { color: #2563eb; }

.launch {
  max-width: 1180px;
  margin: 0 auto;
  padding: 42px 28px 72px;
  text-align: center;
}

.launch h2 { margin: 0 0 10px; font-size: 42px; }
.launch p { margin: 0 auto; max-width: 620px; color: #64748b; line-height: 1.6; }

.multi-page-site {
  min-height: 100vh;
  padding: 28px;
}

.site-nav {
  position: sticky;
  top: 18px;
  z-index: 10;
}

.site-nav-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

.site-nav-links a {
  padding: 8px 10px;
  border-radius: 8px;
  color: #526174;
}

.site-nav-links a.active {
  color: #0f766e;
  background: #ecfdf5;
}

.site-page {
  max-width: 1180px;
  min-height: calc(100vh - 120px);
  margin: 28px auto 0;
  padding: 56px 0 72px;
}

.route-home {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
  align-items: center;
  gap: 32px;
}

.route-hero-copy span,
.route-card span {
  color: #0f766e;
  font-weight: 800;
  text-transform: uppercase;
  font-size: 12px;
  letter-spacing: 0.08em;
}

.route-hero-copy h1,
.site-page .section-intro h1 {
  margin: 14px 0 18px;
  font-size: clamp(38px, 6vw, 72px);
  line-height: 0.98;
}

.route-hero-copy p,
.site-page .section-intro p {
  max-width: 760px;
  color: #536174;
  font-size: 19px;
  line-height: 1.55;
}

.route-grid,
.route-panel-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 24px;
}

.route-card,
.metric-card {
  border: 1px solid #d8e1ee;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
  padding: 22px;
}

.route-card strong,
.metric-card strong {
  display: block;
  color: #0f766e;
  font-size: 30px;
}

.route-card h3 {
  margin: 12px 0 10px;
  font-size: 23px;
}

.route-card p,
.metric-card span {
  color: #64748b;
  line-height: 1.55;
}

.route-product-grid,
.route-materials,
.route-launch {
  margin-top: 24px;
}

@media (max-width: 900px) {
  .hero-grid,
  .materials,
  .workflow,
  .product-grid,
  .route-home,
  .route-grid,
  .route-panel-grid {
    grid-template-columns: 1fr;
  }

  .hero { padding: 16px; }
  .nav div { display: none; }
}
`;
}

function readmeSource(request, operations) {
  return `# Generated App

This app was generated by PlutoniX through the Codex workflow file-operation runtime.

## Orchestrator Objective

${request.objective}

## Site Structure

- Structure: ${request.siteStructure || "single_page"}
- Route plan: ${(request.routePlan || []).length ? (request.routePlan || []).map((route) => `${route.title} (${route.path})`).join(", ") : "single-page surface"}

## File Operations

${operations.map((operation) => `- ${operation.action}: \`${operation.path}\` - ${operation.reason}`).join("\n")}
`;
}

function buildOperations(request, buildId, instructionHash) {
  const model = buildCommerceModel(request);
  const operations = request.fileOperations || [];
  const routes = resolveRoutes(request);
  const multiPage = isMultiPageRequest(request, routes);
  const contentByPath = new Map([
    ["src/generated/generatedPage.jsx", multiPage ? multiPageSource(instructionHash, routes) : pageSource(instructionHash)],
    ["src/generated/generatedPage.css", cssSource()],
    ["src/generated/catalogData.js", catalogDataSource(model)],
    [
      "src/generated/metadata.json",
      JSON.stringify(
        {
          buildId,
          instructionHash,
          generatedAt: new Date().toISOString(),
          title: model.brand,
          orchestrated: {
            pageType: request.pageType,
            topic: request.topic,
            sections: request.sections,
            siteStructure: request.siteStructure || "single_page",
            routePlan: routes,
            complexityScaling: request.complexityScaling || null
          },
          fileOperations: operations
        },
        null,
        2
      )
    ],
    ["src/generated/README.generated.md", readmeSource({ ...request, routePlan: routes }, operations)]
  ]);

  if (multiPage) {
    contentByPath.set("src/generated/siteStructure.js", siteStructureSource(request, routes));
    for (const route of routes) {
      contentByPath.set(`src/generated/pages/${componentNameForRoute(route.key)}.jsx`, pageModuleSource(route));
    }
  }

  const priorityByPath = new Map([
    ["src/generated/catalogData.js", 1],
    ["src/generated/siteStructure.js", 2],
    ["src/generated/metadata.json", 3],
    ["src/generated/README.generated.md", 4],
    ["src/generated/generatedPage.jsx", 20],
    ["src/generated/generatedPage.css", 30],
    ["src/generated/deprecatedGeneratedPage.jsx", 90]
  ]);

  return operations
    .map((operation, index) => ({
      ...operation,
      index,
      absolutePath: path.join(generatedDir, operation.path),
      content: contentByPath.get(operation.path) || ""
    }))
    .sort((a, b) => {
      const aPriority = priorityByPath.get(a.path) || (a.path.startsWith("src/generated/pages/") ? 10 : 50);
      const bPriority = priorityByPath.get(b.path) || (b.path.startsWith("src/generated/pages/") ? 10 : 50);
      return aPriority - bPriority || a.index - b.index;
    });
}

async function applyOperation(operation) {
  const existedBefore = await fs.pathExists(operation.absolutePath);
  if (operation.action === "delete") {
    await fs.remove(operation.absolutePath);
    return { existedBefore, bytesWritten: 0 };
  }
  await fs.ensureDir(path.dirname(operation.absolutePath));
  await fs.writeFile(operation.absolutePath, operation.content);
  return { existedBefore, bytesWritten: Buffer.byteLength(operation.content || "", "utf8") };
}

export async function generateWebpage(orchestratedRequest, options = {}) {
  if (options.explicitDemoMode !== true) {
    throw new Error(
      "The legacy template generator is disabled because it contains synthetic website data. Use the Product Shape workflow with real data, explicit placeholders, or an explicitly isolated demo mode."
    );
  }
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const request =
    typeof orchestratedRequest === "string"
      ? {
          sourceInstruction: orchestratedRequest,
          objective: orchestratedRequest,
          topic: "digital product",
          pageType: "professional_landing_page",
          sections: ["hero", "proof", "workflow", "cta"],
          fileOperations: [
            { action: "modify", path: "src/generated/generatedPage.jsx", reason: "Render generated page." },
            { action: "modify", path: "src/generated/generatedPage.css", reason: "Style generated page." },
            { action: "add", path: "src/generated/catalogData.js", reason: "Store generated data." },
            { action: "modify", path: "src/generated/metadata.json", reason: "Record metadata." },
            { action: "delete", path: "src/generated/deprecatedGeneratedPage.jsx", reason: "Remove obsolete file." }
          ]
        }
      : orchestratedRequest;

  const sourceInstruction = cleanInstruction(request.sourceInstruction || request.objective);
  const instructionHash = crypto.createHash("sha256").update(sourceInstruction).digest("hex");
  const buildId = `build_${nanoid(10)}`;
  emit("build-start", `Build ${buildId} started for ${request.pageType}`, {
    buildId,
    pageType: request.pageType,
    topic: request.topic,
    instructionHash
  });
  emit("workspace-resolved", `Generated app workspace resolved: ${generatedSourceDir}`, {
    buildId,
    generatedSourceDir
  });
  await fs.ensureDir(generatedSourceDir);

  const operations = buildOperations(request, buildId, instructionHash);
  emit("operation-plan", `Preparing ${operations.length} generated-site file operations in dependency-safe order`, {
    buildId,
    operations: operations.map(({ action, path: filePath, reason }) => ({ action, path: filePath, reason }))
  });
  for (const operation of operations) {
    emit("file-operation-start", `${operation.action.toUpperCase()} ${operation.path}`, {
      buildId,
      action: operation.action,
      path: operation.path,
      reason: operation.reason
    });
    const operationResult = await applyOperation(operation);
    const detail =
      operation.action === "delete"
        ? operationResult.existedBefore
          ? "removed existing file"
          : "file was already absent"
        : `${operationResult.existedBefore ? "updated" : "created"} ${operationResult.bytesWritten} bytes`;
    emit("file-operation-done", `${operation.action.toUpperCase()} ${operation.path} complete: ${detail}`, {
      buildId,
      action: operation.action,
      path: operation.path,
      existedBefore: operationResult.existedBefore,
      bytesWritten: operationResult.bytesWritten
    });
  }
  emit("codegen-complete", `Build ${buildId} wrote ${operations.filter((operation) => operation.action !== "delete").length} active files`, {
    buildId,
    files: operations.filter((operation) => operation.action !== "delete").map((operation) => operation.path)
  });

  return {
    buildId,
    title: buildCommerceModel(request).brand,
    instructionHash,
    generatedAt: new Date().toISOString(),
    files: operations.filter((operation) => operation.action !== "delete").map((operation) => operation.path),
    fileOperations: operations.map(({ action, path: filePath, reason }) => ({ action, path: filePath, reason }))
  };
}
