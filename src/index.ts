import express, { type Request, type Response } from "express";
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

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);
  app.get("/healthz", (_req: Request, res: Response) => res.json({ ok: true }));
  app.listen(config.mcpPort, config.mcpHost, () => {
    console.log(`letta-appserver-mcp listening on ${config.mcpHost}:${config.mcpPort}/mcp`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
