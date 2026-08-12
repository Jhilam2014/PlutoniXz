FROM node:22-alpine

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm ci --omit=dev --workspace @plutonix/backend
ARG CODEX_VERSION=0.147.0
RUN npm install -g @openai/codex@${CODEX_VERSION}
# Intel validates document and spreadsheet artifacts by rendering their actual
# output. Keep those native tools in the parent backend image; they are never
# exposed as agent tools.
RUN apk add --no-cache poppler-utils libreoffice-calc libreoffice-writer
WORKDIR /workspace/backend
COPY apps/backend ./
EXPOSE 8080
CMD ["node", "--env-file-if-exists=/workspace/project/.env", "src/server.js"]
