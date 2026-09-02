import crypto from "node:crypto";
import { classifyProductShape, productShapePrompt } from "./productShape.js";

const defaultSections = ["hero", "proof", "workflow", "cta"];
const knownTones = ["premium", "professional", "minimal", "enterprise", "playful", "bold", "calm"];
const knownAudiences = ["founders", "executives", "operators", "developers", "finance teams", "sales teams", "customers"];
const multiPageSignals = [
  "platform",
  "projects",
  "project showcase",
  "services",
  "service business",
  "agency",
  "company website",
  "business website",
  "saas",
  "portal",
  "marketplace",
  "ecommerce",
  "shop",
  "store",
  "dashboard",
  "admin",
  "case studies",
  "pricing",
  "docs",
  "blog",
  "contact page"
];
const singlePageSignals = [
  "portfolio",
  "resume",
  "cv",
  "banner",
  "poster",
  "flyer",
  "advertisement",
  "ad display",
  "simple ad",
  "coming soon",
  "link in bio",
  "one page",
  "single page",
  "landing page only"
];

function compactText(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

function findMatches(text, options) {
  const lower = text.toLowerCase();
  return options.filter((option) => lower.includes(option));
}

function inferPageType(text, productDecision) {
  const lower = text.toLowerCase();
  const artifactType = productDecision?.artifactType;
  if (artifactType === "mobile_application") return "mobile_application";
  if (artifactType === "api_service") return "api_service";
  if (artifactType === "automation") return "automation";
  if (artifactType === "data_workflow") return "data_workflow";
  if (artifactType === "infrastructure") return "infrastructure";
  if (["document", "presentation", "image", "video", "audio"].includes(artifactType)) return `${artifactType}_artifact`;
  if (lower.includes("platform")) return "platform_website";
  if (lower.includes("services") || lower.includes("service business") || lower.includes("agency")) return "services_website";
  if (lower.includes("projects") || lower.includes("case stud")) return "project_showcase_website";
  if (hasAnySignal(lower, ["shop", "store", "bag", "bags", "handbag", "luggage", "ecommerce", "commerce"])) return "commerce_website";
  if (lower.includes("dashboard") || lower.includes("admin") || lower.includes("portal")) return "dashboard_website";
  if (lower.includes("pricing")) return "pricing_page";
  if (lower.includes("portfolio")) return "portfolio_page";
  if (lower.includes("saas")) return "saas_website";
  if (lower.includes("product")) return "product_landing_page";
  return "professional_landing_page";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function includesSignal(lower, signal) {
  if (signal.includes(" ")) return lower.includes(signal);
  return new RegExp(`\\b${escapeRegExp(signal)}\\b`).test(lower);
}

function hasAnySignal(lower, signals) {
  return signals.some((signal) => includesSignal(lower, signal));
}

function inferSiteScale(text, pageType, sections, productDecision) {
  if (!["website", "web_application"].includes(productDecision?.artifactType)) {
    return {
      siteStructure: "not_applicable",
      complexityScore: productDecision?.complexity?.score || 0,
      decisionBias: "product_shape_first",
      decisionReason: "Route topology does not apply to the selected primary artifact type."
    };
  }
  const lower = text.toLowerCase();
  const strongMultiPage =
    lower.includes("platform") ||
    lower.includes("projects") ||
    lower.includes("services") ||
    lower.includes("service business") ||
    lower.includes("saas") ||
    lower.includes("portal") ||
    lower.includes("marketplace") ||
    lower.includes("admin") ||
    lower.includes("dashboard") ||
    lower.includes("ecommerce") ||
    lower.includes("case stud");
  const explicitSinglePage = lower.includes("single page") || lower.includes("one page") || lower.includes("landing page only");
  const simpleSurface = hasAnySignal(lower, singlePageSignals);
  let complexityScore = 0;
  if (hasAnySignal(lower, multiPageSignals)) complexityScore += 2;
  if (strongMultiPage) complexityScore += 3;
  if ((sections || []).length >= 5) complexityScore += 1;
  if (/website|web app|application|system|workflow|booking|login|auth|account|checkout|catalog|crm|erp/i.test(text)) complexityScore += 1;
  if (/platform|website|dashboard|commerce|saas|services|project_showcase/.test(pageType)) complexityScore += 1;
  if (simpleSurface) complexityScore -= 2;
  if (pageType === "portfolio_page") complexityScore -= 1;
  if (explicitSinglePage && !strongMultiPage) complexityScore -= 3;

  const operationalShape = ["production_application", "deep_complex_platform"].includes(productDecision?.productShape);
  const siteStructure = strongMultiPage || operationalShape || complexityScore >= 2 ? "multi_page" : "single_page";
  return {
    siteStructure,
    complexityScore,
    decisionBias: "choose_routes_only_for_distinct_user_goals",
    decisionReason:
      siteStructure === "multi_page"
        ? "The request has platform/project/service/application signals or enough scope complexity to justify routes."
        : "The request is a simple self-contained surface such as a portfolio, banner, advertisement, or compact landing page."
  };
}

function addRoute(routes, key, path, title, description, sections = []) {
  if (routes.some((route) => route.key === key || route.path === path)) return;
  routes.push({ key, path, title, description, sections });
}

function inferRoutePlan(text, pageType, sections, siteStructure) {
  if (siteStructure !== "multi_page") return [];
  const lower = text.toLowerCase();
  const routes = [];
  addRoute(routes, "home", "/", "Home", "Primary positioning, proof, and conversion entry point.", ["hero", "proof", "cta"]);

  if (lower.includes("platform") || lower.includes("saas") || lower.includes("product") || pageType.includes("platform") || pageType.includes("saas")) {
    addRoute(routes, "features", "/features", "Features", "Product capabilities, modules, and user outcomes.", ["features", "workflow", "metrics"]);
  }
  if (lower.includes("services") || lower.includes("service business") || lower.includes("agency") || pageType.includes("services")) {
    addRoute(routes, "services", "/services", "Services", "Service packages, delivery model, and engagement options.", ["services", "workflow", "proof"]);
  }
  if (lower.includes("projects") || lower.includes("case stud") || pageType.includes("project_showcase")) {
    addRoute(routes, "projects", "/projects", "Projects", "Project portfolio, case studies, and measurable outcomes.", ["projects", "case-studies", "metrics"]);
  }
  if (hasAnySignal(lower, ["shop", "store", "catalog", "ecommerce", "commerce", "bag", "bags", "handbag", "luggage"]) || pageType.includes("commerce")) {
    addRoute(routes, "catalog", "/catalog", "Catalog", "Product catalog, merchandising, materials, and buying path.", ["catalog", "materials", "checkout"]);
  }
  if (lower.includes("dashboard") || lower.includes("admin") || lower.includes("portal") || pageType.includes("dashboard")) {
    addRoute(routes, "dashboard", "/dashboard", "Dashboard", "Operational panels, metrics, states, and workflow visibility.", ["metrics", "workflow", "states"]);
  }
  if (lower.includes("pricing") || (sections || []).includes("pricing")) {
    addRoute(routes, "pricing", "/pricing", "Pricing", "Plans, comparison, offer framing, and conversion CTAs.", ["pricing", "faq", "cta"]);
  }

  addRoute(routes, "about", "/about", "About", "Brand story, credibility, operating principles, and trust cues.", ["story", "team", "trust"]);
  addRoute(routes, "contact", "/contact", "Contact", "Lead capture, contact methods, and next-step CTA.", ["form", "cta", "faq"]);

  if (routes.length < 4) {
    addRoute(routes, "services", "/services", "Services", "Service and capability details.", ["services", "workflow"]);
    addRoute(routes, "projects", "/projects", "Projects", "Project examples and proof.", ["projects", "proof"]);
  }
  return routes;
}

function inferTopic(text) {
  const lower = text.toLowerCase();
  const candidates = [
    "finance",
    "bag",
    "bags",
    "handbag",
    "luggage",
    "treasury",
    "compliance",
    "analytics",
    "automation",
    "agentic",
    "builder",
    "operations",
    "developer",
    "sales",
    "support"
  ];
  return candidates.find((candidate) => lower.includes(candidate)) || "digital product";
}

function inferSections(text, productDecision) {
  const lower = text.toLowerCase();
  const shapeDefaults = {
    artifact_only: ["artifact"],
    focused_task_tool: ["primary-task", "result-state"],
    app_shaped_page: productDecision?.artifactType === "website"
      ? ["primary-content", "proof", "conversion"]
      : ["primary-workflow", "result-state"],
    production_application: ["primary-workflow", "data-states", "settings"],
    deep_complex_platform: ["workspace", "roles", "workflows", "administration"],
    service_or_automation: ["entrypoint", "validation", "error-behavior"],
    existing_product_change: ["direct-task"]
  };
  const sections = new Set(shapeDefaults[productDecision?.productShape] || defaultSections);
  if (lower.includes("pricing")) sections.add("pricing");
  if (lower.includes("testimonial") || lower.includes("customer")) sections.add("testimonials");
  if (lower.includes("feature")) sections.add("features");
  if (lower.includes("kpi") || lower.includes("metric")) sections.add("metrics");
  if (lower.includes("faq")) sections.add("faq");
  if (hasAnySignal(lower, ["bag", "bags", "handbag", "luggage", "shop", "store", "ecommerce", "commerce"])) {
    sections.add("catalog");
    sections.add("materials");
  }
  return Array.from(sections);
}

function normalizeTaskType(taskType) {
  const normalized = String(taskType || "Medium").trim().toLowerCase();
  if (normalized === "simple" || normalized === "small") return "Simple";
  if (normalized === "hard" || normalized === "large" || normalized === "complex") return "Hard";
  return "Medium";
}

export function inferGothamRequestIntent({ instruction = "", workflowMode, taskType } = {}) {
  const explicitWorkflowMode = Boolean(workflowMode);
  const explicitTaskType = Boolean(taskType);
  const text = String(instruction || "");
  const compact = text.replace(/\s+/g, " ").trim();
  const bugVerb = /\b(bug|fix|debug|error|failing|failed|broken|crash|exception|trace|stack|regression|not working|doesn't work|does not work)\b/i.test(compact);
  const pastedError =
    /Failed to load resource|Internal Server Error|Not Found|Malformed response|Provider returned|Encountered two children with the same key/i.test(text) ||
    /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|AxiosError|FetchError|ZodError|PrismaClient|UnhandledPromiseRejection)\b/.test(text) ||
    /\b(?:4\d\d|5\d\d)\b.*\b(?:GET|POST|PUT|PATCH|DELETE|api|resource|server|error|failed)\b/i.test(compact) ||
    /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\S+\s+(?:4\d\d|5\d\d)\b/i.test(compact) ||
    /(?:^|\n)\s+at\s+[\w.$<>]+\s*\(.+:\d+:\d+\)/.test(text) ||
    /\b(?:npm|pnpm|yarn|vite|webpack|rollup|tsc|eslint)\b.*\b(?:ERR|error|failed|Cannot|Unable)\b/i.test(compact);

  const inferredBugFix = pastedError || bugVerb;
  return {
    workflowMode: normalizeGothamWorkflowMode(explicitWorkflowMode ? workflowMode : inferredBugFix ? "debugger" : "executor"),
    taskType: explicitTaskType ? taskType : "Auto",
    inferredBugFix,
    reason: pastedError ? "pasted-error" : bugVerb ? "bug-fix-language" : explicitTaskType ? "explicit" : "auto-default"
  };
}

function normalizeGothamWorkflowMode(value = "executor") {
  const mode = String(value || "executor").trim().toLowerCase();
  return ["planner", "debugger", "executor"].includes(mode) ? mode : "executor";
}

export function formatProjectOrchestratorInstruction(instruction, taskType = "Medium") {
  const sourceInstruction = compactText(instruction);
  return [`Task type: ${normalizeTaskType(taskType)}`, "Gotham mode: executor", `task : ${sourceInstruction}`].join("\n");
}

export function formatGothamModeInstruction(instruction, taskType = "Medium", workflowMode = "executor") {
  const sourceInstruction = compactText(instruction);
  const mode = String(workflowMode || "executor").trim().toLowerCase();
  const normalizedMode = ["planner", "debugger", "executor"].includes(mode) ? mode : "executor";
  const contracts = {
    planner: "Plan only. Suggest approach, risks, affected files, validation path and next execution instruction. Do not modify files.",
    debugger: "Debugging mode. Reproduce or inspect the reported issue, identify likely root cause, apply the smallest fix only when evidence supports it, and validate.",
    executor: "Execution mode. Implement the requested coding change, update required files, validate, and report evidence."
  };
  return [
    `Task type: ${normalizeTaskType(taskType)}`,
    `Gotham mode: ${normalizedMode}`,
    `Mode contract: ${contracts[normalizedMode]}`,
    `task : ${sourceInstruction}`
  ].join("\n");
}

function toPageComponentName(routeKey) {
  return `${String(routeKey || "page")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("")}Page`;
}

function buildFileOperationPlan(structuredRequest) {
  const productDecision = structuredRequest.productDecision || {};
  if (productDecision.productShape === "artifact_only") {
    return [
      {
        action: "add",
        path: productDecision.primaryOutputPaths?.[0] || "deliverables/",
        reason: `Create the requested ${productDecision.artifactType || "artifact"} as the primary deliverable.`
      },
      {
        action: "modify",
        path: "src/generated/metadata.json",
        reason: "Record the Product Shape Contract, source provenance, artifact path, and validation status."
      }
    ];
  }
  if (productDecision.productShape === "service_or_automation") {
    return [
      {
        action: "add",
        path: productDecision.primaryOutputPaths?.[0] || "src/",
        reason: `Create the runnable ${productDecision.artifactType || "service"} entrypoint or contract.`
      },
      {
        action: "add",
        path: "tests/",
        reason: "Validate inputs, outputs, and failure behavior for the executable or service."
      },
      {
        action: "modify",
        path: "src/generated/metadata.json",
        reason: "Record the Product Shape Contract, runtime entrypoint, and validation status."
      }
    ];
  }

  const operations = [
    {
      action: "modify",
      path: "src/generated/generatedPage.jsx",
      reason:
        structuredRequest.siteStructure === "multi_page"
          ? `Render the ${structuredRequest.pageType} route shell around distinct user goals.`
          : `Render the primary ${structuredRequest.pageType} workflow or content surface.`
    },
    {
      action: "modify",
      path: "src/generated/generatedPage.css",
      reason: "Apply generated responsive visual styling."
    },
    {
      action: "add",
      path: "src/generated/dataSource.js",
      reason: "Define real-data adapters, user-provided content, and explicit empty/loading/error states separately from UI."
    }
  ];

  if (structuredRequest.siteStructure === "multi_page") {
    operations.push({
      action: "add",
      path: "src/generated/siteStructure.js",
      reason: "Store the route plan and site-complexity decision separately from page components."
    });
    for (const route of structuredRequest.routePlan || []) {
      operations.push({
        action: "add",
        path: `src/generated/pages/${toPageComponentName(route.key)}.jsx`,
        reason: `Create the ${route.title} route/page required by the multi-page site plan.`
      });
    }
  }

  operations.push(
    {
      action: "add",
      path: "src/generated/README.generated.md",
      reason: "Document the generated app handoff and latest orchestrator plan."
    },
    {
      action: "modify",
      path: "src/generated/metadata.json",
      reason: "Record build metadata and orchestrator handoff details."
    }
  );

  return operations;
}

export function orchestrateBuilderInstruction(rawInstruction) {
  const sourceInstruction = compactText(rawInstruction);
  const productDecision = classifyProductShape({ instruction: sourceInstruction });
  const tone = findMatches(sourceInstruction, knownTones);
  const audience = findMatches(sourceInstruction, knownAudiences);
  const topic = inferTopic(sourceInstruction);
  const pageType = inferPageType(sourceInstruction, productDecision);
  const sections = inferSections(sourceInstruction, productDecision);
  const complexityScaling = inferSiteScale(sourceInstruction, pageType, sections, productDecision);
  const routePlan = inferRoutePlan(sourceInstruction, pageType, sections, complexityScaling.siteStructure);
  const instructionHash = crypto.createHash("sha256").update(sourceInstruction).digest("hex");

  const structuredRequest = {
    orchestrator: "plutomix-fullstack-agent",
    instructionHash,
    sourceInstruction,
    objective: `Create the requested ${productDecision.artifactType.replaceAll("_", " ")} for ${topic} as a ${productDecision.productShape.replaceAll("_", " ")}.`,
    pageType,
    productDecision,
    topic,
    audience: audience.length ? audience : ["professional users"],
    tone: tone.length ? tone : ["professional", "premium"],
    sections,
    siteStructure: complexityScaling.siteStructure,
    routePlan,
    complexityScaling,
    constraints: [
      "Apply the binding Product Shape Contract before selecting stack, routes, UI composition, agents, or output paths.",
      "Choose the smallest product shape that completely satisfies the objective; do not increase depth to make the result appear more substantial.",
      "Do not force documents, media, APIs, automations, scripts, data workflows, or infrastructure into a decorative web application.",
      "For visual applications, organize routes around distinct user goals and operational boundaries rather than generic Home, Features, About, and Contact defaults.",
      "Make the primary task or artifact the first viewport signal. Do not use a marketing hero as the default shell for operational tools.",
      "Vary information architecture, density, interaction patterns, typography, and composition according to the domain instead of reusing a generic dashboard/card/form template.",
      "Use only real integration data, uploaded references, selected UI references, or user-provided content for business records, media details, financials, metrics, profiles, products, orders, messages, and analytics.",
      "When required backend or integration data is unavailable, render explicit empty/loading/placeholder states or TODO configuration hooks instead of invented records.",
      "Do not add visible explanations about how to use the generated app, mobile app, tool, flyer, or media artifact unless the user requested them; keep necessary hints in labels, tooltips, or a compact manual surface.",
      "Avoid unsafe scripts, external tracking, or credential handling.",
      "Write only to task-appropriate paths inside the selected project workspace."
    ],
    handoff: {
      target: "codex.generate_webpage",
      generatedAppContainer: process.env.GENERATED_SITE_CONTAINER || "plutomix-generated-site",
      restartRequired: true
    },
    fileOperations: []
  };

  structuredRequest.fileOperations = buildFileOperationPlan(structuredRequest);

  const codexInstruction = [
    structuredRequest.objective,
    productShapePrompt(productDecision),
    `Audience: ${structuredRequest.audience.join(", ")}.`,
    `Tone: ${structuredRequest.tone.join(", ")}.`,
    `Sections: ${structuredRequest.sections.join(", ")}.`,
    `Site structure: ${structuredRequest.siteStructure}.`,
    structuredRequest.routePlan.length
      ? `Route plan: ${structuredRequest.routePlan.map((route) => `${route.title} ${route.path}`).join(", ")}.`
      : "Route plan: single-page surface.",
    `Original request: ${structuredRequest.sourceInstruction}`
  ].join("\n");

  return {
    structuredRequest,
    codexInstruction
  };
}
