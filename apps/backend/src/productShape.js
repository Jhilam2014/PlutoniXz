const decisionVersion = "1.0";

const artifactDefinitions = [
  {
    type: "spreadsheet",
    patterns: [/spreadsheet/i, /\bexcel\b/i, /\bworkbook\b/i, /\bxlsx?\b/i, /\bcsv table\b/i, /\btable with formulas?\b/i],
    primaryPaths: ["deliverables/", "artifacts/spreadsheets/"],
    extensions: [".xlsx", ".xls", ".csv", ".tsv"]
  },
  {
    type: "flyer",
    patterns: [/\bflyer\b/i, /\bleaflet\b/i, /\bone[- ]sheet\b/i, /\bprint handout\b/i],
    primaryPaths: ["deliverables/", "artifacts/print/"],
    extensions: [".pdf", ".png", ".jpg", ".jpeg"]
  },
  {
    type: "video",
    patterns: [/\bvideo\b/i, /\breel\b/i, /\banimation\b/i, /\bmotion graphic\b/i],
    primaryPaths: ["deliverables/", "artifacts/video/"],
    extensions: [".mp4", ".webm", ".mov"]
  },
  {
    type: "audio",
    patterns: [/\baudio\b/i, /\bpodcast\b/i, /\bvoiceover\b/i, /\bsound(?:track)?\b/i],
    primaryPaths: ["deliverables/", "artifacts/audio/"],
    extensions: [".mp3", ".wav", ".m4a", ".ogg"]
  },
  {
    type: "image",
    patterns: [/\bimage\b/i, /\bposter\b/i, /\bbanner\b/i, /\bthumbnail\b/i, /\blogo\b/i, /\bcreative\b/i],
    primaryPaths: ["deliverables/", "artifacts/images/"],
    extensions: [".png", ".jpg", ".jpeg", ".webp"]
  },
  {
    type: "presentation",
    patterns: [/\bpresentation\b/i, /\bslide deck\b/i, /\bpitch deck\b/i, /\bpowerpoint\b/i, /\bpptx\b/i],
    primaryPaths: ["deliverables/", "artifacts/presentations/"],
    extensions: [".pptx", ".pdf"]
  },
  {
    type: "document",
    patterns: [/\bpdf\b/i, /\bdocument\b/i, /\breport\b/i, /\bbrochure\b/i, /\bproposal\b/i, /\binvoice\b/i],
    primaryPaths: ["deliverables/", "artifacts/documents/"],
    extensions: [".pdf", ".docx", ".html", ".md"]
  }
];

const toolSignals = [
  "tool",
  "editor",
  "builder",
  "generator",
  "analyzer",
  "analyser",
  "calculator",
  "converter",
  "checker",
  "tracker",
  "planner",
  "manager",
  "studio",
  "workspace"
];

const entitySignals = [
  "user",
  "customer",
  "account",
  "profile",
  "product",
  "order",
  "invoice",
  "project",
  "task",
  "message",
  "appointment",
  "booking",
  "investor",
  "proposal",
  "campaign",
  "document",
  "asset",
  "transaction",
  "subscription"
];

const capabilitySignals = [
  ["authentication", /\bauth(?:entication)?\b|\blog[ -]?in\b|\bsign[ -]?in\b/i],
  ["authorization", /\bpermissions?\b|\brbac\b|\baccess control\b|\brole-based\b/i],
  ["persistence", /\bdatabase\b|\bpersist(?:ence|ent)?\b|\bsave\b|\bhistory\b|\brecords?\b|\bstorage\b/i],
  ["search", /\bsearch\b|\bfilter\b|\bquery\b/i],
  ["reporting", /\breport(?:ing)?\b|\banalytics\b|\bmetrics?\b|\bkpi\b/i],
  ["approval", /\bapproval\b|\breview flow\b|\bmoderation\b|\bmaker[- ]checker\b/i],
  ["notifications", /\bnotifications?\b|\bemail\b|\bsms\b|\bpush\b|\binbox\b|\bdirect message\b/i],
  ["import_export", /\bimport\b|\bexport\b|\bdownload\b|\bupload\b|\bcsv\b|\bspreadsheet\b/i],
  ["background_jobs", /\bqueue\b|\bworker\b|\bscheduled?\b|\bcron\b|\bbatch\b|\bbackground\b/i],
  ["real_time", /\breal[- ]?time\b|\blive updates?\b|\bwebsocket\b|\bstream(?:ing)?\b/i],
  ["audit", /\baudit\b|\bcompliance\b|\bactivity log\b|\btraceability\b/i],
  ["administration", /\badmin\b|\bconfiguration\b|\bsettings\b|\bcontrol plane\b/i]
];

