// Central configuration. Every tunable comes from the environment —
// nothing is hardcoded here. See .env.example for the full schema.
import * as fs from "node:fs";
import * as path from "node:path";

function str(name: string, def = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env ${name}=${v}`);
  return n;
}

export const config = {
  mcpHost: str("MCP_HOST", "0.0.0.0"),
  mcpPort: num("MCP_PORT", 6507),
  mcpAuthToken: str("MCP_AUTH_TOKEN", ""),
  lettaUrl: str("LETTA_APP_SERVER_URL", ""),
  lettaToken: str("LETTA_APP_SERVER_TOKEN", ""),
  sessionCwd: str("SESSION_CWD", "/workspace"),
  defaultPersona: str("DEFAULT_PERSONA", ""),
  defaultHuman: str("DEFAULT_HUMAN", ""),
  defaultModel: str("DEFAULT_MODEL", ""),
  defaultEmbedding: str("DEFAULT_EMBEDDING", ""),
  defaultTopK: num("DEFAULT_TOP_K", 5),
  defaultListLimit: num("DEFAULT_LIST_LIMIT", 20),
  requestTimeoutMs: num("REQUEST_TIMEOUT_MS", 60000),
  streamMaxChars: num("STREAM_MAX_CHARS", 4000),
};

// Per-agent model/embedding mapping, keyed by agent name as passed to
// agent_create. File path from AGENT_MODELS_FILE (default
// <cwd>/config/agent-models.json). Missing/unreadable file = no mapping;
// explicit per-call args always win over mapped values.
export interface AgentModelEntry {
  model?: string;
  embedding?: string;
}

let agentModelsCache: Record<string, AgentModelEntry> | null = null;

function loadAgentModels(): Record<string, AgentModelEntry> {
  if (agentModelsCache) return agentModelsCache;
  agentModelsCache = {};
  const file =
    process.env["AGENT_MODELS_FILE"] ??
    path.join(process.cwd(), "config", "agent-models.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (raw && typeof raw === "object") {
      for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
        if (entry && typeof entry === "object") {
          const e = entry as Record<string, unknown>;
          const out: AgentModelEntry = {};
          if (typeof e["model"] === "string" && e["model"]) out.model = e["model"];
          if (typeof e["embedding"] === "string" && e["embedding"]) out.embedding = e["embedding"];
          if (out.model !== undefined || out.embedding !== undefined) {
            agentModelsCache[name] = out;
          }
        }
      }
    }
  } catch {
    /* no mapping file — fall back to DEFAULT_* only */
  }
  return agentModelsCache;
}

/** Mapped model/embedding defaults for an agent name (undefined when unmapped). */
export function agentDefaults(name: string | undefined): AgentModelEntry | undefined {
  if (!name) return undefined;
  return loadAgentModels()[name];
}
