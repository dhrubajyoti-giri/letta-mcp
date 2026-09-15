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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Best-effort parse of provider retry hints ("retry in 38.79s",
// "Please retry in 39s", "retry_after": 39). Falls back to 20s.
function retryDelayMs(message: string): number {
  const m = /retry in ([\d.]+)\s*s/i.exec(message);
  if (m) return Math.min(Math.ceil(parseFloat(m[1]) * 1000) + 2000, 65000);
  return 20000;
}

function isRateLimit(e: unknown): boolean {
  const s = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /429|rate.?limit|RESOURCE_EXHAUSTED|quota exceeded/i.test(s);
}

/** Send one turn and collect the assistant's reply text. */
export async function sendTurn(agentId: string, message: string, conversationId?: string): Promise<string> {
  // Free-tier pools throttle under burst load; retry rate limits twice
  // with the provider's own backoff hint instead of failing loudly.
  // Each attempt opens a fresh session, so a throttled send is never
  // half-applied to a reused conversation.
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await withSession(agentId, conversationId, async (session) => {
        await session.send(message);
        return collectStream(session);
      });
    } catch (e) {
      lastError = e;
      if (attempt < 3 && isRateLimit(e)) {
        await sleep(retryDelayMs(e instanceof Error ? e.message : String(e)));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}