function clean(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50000);
}

function includesWord(text, signal) {
  if (signal.includes(" ")) return text.includes(signal);
  return new RegExp(`\\b${signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

function countSignals(text, signals) {
  return signals.filter((signal) => includesWord(text, signal)).length;
}

function matchingCapabilities(text) {
  return capabilitySignals.filter(([, pattern]) => pattern.test(text)).map(([capability]) => capability);
}

function inferArtifactType(text, existingProject) {
  if (existingProject) return { primary: "existing_project", secondary: [] };

  const lower = text.toLowerCase();
  const hasToolIntent = countSignals(lower, toolSignals) > 0;
  const mediaArtifacts = artifactDefinitions.filter((definition) =>
    definition.patterns.some((pattern) => pattern.test(text))
  );
  const mobile = /\bmobile app\b|\bios app\b|\bandroid app\b|\breact native\b|\bflutter\b/i.test(text);
  const api = /\bapi service\b|\bbackend service\b|\bopenapi\b|\bswagger\b|\brest api\b|\bgraphql\b|\bwebhook service\b/i.test(text);
  const automation = /\bautomation\b|\bscript\b|\bcli\b|\bcommand[- ]line\b|\bbot\b|\bscheduled job\b|\bworkflow automation\b/i.test(text);
  const dataWorkflow = /\betl\b|\bdata pipeline\b|\bingestion\b|\bdata processing\b|\bdata transformation\b/i.test(text);
  const infrastructure = /\binfrastructure\b|\bterraform\b|\bkubernetes\b|\bhelm\b|\bci\/cd\b|\bdeployment pipeline\b/i.test(text);
  const webApp = /\bweb app\b|\bweb application\b|\bapplication\b|\bplatform\b|\bportal\b|\bdashboard\b|\bcrm\b|\berp\b|\bmarketplace\b|\becommerce\b|\bsaas\b|\boperational system\b|\bmanagement system\b/i.test(text);
  const website = /\bwebsite\b|\blanding page\b|\bportfolio\b|\bcompany site\b|\bmarketing site\b/i.test(text);

  if (mobile) return { primary: "mobile_application", secondary: mediaArtifacts.map((item) => item.type) };
  if (api) return { primary: "api_service", secondary: mediaArtifacts.map((item) => item.type) };
  if (dataWorkflow) return { primary: "data_workflow", secondary: mediaArtifacts.map((item) => item.type) };
  if (infrastructure) return { primary: "infrastructure", secondary: mediaArtifacts.map((item) => item.type) };
  if (mediaArtifacts.length && !hasToolIntent && !webApp) {
    return {
      primary: mediaArtifacts[0].type,
      secondary: mediaArtifacts.slice(1).map((item) => item.type)
    };
  }
  if (automation && !webApp) return { primary: "automation", secondary: mediaArtifacts.map((item) => item.type) };
  if (hasToolIntent && mediaArtifacts.length) {
    return {
      primary: webApp ? "web_application" : "web_application",
      secondary: mediaArtifacts.map((item) => item.type)
    };
  }
  if (webApp) return { primary: "web_application", secondary: mediaArtifacts.map((item) => item.type) };
  if (hasToolIntent) return { primary: "web_application", secondary: mediaArtifacts.map((item) => item.type) };
  if (website) return { primary: "website", secondary: mediaArtifacts.map((item) => item.type) };
  if (mediaArtifacts.length) {
    return {
      primary: mediaArtifacts[0].type,
      secondary: mediaArtifacts.slice(1).map((item) => item.type)
    };
  }
  if (/\bcomponent\b|\bpage\b|\bfrontend\b|\bui\b|\binterface\b/i.test(text)) {
    return { primary: "web_application", secondary: [] };
  }
  return { primary: "unspecified_digital_output", secondary: [] };
}

function scoreComplexity(text) {
  const lower = text.toLowerCase();
  const capabilities = matchingCapabilities(text);
  const entityCount = Math.min(4, countSignals(lower, entitySignals));
  const roleCount = /\bmultiple roles?\b|\brole-based\b|\brbac\b|\badmin(?:istrator)? and\b|\bbuyer and seller\b|\bclient and\b/i.test(text)
    ? 2
    : /\badmin\b|\boperator\b|\bmanager\b|\bapprover\b|\bcustomer\b|\bmember\b/i.test(text)
      ? 1
      : 0;
  const workflow = /\bmulti[- ]step\b|\bworkflow\b|\bstages?\b|\bpipeline\b|\bapproval\b|\breview\b|\bonboarding\b|\bcheckout\b/i.test(text)
    ? 2
    : /\bcreate\b.*\bedit\b|\bsubmit\b|\bprocess\b|\bmanage\b/i.test(text)
      ? 1
      : 0;
  const persistence = capabilities.includes("persistence") ? 2 : 0;
  const integrationCount = Math.min(
    3,
    (text.match(/\bapi\b|\bintegration\b|\bwebhook\b|\bstripe\b|\bsalesforce\b|\bgoogle\b|\bslack\b|\bapify\b|\bexternal service\b/gi) || []).length
  );
  const governance = Math.min(
    3,
    ["authentication", "authorization", "approval", "audit", "administration"].filter((item) => capabilities.includes(item)).length
  );
  const background = Math.min(2, ["background_jobs", "real_time", "notifications"].filter((item) => capabilities.includes(item)).length);
  const scale = /\bmulti[- ]tenant\b|\benterprise\b|\borganization(?:s)?\b|\bteam workspace\b|\bhigh availability\b|\bscalable platform\b/i.test(text)
    ? 2
    : /\bteam\b|\bshared workspace\b|\bmultiple users\b/i.test(text)
      ? 1
      : 0;
  const surface = /\bmulti[- ]page\b|\bmultiple routes?\b|\bnavigation\b|\badmin console\b|\bportal\b/i.test(text) ? 1 : 0;
  const risk = /\bfinancial\b|\bpayment\b|\bhealth\b|\bmedical\b|\bsecurity\b|\bcompliance\b|\bpii\b|\bproduction\b/i.test(text) ? 1 : 0;
  const score = entityCount + roleCount + workflow + persistence + integrationCount + governance + background + scale + surface + risk;

  return {
    score,
    dimensions: {
      entities: entityCount,
      roles: roleCount,
      workflow,
      persistence,
      integrations: integrationCount,
      governance,
      background,
      scale,
      surface,
      risk
    },
    capabilities
  };
}

function productShapeFor({ text, artifactType, complexity, existingProject }) {
  if (existingProject) return "existing_product_change";
  if (artifactDefinitions.some((definition) => definition.type === artifactType)) return "artifact_only";
  if (["api_service", "automation", "data_workflow", "infrastructure"].includes(artifactType)) {
    return "service_or_automation";
  }

  const lower = text.toLowerCase();
  const explicitPrototype = /\bprototype\b|\bmockup\b|\bui[- ]only\b|\bconcept\b|\bclickable demo\b/i.test(text);
  const explicitPlatform = /\bdeep platform\b|\bmulti[- ]tenant\b|\boperating system\b|\bmarketplace platform\b/i.test(text);
  const taskTool = countSignals(lower, toolSignals) > 0;
  const operationalCore =
    complexity.dimensions.persistence > 0 ||
    complexity.dimensions.roles > 0 ||
    complexity.dimensions.integrations > 0 ||
    complexity.dimensions.workflow > 1 ||
    complexity.dimensions.governance > 0;

  if (
    explicitPlatform ||
    (complexity.score >= 12 &&
      complexity.dimensions.scale > 0 &&
      complexity.dimensions.persistence > 0 &&
      complexity.dimensions.workflow > 0)
  ) {
    return "deep_complex_platform";
  }
  if (!explicitPrototype && (complexity.score >= 6 || operationalCore)) return "production_application";
  if (taskTool) return "focused_task_tool";
  return "app_shaped_page";
}

function interactionModelFor({ text, artifactType, productShape, complexity }) {
  if (productShape === "existing_product_change") return "preserve_existing";
  if (productShape === "artifact_only") {
    if (["video", "audio"].includes(artifactType)) return "media_artifact";
    if (artifactType === "spreadsheet") return "workbook_artifact";
    if (artifactType === "presentation") return "presentation_artifact";
    if (artifactType === "document") return "document_artifact";
    if (artifactType === "flyer") return "print_artifact";
    return "artifact_canvas";
  }
  if (artifactType === "api_service") return "service_contract";
  if (["automation", "data_workflow", "infrastructure"].includes(artifactType)) return "automation_package";
  if (artifactType === "mobile_application") return "mobile_flow";
  if (productShape === "deep_complex_platform") return "multi_surface_platform";
  if (/\bchat\b|\bconversation\b|\bagent workspace\b|\binbox\b|\bdirect message\b/i.test(text)) return "conversation_workspace";
  if (/\bcheckout\b|\bbooking\b|\bonboarding\b|\bapplication flow\b|\bapproval flow\b|\btransaction\b/i.test(text)) return "transactional_flow";
  if (/\bcommerce\b|\becommerce\b|\bmarketplace\b|\bcatalog\b|\bshop\b|\bstore\b/i.test(text)) return "browse_detail_transaction";
  if (
    /\bmonitor\b|\btriage\b|\bcompare\b|\bobservability\b|\breal[- ]?time status\b/i.test(text) &&
    complexity.requiredCapabilities?.includes?.("reporting")
  ) {
    return "monitoring_dashboard";
  }
  if (/\bcrm\b|\brecord management\b|\badmin\b|\binventory\b|\bprofiles?\b|\bcase management\b/i.test(text)) return "record_workspace";
  if (artifactType === "website") return "content_site";
  if (productShape === "focused_task_tool") return "focused_tool";
  return "workflow_application";
}

function presentationContract(interactionModel) {
  const contracts = {
    artifact_canvas: {
      informationDensity: "artifact-led",
      navigationModel: "none",
      spatialModel: "canvas_or_page",
      componentFamily: "artifact_controls"
    },
    media_artifact: {
      informationDensity: "sparse",
      navigationModel: "none",
      spatialModel: "player_and_source_state",
      componentFamily: "media_controls"
    },
    workbook_artifact: {
      informationDensity: "dense",
      navigationModel: "sheet_tabs",
      spatialModel: "formula_bar_and_grid",
      componentFamily: "workbook_cells_formulas_tables"
    },
    document_artifact: {
      informationDensity: "editorial",
      navigationModel: "pages_and_sections",
      spatialModel: "paginated_document",
      componentFamily: "document_pages_headings_tables"
    },
    presentation_artifact: {
      informationDensity: "slide_dependent",
      navigationModel: "slide_strip",
      spatialModel: "stage_and_slide_notes",
      componentFamily: "slides_media_speaker_content"
    },
    print_artifact: {
      informationDensity: "composed",
      navigationModel: "none",
      spatialModel: "print_canvas",
      componentFamily: "print_typography_images_bleed"
    },
    automation_package: {
      informationDensity: "dense",
      navigationModel: "entrypoint_and_outputs",
      spatialModel: "configuration_run_result",
      componentFamily: "configuration_and_logs"
    },
    service_contract: {
      informationDensity: "dense",
      navigationModel: "resources_and_endpoints",
      spatialModel: "contract_reference",
      componentFamily: "schemas_routes_examples"
    },
    focused_tool: {
      informationDensity: "balanced",
      navigationModel: "none_or_history",
      spatialModel: "input_work_result",
      componentFamily: "task_controls"
    },
    record_workspace: {
      informationDensity: "dense",
      navigationModel: "domain_entities",
      spatialModel: "list_detail_or_table_inspector",
      componentFamily: "records_filters_bulk_actions"
    },
    monitoring_dashboard: {
      informationDensity: "dense",
      navigationModel: "monitoring_scopes",
      spatialModel: "signals_trends_exceptions",
      componentFamily: "charts_status_tables"
    },
    transactional_flow: {
      informationDensity: "balanced",
      navigationModel: "step_state",
      spatialModel: "progressive_transaction",
      componentFamily: "forms_validation_confirmation"
    },
    browse_detail_transaction: {
      informationDensity: "balanced",
      navigationModel: "browse_detail_selection",
      spatialModel: "catalog_detail_transaction",
      componentFamily: "filters_items_detail_cart"
    },
    mobile_flow: {
      informationDensity: "task_dependent",
      navigationModel: "peer_destinations_only",
      spatialModel: "mobile_task_screens",
      componentFamily: "native_or_mobile_controls"
    },
    content_site: {
      informationDensity: "sparse_to_balanced",
      navigationModel: "content_goals",
      spatialModel: "editorial_hierarchy",
      componentFamily: "content_media_calls_to_action"
    },
    multi_surface_platform: {
      informationDensity: "role_dependent",
      navigationModel: "roles_domains_workflows",
      spatialModel: "workspace_and_detail_surfaces",
      componentFamily: "domain_specific_modules"
    },
    conversation_workspace: {
      informationDensity: "balanced",
      navigationModel: "threads_and_artifacts",
      spatialModel: "conversation_artifact_approval",
      componentFamily: "messages_artifacts_execution_states"
    },
    workflow_application: {
      informationDensity: "balanced",
      navigationModel: "user_goals",
      spatialModel: "workflow_and_state",
      componentFamily: "domain_specific_controls"
    },
    preserve_existing: {
      informationDensity: "preserve",
      navigationModel: "preserve",
      spatialModel: "preserve",
      componentFamily: "preserve"
    }
  };
  return contracts[interactionModel] || contracts.workflow_application;
}

function shapeContract(shape, artifactType, complexity) {
  const commonProhibitions = [
    "unrequested visible how-to or feature explanation",
    "invented business, profile, financial, product, or metric data",
    "generic sections added only to make the output look larger"
  ];
  const contracts = {
    artifact_only: {
      generationDepth: "artifact",
      surfaceStrategy: "artifact_canvas",
      primaryPaths:
        artifactDefinitions.find((definition) => definition.type === artifactType)?.primaryPaths || ["deliverables/"],
      requiredSurfaces: ["the requested final artifact"],
      optionalSurfaces: ["a minimal preview or download surface only when it helps inspect the artifact"],
      prohibitedDefaults: ["dashboard shell", "marketing navigation", "feature cards", ...commonProhibitions]
    },
    focused_task_tool: {
      generationDepth: "focused",
      surfaceStrategy: "task_first_workspace",
      primaryPaths: ["src/generated/"],
      requiredSurfaces: ["primary input", "primary action", "result", "loading, empty, and error states"],
      optionalSurfaces: ["history or settings only when implied by persistence"],
      prohibitedDefaults: ["oversized marketing hero", "unrelated KPI dashboard", "generic feature grid", ...commonProhibitions]
    },
    app_shaped_page: {
      generationDepth: "shaped",
      surfaceStrategy: artifactType === "website" ? "content_first_page" : "primary_flow_page",
      primaryPaths: ["src/generated/"],
      requiredSurfaces: ["the main user goal", "responsive states", "only directly relevant content or controls"],
      optionalSurfaces: ["additional routes only when distinct user goals require them"],
      prohibitedDefaults: ["admin console", "fake analytics", "generic SaaS modules", ...commonProhibitions]
    },
    production_application: {
      generationDepth: "production",
      surfaceStrategy: "workflow_first_application",
      primaryPaths: ["src/", "backend/", "database/", "tests/"],
      requiredSurfaces: ["complete core workflow", "real data boundaries", "persistence and failure states when required"],
      optionalSurfaces: ["settings, administration, and reporting only when justified by roles or operations"],
      prohibitedDefaults: ["landing page as the primary experience", "decorative dashboard without operational value", ...commonProhibitions]
    },
    deep_complex_platform: {
      generationDepth: "deep",
      surfaceStrategy: "role_and_workflow_platform",
      primaryPaths: ["src/", "backend/", "database/", "tests/", "docs/architecture/"],
      requiredSurfaces: ["role-aware navigation", "multiple complete workflows", "data and integration boundaries", "administration, audit, and recovery where justified"],
      optionalSurfaces: ["advanced analytics and automation only when supported by real data"],
      prohibitedDefaults: ["single long landing page", "one-role-only shell", "decorative module cards", ...commonProhibitions]
    },
    service_or_automation: {
      generationDepth: complexity.score >= 7 ? "production" : "focused",
      surfaceStrategy: "service_contract_or_executable",
      primaryPaths:
        artifactType === "api_service"
          ? ["src/api/", "backend/", "openapi/"]
          : artifactType === "infrastructure"
            ? ["infrastructure/", "deploy/"]
            : ["scripts/", "src/", "tests/"],
      requiredSurfaces: ["runnable entrypoint or valid service contract", "input validation", "error behavior", "focused tests"],
      optionalSurfaces: ["UI only when the user explicitly requests one"],
      prohibitedDefaults: ["decorative web dashboard", "marketing site wrapper", ...commonProhibitions]
    },
    existing_product_change: {
      generationDepth: "scoped",
      surfaceStrategy: "preserve_existing_product_shape",
      primaryPaths: ["existing project files relevant to the task"],
      requiredSurfaces: ["the requested bounded change", "regression-safe validation"],
      optionalSurfaces: [],
      prohibitedDefaults: ["whole-product redesign", "unrequested route or feature expansion", ...commonProhibitions]
    }
  };
  return contracts[shape];
}

function decisionReasons(shape, artifactType, complexity, explicitInstruction) {
  const reasons = [
    `Primary artifact classified as ${artifactType}.`,
    `Complexity score ${complexity.score} from roles, workflows, entities, persistence, integrations, governance, background work, scale, surface area, and risk.`
  ];
  if (explicitInstruction) reasons.unshift("An explicit product-shape instruction was preserved.");
  if (shape === "artifact_only") reasons.push("The requested media/document is the product; an application shell is not the primary deliverable.");
  if (shape === "focused_task_tool") reasons.push("The request centers on one repeated task and does not justify a broad product shell.");
  if (shape === "app_shaped_page") reasons.push("The request needs an interactive or content surface but does not prove production-system depth.");
  if (shape === "production_application") reasons.push("Operational workflow, state, data, role, or integration requirements justify a complete application.");
  if (shape === "deep_complex_platform") reasons.push("Multiple durable workflows and platform-level boundaries justify deep architecture.");
  if (shape === "service_or_automation") reasons.push("The primary output is executable or contract-driven rather than a visual application.");
  if (shape === "existing_product_change") reasons.push("The task targets an existing product, so its established architecture and UX shape must be preserved.");
  return reasons;
}

function previewStrategyFor(artifactType, productShape) {
  if (productShape === "artifact_only") {
    if (["video", "audio"].includes(artifactType)) return "media";
    if (artifactType === "spreadsheet") return "workbook";
    if (artifactType === "presentation") return "slides";
    if (artifactType === "document") return "document";
    if (artifactType === "flyer") return "print";
    if (artifactType === "image") return "image";
    return "file";
  }
  if (artifactType === "api_service") return "service_contract";
  if (["automation", "data_workflow", "infrastructure"].includes(artifactType)) return "execution";
  return "browser";
}

export function classifyProductShape(input = {}) {
  const instruction = clean(input.instruction);
  const projectName = clean(input.projectName);
  const existingProject = Boolean(input.existingProject);
  const combined = `${instruction}\n${projectName}`.trim();
  const artifact = inferArtifactType(combined, existingProject);
  const complexity = scoreComplexity(combined);
  const shape = productShapeFor({
    text: combined,
    artifactType: artifact.primary,
    complexity,
    existingProject
  });
  const interactionModel = interactionModelFor({
    text: combined,
    artifactType: artifact.primary,
    productShape: shape,
    complexity: { ...complexity, requiredCapabilities: complexity.capabilities }
  });
  const contract = shapeContract(shape, artifact.primary, complexity);
  const presentation = presentationContract(interactionModel);
  const explicitInstruction = /\b(single[- ]page|multi[- ]page|prototype|production[- ]ready|deep platform|artifact only|no ui|api only|cli only)\b/i.test(combined);
  const whyNotSimpler =
    shape === "artifact_only" || shape === "focused_task_tool" || shape === "service_or_automation"
      ? "This is already the smallest product shape that can satisfy the requested output."
      : complexity.score >= 6
        ? "A simpler surface would omit required workflow, state, role, persistence, integration, or governance behavior."
        : "The selected surface is intentionally shallow because deeper operational requirements were not provided.";
  const whyNotMoreComplex =
    shape === "deep_complex_platform"
      ? "No larger product shape is selected; further expansion requires new business domains or explicit scale constraints."
      : "More architecture would add unrequested roles, workflows, persistence, integrations, or administration.";

  return {
    version: decisionVersion,
    artifactType: artifact.primary,
    secondaryArtifactTypes: [...new Set(artifact.secondary)],
    productShape: shape,
    interactionModel,
    generationDepth: contract.generationDepth,
    surfaceStrategy: contract.surfaceStrategy,
    previewStrategy: previewStrategyFor(artifact.primary, shape),
    presentation,
    complexity,
    requiredCapabilities: complexity.capabilities,
    primaryOutputPaths: contract.primaryPaths,
    requiredSurfaces: contract.requiredSurfaces,
    optionalSurfaces: contract.optionalSurfaces,
    prohibitedDefaults: contract.prohibitedDefaults,
    explicitInstruction,
    decisionReasons: decisionReasons(shape, artifact.primary, complexity, explicitInstruction),
    whyNotSimpler,
    whyNotMoreComplex,
    review: {
      semanticRequired:
        shape === "deep_complex_platform" ||
        complexity.dimensions.risk > 0 ||
        complexity.dimensions.governance >= 2,
      checks: [
        "artifact intent and product shape match the user objective",
        "interaction model, information density, navigation, and spatial composition match the primary user job",
        "implementation depth matches the complexity evidence",
        "required real data is used or represented by explicit empty/configuration states",
        "supplied inputs and media are consumed",
        "visible UI does not explain its own features unless requested",
        "generic dashboard, card, field, and route patterns are absent unless the domain requires them"
      ]
    }
  };
}

export function productShapePrompt(decision = {}) {
  return [
    "Binding Product Shape Contract:",
    `- Artifact type: ${decision.artifactType || "unspecified_digital_output"}`,
    `- Product shape: ${decision.productShape || "app_shaped_page"}`,
    `- Interaction model: ${decision.interactionModel || "workflow_application"}`,
    `- Generation depth: ${decision.generationDepth || "shaped"}`,
    `- Surface strategy: ${decision.surfaceStrategy || "primary_flow_page"}`,
    `- Preview strategy: ${decision.previewStrategy || "browser"}`,
    `- Information density: ${decision.presentation?.informationDensity || "balanced"}`,
    `- Navigation model: ${decision.presentation?.navigationModel || "user_goals"}`,
    `- Spatial model: ${decision.presentation?.spatialModel || "workflow_and_state"}`,
    `- Component family: ${decision.presentation?.componentFamily || "domain_specific_controls"}`,
    `- Complexity score: ${decision.complexity?.score ?? 0}`,
    `- Required capabilities: ${(decision.requiredCapabilities || []).join(", ") || "none inferred"}`,
    `- Required surfaces: ${(decision.requiredSurfaces || []).join("; ") || "satisfy the primary objective"}`,
    `- Optional surfaces: ${(decision.optionalSurfaces || []).join("; ") || "none"}`,
    `- Prohibited defaults: ${(decision.prohibitedDefaults || []).join("; ") || "none"}`,
    `- Primary output paths: ${(decision.primaryOutputPaths || []).join(", ") || "task-appropriate project paths"}`,
    ...(decision.artifactType === "spreadsheet" ? [
      "- Workbook contract: create a real spreadsheet artifact with requested sheets, cell formulas, references, tables, formatting, validation, and recalculation behavior. Do not substitute an HTML table."
    ] : []),
    ...(decision.artifactType === "flyer" ? [
      "- Print contract: create the real flyer asset at the requested dimensions and resolution with deliberate hierarchy, image treatment, bleed/safe-area awareness when applicable, and print/download output."
    ] : []),
    `- Why not simpler: ${decision.whyNotSimpler || "The selected shape is the smallest complete solution."}`,
    `- Why not more complex: ${decision.whyNotMoreComplex || "Additional architecture is not justified."}`,
    "- Treat this contract as binding. Do not silently change the artifact type, product shape, generation depth, or surface strategy."
  ].join("\n");
}

export function validateProductShapeOutputs(decision = {}, changedFiles = []) {
  const normalizedFiles = changedFiles.map((filePath) => String(filePath || "").replaceAll("\\", "/"));
  const failures = [];
  const warnings = [];
  const hasFile = (matcher) => normalizedFiles.some((filePath) => matcher(filePath.toLowerCase()));
  const artifactDefinition = artifactDefinitions.find((definition) => definition.type === decision.artifactType);

  if (decision.productShape === "artifact_only") {
    const hasPrimaryArtifact = artifactDefinition
      ? hasFile((filePath) => artifactDefinition.extensions.some((extension) => filePath.endsWith(extension)))
      : hasFile((filePath) => filePath.startsWith("deliverables/") || filePath.startsWith("artifacts/"));
    if (!hasPrimaryArtifact) {
      failures.push(`No changed ${decision.artifactType || "artifact"} file was found in the Product Shape output paths.`);
    }
  }

  if (decision.productShape === "service_or_automation") {
    const serviceEvidence =
      decision.artifactType === "api_service"
        ? hasFile((filePath) => /(^|\/)(api|backend|openapi)(\/|\.|$)/.test(filePath))
        : decision.artifactType === "infrastructure"
          ? hasFile((filePath) => /(^|\/)(infrastructure|deploy|terraform|helm)(\/|\.|$)/.test(filePath))
          : hasFile((filePath) => /(^|\/)(scripts|src|tests|outputs)(\/|\.|$)/.test(filePath) && !filePath.endsWith(".jsx"));
    if (!serviceEvidence) {
      failures.push(`No runnable or contract evidence was found for ${decision.artifactType || "service_or_automation"}.`);
    }
  }

  if (["focused_task_tool", "app_shaped_page", "production_application", "deep_complex_platform"].includes(decision.productShape)) {
    const implementationEvidence = hasFile((filePath) =>
      /(^|\/)(src|app|frontend|backend|database|android|ios)(\/|\.|$)/.test(filePath) &&
      !filePath.endsWith("metadata.json")
    );
    if (!implementationEvidence) failures.push("No application implementation file changed beyond generation metadata.");
  }

  if (
    decision.productShape !== "existing_product_change" &&
    normalizedFiles.every((filePath) => /(^|\/)(observability|memory|graph|topology|agents|registry)(\/|$)/.test(filePath))
  ) {
    failures.push("Only control-plane or memory artifacts changed; the requested user-facing or executable output did not.");
  }
  if (!normalizedFiles.some((filePath) => filePath === "src/generated/metadata.json")) {
    warnings.push("Generation metadata was not updated with the Product Shape and source-consumption receipt.");
  }

  return {
    status: failures.length ? "failed" : warnings.length ? "passed_with_warnings" : "passed",
    productShape: decision.productShape || "unknown",
    artifactType: decision.artifactType || "unknown",
    interactionModel: decision.interactionModel || "unknown",
    checkedFiles: normalizedFiles,
    failures,
    warnings
  };
}
