FROM node:22-alpine

WORKDIR /workspace/frontend
COPY apps/frontend/package.json ./
RUN npm install
COPY .env.example ../.env.example
COPY apps/frontend ./
EXPOSE 5173
CMD ["npm", "run", "dev"]
