import {
  AudioLines,
  ArrowRight,
  ArrowUpRight,
  Bot,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  CirclePlay,
  FileCheck2,
  FileCode2,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Layers3,
  LockKeyhole,
  Server,
  Sparkles,
  ShieldCheck,
  Waypoints
} from "lucide-react";
import "./StudioPage.css";

function scrollToStudioSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function StudioPage({
  currentUser,
  onOpenBuilder,
  onOpenPlutonix,
  onOpenAgents,
  onOpenHosting,
  onOpenProductDocument,
  developmentAuthEnabled,
  onUseDevelopmentProfile
}) {
  return (
    <main className="studio-page" aria-label="PlutoniX Studio">
      <section className="studio-hero" id="studio-overview">
        <div className="studio-frame">
          <nav className="studio-section-nav" aria-label="Studio navigation">
            <button type="button" onClick={() => scrollToStudioSection("studio-overview")}>Studio</button>
            <button type="button" onClick={() => scrollToStudioSection("studio-workflow")}>How it works</button>
            <button type="button" onClick={() => scrollToStudioSection("studio-governance")}>Governed decisions</button>
            <button type="button" onClick={() => scrollToStudioSection("studio-documentation")}>Product guide</button>
            {currentUser ? <button type="button" className="studio-section-nav-app" onClick={onOpenBuilder}>
              Open workspace <ArrowUpRight size={15} />
            </button> : <button type="button" className="studio-section-nav-app" onClick={() => scrollToStudioSection("studio-access")}>
              Secure sign in <LockKeyhole size={14} />
            </button>}
          </nav>

          <div className="studio-hero-layout">
            <div className="studio-hero-copy">
              <p className="studio-eyebrow"><Sparkles size={15} /> Agentic product intelligence</p>
              <h2>Build, understand, and govern <span>the right digital product.</span></h2>
              <p className="studio-lede">
                PlutoniX turns a real brief into the right application, artifact, service, or automation, then preserves
                the evidence, agent knowledge, architecture, and decisions needed to evolve it responsibly.
              </p>
              <div className="studio-hero-actions">
                {currentUser ? <>
                  <button type="button" className="studio-primary-action" onClick={onOpenBuilder}>Open Builder <ArrowRight size={17} /></button>
                  <button type="button" className="studio-secondary-action" onClick={onOpenPlutonix}>Open product intelligence <BrainCircuit size={17} /></button>
                </> : <>
                  <button type="button" className="studio-primary-action" onClick={() => scrollToStudioSection("studio-access")}>Enter Studio securely <LockKeyhole size={16} /></button>
                  <button type="button" className="studio-secondary-action" onClick={() => scrollToStudioSection("studio-workflow")}>See the product flow <ArrowRight size={17} /></button>
                </>}
              </div>
              <p className="studio-hero-note">
                Every request starts with a Product Shape Contract, so the requested app, document, workbook, media,
                API, or automation remains the product—not a generic page standing in for it.
              </p>
              <ul className="studio-hero-proof" aria-label="Product guarantees">
                <li><ShieldCheck size={15} /><span><b>Private by default</b>Application and enterprise boundaries stay explicit.</span></li>
                <li><GitBranch size={15} /><span><b>Decision-aware</b>Selected, deferred, and rejected paths retain evidence.</span></li>
                <li><BrainCircuit size={15} /><span><b>Model-governed</b>Policy, budget, privacy, and region shape eligible routes.</span></li>
              </ul>
            </div>

            <figure className="studio-hero-preview">
              <div className="studio-preview-toolbar">
                <span><i /> Current product film</span>
                <span className="studio-preview-sound"><AudioLines size={13} /> Original score · 01:18</span>
              </div>
              <div className="studio-video-shell">
                <video
                  controls
                  playsInline
                  preload="metadata"
                  poster="/media/product-video/plutonix-product-video-poster.png"
                  aria-describedby="studio-product-film-caption"
                >
                  <source src="/media/product-video/plutonix-product-video.mp4" type="video/mp4" />
                  <track
                    kind="captions"
                    src="/media/product-video/plutonix-product-video.vtt"
                    srcLang="en"
                    label="English"
                    default
                  />
                  Your browser does not support the product film.
                </video>
                <span className="studio-video-mark" aria-hidden="true">PlutoniX <b>Product film</b></span>
              </div>
              <figcaption id="studio-product-film-caption">
                <span>Builder intake, evidence gates, application Analysis, a separate governed boundary, and mock-safe hosting.</span>
                <a href="/media/product-video/plutonix-product-video.mp4" target="_blank" rel="noreferrer">
                  Open film <CirclePlay size={15} />
                </a>
              </figcaption>
            </figure>
          </div>

          <div className="studio-output-rail" aria-label="Supported product outputs">
            <div>
              <span>Designed for the requested output</span>
              <p>Native deliverables over generic placeholders.</p>
            </div>
            <ul>
              <li><FileCode2 size={16} /> Applications &amp; APIs</li>
              <li><FileText size={16} /> Documents &amp; reports</li>
              <li><FileSpreadsheet size={16} /> Workbooks &amp; data</li>
              <li><CirclePlay size={16} /> Media &amp; presentations</li>
              <li><Waypoints size={16} /> Automations &amp; tools</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="studio-intelligence-band" aria-label="PlutoniX product intelligence layers">
        <div className="studio-frame studio-intelligence-grid">
          <article><span>01</span><BrainCircuit size={19} /><div><h3>BrainX</h3><p>Application and enterprise knowledge grounded in recorded evidence.</p></div></article>
          <article><span>02</span><GitBranch size={19} /><div><h3>DecisionX</h3><p>Current paths, alternatives, constraints, validation, and outcomes.</p></div></article>
          <article><span>03</span><Bot size={19} /><div><h3>AgenticX</h3><p>Reusable tenant knowledge with authorization and sanitization receipts.</p></div></article>
          <article><span>04</span><Waypoints size={19} /><div><h3>ResearchX + AIX</h3><p>Bounded observations and policy-aware model route evaluation.</p></div></article>
        </div>
      </section>

      <section className="studio-workflow" id="studio-workflow">
        <div className="studio-frame studio-workflow-layout">
          <div className="studio-section-heading">
            <p className="studio-eyebrow">The working sequence</p>
            <h2>From brief to a working, inspectable product.</h2>
            <p>
              A repeatable workflow for real deliverables, not a one-off prompt response.
            </p>
          </div>

          <ol className="studio-trace-list">
            <li>
              <span className="studio-trace-index">01</span>
              <div>
                <h3>Bring the brief and the evidence</h3>
                <p>Start with an instruction and the files, screenshots, data, or integration context it needs. The workflow surfaces missing factual inputs before bounded work proceeds.</p>
              </div>
              <FileCheck2 size={21} />
            </li>
            <li>
              <span className="studio-trace-index">02</span>
              <div>
                <h3>Shape the requested outcome</h3>
                <p>PlutoniX creates a Product Shape Contract, then coordinates bounded work around the requested application, document, workbook, media artifact, API, script, or automation.</p>
              </div>
              <Layers3 size={21} />
            </li>
            <li>
              <span className="studio-trace-index">03</span>
              <div>
                <h3>Inspect the product and its decisions</h3>
                <p>Analysis keeps observed source behavior distinct from proposed, selected, deferred, rejected, validation, and outcome records.</p>
              </div>
              <GitBranch size={21} />
            </li>
            <li>
              <span className="studio-trace-index">04</span>
              <div>
                <h3>Carry evidence into the next review</h3>
                <p>Artifacts, validation, constraints, and decision records stay available as the product evolves.</p>
              </div>
              <Waypoints size={21} />
            </li>
          </ol>
        </div>
      </section>

      <section className="studio-governance" id="studio-governance">
        <div className="studio-frame studio-governance-layout">
          <div className="studio-governance-intro">
            <p className="studio-eyebrow"><ShieldCheck size={15} /> Optional governed decision continuity</p>
            <h2>Govern change with evidence—not automatic approval.</h2>
            <p>
              Analysis makes application context visible. Enterprise BrainX is a separate, opt-in control plane: authorized
              bindings, policy snapshots, evidence references, budget reservations, and reviewable receipts live outside the portfolio view.
            </p>
            <button type="button" className="studio-dark-action" onClick={currentUser ? onOpenPlutonix : () => scrollToStudioSection("studio-access")}>
              {currentUser ? "Open product intelligence" : "Enter Studio securely"} <ArrowRight size={16} />
            </button>
          </div>

          <div className="studio-governance-ledger" aria-label="Governed capabilities">
            <article>
              <span>App BrainX</span>
              <p>Each App BrainX is private by default; a portfolio tag only organizes Analysis and never grants cross-application access.</p>
            </article>
            <article>
              <span>DecisionX</span>
              <p>Captures proposed, selected, deferred, rejected, validation, and outcome facts alongside observed implementation behavior.</p>
            </article>
            <article>
              <span>AIX</span>
              <p>Evaluates registered model candidates against policy and budget. When none qualify, it returns a reviewable <code>no_eligible_model</code> outcome.</p>
            </article>
            <article>
              <span>ResearchX + AgenticX</span>
              <p>ResearchX records bounded, allowlisted observations. AgenticX adds only policy-checked, sanitized context after authorization succeeds.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="studio-documentation" id="studio-documentation">
        <div className="studio-frame studio-documentation-layout">
          <div>
            <p className="studio-eyebrow"><BookOpen size={15} /> Read the product, not a promise</p>
            <h2>See what PlutoniX does today—and where its boundaries are.</h2>
            <p>
              The product guide and walkthrough explain Builder, artifact-aware previews, Analysis, governed Decision Continuity,
              and the current mock-safe hosting workflow.
            </p>
          </div>
          <div className="studio-documentation-actions">
            {currentUser ? <button type="button" className="studio-primary-action" onClick={onOpenProductDocument}>
              Open product document <BookOpen size={17} />
            </button> : null}
            <a href="/docs/product-doc-plutonix.md" target="_blank" rel="noreferrer">
              Read as Markdown <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </section>

      <section className="studio-access" id="studio-access" aria-label="Google Studio sign in">
        <div className="studio-frame studio-access-layout">
          <div>
            <p className="studio-eyebrow"><LockKeyhole size={15} /> Studio access</p>
            {currentUser ? (
              <>
                <h2>Welcome back, {currentUser.name}.</h2>
                <p>You are signed in with {currentUser.authProvider === "oidc" ? "your verified identity" : "your authorized development profile"}. Your operational workspaces are now available.</p>
                <button type="button" className="studio-primary-action" onClick={onOpenBuilder}>
                  Continue to Builder <ArrowRight size={17} />
                </button>
              </>
            ) : (
              <>
                <h2>Start or return to Studio with Google.</h2>
                <p>Google is a single entry point for first-time access and return visits. Authentication confirms identity; enterprise permissions remain separately assigned.</p>
              </>
            )}
          </div>
          {!currentUser ? (
            <div className="studio-sso-panel">
              <p>Google SSO</p>
              <h3>Use the secure sign-in control in the header.</h3>
              <small>The header remains available while you explore the product overview. After sign-in, it becomes your Google profile control.</small>
              {developmentAuthEnabled ? <button type="button" className="studio-development-action" onClick={onUseDevelopmentProfile}>Use enabled development profile</button> : null}
            </div>
          ) : <div className="studio-authorized-launcher" aria-label="Authorized Studio workspaces">
            <p><CheckCircle2 size={14} /> Authorized workspace</p>
            <button type="button" onClick={onOpenBuilder}><Sparkles size={17} /><span><b>Builder</b><small>Create and evolve products</small></span><ArrowRight size={15} /></button>
            <button type="button" onClick={onOpenPlutonix}><BrainCircuit size={17} /><span><b>PlutoniX</b><small>Intelligence and decisions</small></span><ArrowRight size={15} /></button>
            <button type="button" onClick={onOpenAgents}><Bot size={17} /><span><b>Agents</b><small>Global agent memory</small></span><ArrowRight size={15} /></button>
            <button type="button" onClick={onOpenHosting}><Server size={17} /><span><b>Cloud Hosting</b><small>Controlled delivery stages</small></span><ArrowRight size={15} /></button>
          </div>}
        </div>
      </section>

      <footer className="studio-footer">
        <div className="studio-frame">
          <span>PlutoniX Studio</span>
          <p>From a real brief to a working product—with evidence to inspect, govern, and evolve it.</p>
          <CheckCircle2 size={17} aria-hidden="true" />
        </div>
      </footer>
    </main>
  );
}
