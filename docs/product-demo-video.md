# PlutoMix Product Demo Video

Status: current 1080p product demo source and regeneration guide.

## Purpose

The product demo tells the current, bounded PlutoMix workflow without turning a preview into a claim of production authority. It is intended for product discovery, onboarding, and internal review.

The narrative is:

```text
Builder intake and evidence/data gate
  -> portfolio and application Analysis
  -> private App BrainX and explicit portfolio scope
  -> separately authorized Enterprise BrainX receipts
  -> delivery decision evidence
  -> current product documentation
  -> mock-safe Cloud Hosting review
```

## Truthful product claims

- An App BrainX is private to its application by default. A legacy portfolio enterprise assignment organizes the Analysis view but does not authorize a cross-application action.
- Enterprise BrainX is an opt-in, Decision Continuity-backed control plane. Its binding, policy, evidence, budget, and receipt records are separate from the portfolio projection.
- DecisionX captures observed build facts and outcomes. AIX evaluates eligible registered candidates and fails closed when none qualify. ResearchX is allowlisted and review-only. AgenticX reuses only policy-checked, sanitized knowledge.
- The film must not imply live provider invocation, unrestricted web research, automatic model downloads, autonomous deployment, or legal/compliance certification.
- Cloud Hosting is explicitly mock-safe in the current build: it previews and simulates a controlled deployment workflow but does not mutate a cloud account.

## Storyboard

| Scene | Capture | Narrative focus |
| --- | --- | --- |
| 01 | Builder workspace | Multi-artifact intake and product-shape routing |
| 02 | Builder instruction | Evidence/data gate before bounded work continues |
| 03 | Analysis portfolio | Application inventory and App BrainX privacy |
| 04 | Portfolio Intelligence popup | Explicit scopes, recorded relationships, and evidence inspector |
| 05 | Application decisions | Observed source implementation versus recorded decision states |
| 06 | Governed BrainX boundary | Separate authorization for Enterprise policy, receipts, AIX, ResearchX, and AgenticX |
| 07 | Delivery Decision Graph | Build context, functionality, outcomes, agents, and services |
| 08 | Product Document | Current workflows and safety boundaries |
| 09 | Cloud Hosting | Review, approval, health, rollback, and mock-safe status |
| 10 | Builder close | Evidence-backed product outcome |

## Source assets

- Capture automation: `artifacts/product-video/capture-product-video.mjs`
- Narration: `artifacts/product-video/narration.txt`
- Captions: `artifacts/product-video/captions.vtt`
- Title overlays: `artifacts/product-video/create-title-overlays.mjs`
- Rendering and public-media mirroring: `artifacts/product-video/render-product-video.sh`
- Published player assets: `apps/frontend/public/media/product-video/`

## Regenerate and verify

Run the frontend and backend from the working tree, then capture against the intended local URL. The capture script is read-only with respect to managed projects: it fills a draft Builder instruction but does not submit it or start a project runtime.

```sh
docker compose up -d backend
npm --prefix apps/frontend run dev -- --port 5175
PLUTOMIX_PRODUCT_DEMO_URL=http://localhost:5175 node artifacts/product-video/capture-product-video.mjs
zsh artifacts/product-video/render-product-video.sh
```

The renderer uses macOS `say`, Playwright, and FFmpeg. It regenerates narration/title overlays, creates the MP4/poster, and mirrors the MP4, poster, and captions into the frontend public-media directory.

Verify the result before publishing:

```sh
ffprobe -v error -show_entries format=duration:stream=codec_name,codec_type,width,height -of json artifacts/product-video/plutomix-product-video.mp4
shasum artifacts/product-video/plutomix-product-video.mp4 apps/frontend/public/media/product-video/plutomix-product-video.mp4
shasum artifacts/product-video/poster.png apps/frontend/public/media/product-video/plutomix-product-video-poster.png
cmp artifacts/product-video/captions.vtt apps/frontend/public/media/product-video/plutomix-product-video.vtt
```

The MP4 should be a 1920×1080 H.264/AAC film with an approximately 78-second runtime. Inspect the contact sheet or the video directly and confirm that all shots show the current Analysis workflow rather than the retired Graphical Model capture flow.
