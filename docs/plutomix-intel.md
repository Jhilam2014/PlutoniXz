# PlutoMix Intel

PlutoMix Intel is a profile-driven workflow layered over the normal project workflow. With Intel off, the existing direct workflow is unchanged. With Intel on, Product Shape, the instruction, and existing-project metadata select a profile before any writer starts.

Fully supported profiles are `web-application`, `api-service`, `document-pdf`, and `spreadsheet`. Each has a bounded specialist team, one workspace writer, profile-specific output checks, and an independent read-only verification step. The Playground uses the active profile: browser for web work, an API-contract surface for API work, and artifact preview for documents and spreadsheets.

The document profile accepts PDF or DOCX deliverables. PDFs are rasterized with Poppler; DOCX files are converted through LibreOffice Writer and then rasterized. The spreadsheet profile requires a real XLSX workbook, checks stored formula-error values, recalculates it through LibreOffice Calc, exports it to PDF, and rasterizes its first page. A profile fails instead of claiming completion when its renderer or recalculation tool cannot produce that evidence. The backend Docker image includes these tools; a bare local Node process must install equivalent tools to exercise the same checks.

Other registered profiles are intentionally reported as unsupported. They do not silently fall back to web generation.

The current provider is the configured Codex CLI. Intel records it as `cli`; no Codex MCP server is started or simulated. Codex runs use `workspace-write` only for implementation and repair, and `read-only` for independent review.

Intel stores actual task-node state, executed agent runs, evidence, backend-scored proposal decisions, artifacts, validation, and verification in the existing project instruction history and runtime event stream. It permits at most three concurrent local read-only specialists and one writer per workspace. After an actionable independent-verification failure, it may run one profile-bounded workspace-write repair, then repeats profile validation and independent verification. Provider, cancellation, timeout, and unavailable-tool failures do not trigger repair.

The current CLI worker runs as a child of the backend process with Codex sandbox modes and project-root path checks, not as a separately container-isolated worker. The backend retains its existing Docker integration for project runtime management, so the Docker socket is not exposed as a dedicated worker tool but full worker-level Docker isolation remains a deployment limitation. Intel does not claim production isolation until workers are split into a socket-free execution environment.
