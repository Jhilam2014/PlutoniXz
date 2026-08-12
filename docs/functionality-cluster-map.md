# Functionality Cluster Map

- `frontend_control_surface`: React cockpit for instructions, status, activity, and preview.
- `backend_generation_api`: Express REST API, SSE events, and deterministic generator.
- `mcp_generation_endpoint`: JSON-RPC style MCP endpoint for `generate_webpage`.
- `generated_site_runtime`: isolated Vite preview app for generated source.
- `container_orchestration`: Docker Compose and service Dockerfiles.
