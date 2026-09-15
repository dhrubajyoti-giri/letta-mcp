// Singleton bridge to the Letta App Server (remote backend).
// Letta is the single source of truth for memory — when the server is
// unreachable or unconfigured, tools fail with a clear error (no fallback).
import { config } from "./config.js";
import WebSocket from "ws";

let client: any = null;

export function isBridgeConfigured(): boolean {
  return Boolean(config.lettaUrl && config.lettaToken);
}

export async function getClient(): Promise<any> {
  if (!config.lettaUrl || !config.lettaToken) {
    throw new Error(
      "App Server not configured: set LETTA_APP_SERVER_URL and LETTA_APP_SERVER_TOKEN in .env.",
    );
  }
  if (client) return client;
  const { LettaAgentClient } = await import("@letta-ai/letta-agent-sdk");
  client = new LettaAgentClient({
    backend: "remote",
    url: config.lettaUrl,
    authToken: config.lettaToken,
    requestTimeoutMs: config.requestTimeoutMs,
    WebSocket: WebSocket as any,
  } as any);
  return client;
}

async function collectStream(session: any): Promise<string> {
  let out = "";
  const problems: string[] = [];
  for await (const m of session.stream()) {
    const t = String((m as any).type ?? "");
    if (t === "assistant") out += String((m as any).content ?? "");
    else if (t === "result" && (m as any).content) out += String((m as any).content);
    else if (t === "error" || t === "exception" || t === "failed" || t === "failure") {
      const msg =
        (m as any).error ?? (m as any).message ?? (m as any).content ?? JSON.stringify(m).slice(0, 500);
      problems.push(`${t}: ${msg}`);
    }
    if (out.length >= config.streamMaxChars) break;
  }
  if (!out && problems.length > 0) {
    throw new Error(`turn produced no reply (${problems.join(" | ").slice(0, 1000)})`);
  }
  return out;
}

/** Open a session on an agent, run `fn`, always close. */
export async function withSession<T>(
  agentId: string,
  conversationId: string | undefined,
  fn: (session: any) => Promise<T>,
): Promise<T> {
  const c = await getClient();
  const session = conversationId
    ? await c.resumeSession(conversationId)
    : await c.createSession(agentId, { cwd: config.sessionCwd });
  try {
    return await fn(session);
  } finally {
    try {
      session.close();
    } catch {
      /* noop */
    }
  }
}

/** Send one turn and collect the assistant's reply text. */
export async function sendTurn(agentId: string, message: string, conversationId?: string): Promise<string> {
  return withSession(agentId, conversationId, async (session) => {
    await session.send(message);
    return collectStream(session);
  });
}
