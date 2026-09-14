FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev 2>/dev/null || npm install --omit-dev 2>/dev/null || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
ENV MCP_HOST=0.0.0.0 MCP_PORT=6507
EXPOSE 6507
CMD ["node", "dist/index.js"]
