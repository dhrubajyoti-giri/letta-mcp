// Central configuration. Every tunable comes from the environment —
// nothing is hardcoded here. See .env.example for the full schema.
import { promises as fs } from "node:fs";
import path from "node:path";

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
  lettaUrl: str("LETTA_APP_SERVER_URL", ""),
  lettaToken: str("LETTA_APP_SERVER_TOKEN", ""),
  defaultAgentId: str("DEFAULT_LETTA_AGENT_ID", ""),
  agentsFile: str("AGENTS_FILE", "./agents.json"),
  sessionCwd: str("SESSION_CWD", "/workspace"),
  defaultPersona: str("DEFAULT_PERSONA", "You are a helpful coding assistant with long-term memory."),
  defaultHuman: str("DEFAULT_HUMAN", ""),
  defaultModel: str("DEFAULT_MODEL", ""),
  defaultTopK: num("DEFAULT_TOP_K", 5),
  defaultListLimit: num("DEFAULT_LIST_LIMIT", 20),
  requestTimeoutMs: num("REQUEST_TIMEOUT_MS", 60000),
  streamMaxChars: num("STREAM_MAX_CHARS", 4000),
};

interface AgentsFileShape {
  default?: string;
  projects?: Record<string, string>;
}

let agentsCache: { mtime: number; data: AgentsFileShape } | null = null;

async function loadAgentsFile(): Promise<AgentsFileShape> {
  const file = path.resolve(config.agentsFile);
  try {
    const st = await fs.stat(file);
    if (agentsCache && agentsCache.mtime === st.mtimeMs) return agentsCache.data;
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw) as AgentsFileShape;
    agentsCache = { mtime: st.mtimeMs, data };
    return data;
  } catch {
    return {};
  }
}

/**
 * Agent resolution order:
 *   1. explicit `agent_id` tool param
 *   2. project override from AGENTS_FILE (`projects[project]`)
 *   3. `default` entry in AGENTS_FILE
 *   4. DEFAULT_LETTA_AGENT_ID env
 * Throws a clear error when nothing resolves.
 */
export async function resolveAgentId(explicit?: string, project?: string): Promise<string> {
  if (explicit) return explicit;
  const mapping = await loadAgentsFile();
  if (project && mapping.projects?.[project]) return mapping.projects[project] as string;
  if (mapping.default) return mapping.default;
  if (config.defaultAgentId) return config.defaultAgentId;
  throw new Error(
    "No agent selected: pass agent_id, set a project mapping in AGENTS_FILE, or set DEFAULT_LETTA_AGENT_ID.",
  );
}
