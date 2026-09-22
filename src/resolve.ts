// Name-or-id resolution for agent references.
//
// Callers may pass a raw agent_id or a human-readable agent name. Ids confirm via
// agents.retrieve; anything else matches live against agents.list (exact
// preferred, substring fallback, error on miss/ambiguity). A 60s display-only
// id→name cache avoids a lookup per call; routing never trusts the cache —
// it only labels responses, never addresses them.
import { getClient } from "./lettaClient.js";

export interface ResolvedAgent {
  agent_id: string;
  agent_name: string | null;
  agent?: any;
}

const DISPLAY_TTL_MS = 60000;
const displayCache = new Map<string, { name: string | null; at: number }>();

export async function resolveAgentRef(ref: string): Promise<ResolvedAgent> {
  const c = await getClient();
  const cached = displayCache.get(ref);
  if (cached && Date.now() - cached.at < DISPLAY_TTL_MS) {
    // The cache only labels responses; the id must still exist before it
    // is used as a routing address (agents can be deleted at any time).
    try {
      const a: any = await c.agents.retrieve(ref);
      const id = typeof a?.id === "string" ? a.id : ref;
      const name = typeof a?.name === "string" ? a.name : cached.name;
      displayCache.set(id, { name, at: Date.now() });
      return { agent_id: id, agent_name: name, agent: a };
    } catch {
      displayCache.delete(ref);
      /* fall through to id-then-name resolution below */
    }
  }
  try {
    const a: any = await c.agents.retrieve(ref);
    const id = typeof a?.id === "string" ? a.id : ref;
    const name = typeof a?.name === "string" ? a.name : null;
    displayCache.set(id, { name, at: Date.now() });
    return { agent_id: id, agent_name: name, agent: a };
  } catch {
    /* not an id — fall through to name match */
  }
  const list = await c.agents.list();
  const arr: any[] = Array.isArray(list) ? list : (list as any)?.agents ?? [];
  const q = ref.toLowerCase();
  const exact = arr.filter((a) => String(a?.name ?? "").toLowerCase() === q);
  const pool =
    exact.length > 0
      ? exact
      : arr.filter((a) => String(a?.name ?? "").toLowerCase().includes(q));
  if (pool.length === 0) {
    throw new Error(`No agent matches ${JSON.stringify(ref)} (tried id, then name).`);
  }
  if (pool.length > 1) {
    throw new Error(
      `Ambiguous agent ref ${JSON.stringify(ref)}: ${pool.map((a) => String(a?.name ?? "?")).join(", ")}.`,
    );
  }
  const id = pool[0]?.id ?? pool[0]?.agent_id;
  const name = pool[0]?.name ?? null;
  if (typeof id !== "string") {
    throw new Error(`Matched agent has no id for ${JSON.stringify(ref)}.`);
  }
  displayCache.set(id, { name, at: Date.now() });
  return { agent_id: id, agent_name: name, agent: pool[0] };
}
