# Build stage: full toolchain (node-pty needs python3/make/g++ on ARM).
FROM node:22 AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime stage: slim, no toolchain.
FROM node:22-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY config ./config
ENV MCP_HOST=0.0.0.0 MCP_PORT=6507
EXPOSE 6507
CMD ["node", "dist/index.js"]
