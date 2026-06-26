# VibeKit MCP server — stdio transport.
# Builds the TypeScript server and runs it; it boots and answers MCP
# introspection (ListTools) without an API key, so Glama's checks pass.
FROM node:20-alpine

WORKDIR /app

# Install dependencies (incl. dev deps needed for the TypeScript build)
COPY package.json package-lock.json ./
RUN npm ci

# Build
COPY tsconfig.json ./
COPY src ./src
COPY tools.json README.md ./
RUN npm run build

# The MCP server speaks over stdio
ENTRYPOINT ["node", "dist/index.js"]
