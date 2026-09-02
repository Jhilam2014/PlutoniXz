FROM node:22-bookworm-slim

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm ci --omit=dev --workspace @plutomix/backend
ARG CODEX_VERSION=0.151.0
ARG CLAUDE_VERSION=2.1.251
RUN test -n "${CODEX_VERSION}" \
  && test -n "${CLAUDE_VERSION}" \
  && npm install -g \
    @openai/codex@${CODEX_VERSION} \
    @anthropic-ai/claude-code@${CLAUDE_VERSION} \
  && /usr/local/bin/codex --version \
  && /usr/local/bin/claude --version
# Intel validates document and spreadsheet artifacts by rendering their actual
# output. Keep those native tools in the parent backend image; they are never
# exposed as agent tools. Gotham also needs a glibc-based shell environment and
# the standard repository inspection tools used by Codex inside Bubblewrap.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    bubblewrap \
    ca-certificates \
    git \
    libreoffice-calc \
    libreoffice-writer \
    poppler-utils \
    ripgrep \
    socat \
  && rm -rf /var/lib/apt/lists/*
# Codex ships a Bubblewrap build with --argv0 support. Debian 12's system
# Bubblewrap 0.8 lacks that flag and can lose Codex's inner sandbox helper,
# surfacing as `execvp codex-linux-sandbox: No such file or directory`.
RUN CODEX_BWRAP="$(find /usr/local/lib/node_modules/@openai/codex -type f -path '*/codex-resources/bwrap' -print -quit)" \
  && test -n "$CODEX_BWRAP" \
  && ln -sf "$CODEX_BWRAP" /usr/local/bin/bwrap \
  && /usr/local/bin/bwrap --help | grep -q -- '--argv0'
WORKDIR /workspace/backend
COPY apps/backend ./
EXPOSE 8080
CMD ["node", "--env-file-if-exists=/workspace/project/.env", "src/server.js"]
