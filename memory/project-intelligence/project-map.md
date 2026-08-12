# PlutoniX Project Map

PlutoniX is a fullstack containerized webpage builder.

## Runtime Services

- `frontend`: React/Vite control surface for prompt input, status, activity, and live preview.
- `backend`: Express API with REST generation, SSE activity stream, and MCP-compatible JSON-RPC endpoint.
- `generated-site`: isolated React/Vite preview runtime where generated source is mounted and hot reloaded.

## Primary Flow

User instruction -> backend generation engine -> generated-site source files -> Vite hot reload -> frontend iframe preview.

## Risk Notes

Generated user instructions are treated as text. The current generator is deterministic and does not execute shell commands or arbitrary code.
