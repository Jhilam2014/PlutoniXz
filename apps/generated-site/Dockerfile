FROM node:22-alpine

WORKDIR /workspace/generated-site
COPY apps/generated-site/package.json ./
RUN npm install
COPY apps/generated-site ./
EXPOSE 5174
CMD ["npm", "run", "dev"]
