import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerMemoryTools } from "./tools/memory.js";

function buildServer(): McpServer {
  const server = new McpServer({ name: "letta-appserver-mcp", version: "0.2.0" });
  registerAgentTools(server);
  registerMemoryTools(server);
  return server;
}

async function handleMcp(req: Request, res: Response): Promise<void> {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = `Bearer ${config.mcpAuthToken}`;
  const given = req.header("authorization") ?? "";
  const ok =
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    res.set("WWW-Authenticate", "Bearer");
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

async function main(): Promise<void> {
  if (!config.mcpAuthToken) {
    console.error("Refusing to start: set MCP_AUTH_TOKEN in .env (openssl rand -hex 32).");
    process.exit(1);
  }
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.post("/mcp", requireAuth, handleMcp);
  app.get("/mcp", requireAuth, handleMcp);
  app.delete("/mcp", requireAuth, handleMcp);
  app.get("/healthz", (_req: Request, res: Response) => res.json({ ok: true }));
  app.listen(config.mcpPort, config.mcpHost, () => {
    console.log(`letta-appserver-mcp listening on ${config.mcpHost}:${config.mcpPort}/mcp`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
