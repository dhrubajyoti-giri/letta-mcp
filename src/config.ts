// Central configuration. Every tunable comes from the environment —
// nothing is hardcoded here. See .env.example for the full schema.
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
  defaultPersona: str("DEFAULT_PERSONA", "You are a helpful coding assistant with long-term memory."),
  defaultHuman: str("DEFAULT_HUMAN", ""),
  defaultModel: str("DEFAULT_MODEL", ""),
  defaultTopK: num("DEFAULT_TOP_K", 5),
  defaultListLimit: num("DEFAULT_LIST_LIMIT", 20),
  requestTimeoutMs: num("REQUEST_TIMEOUT_MS", 60000),
  streamMaxChars: num("STREAM_MAX_CHARS", 4000),
};
