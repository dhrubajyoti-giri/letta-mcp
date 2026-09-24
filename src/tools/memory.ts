// Memory tools backed solely by the Letta App Server (single source of truth).
// The MCP keeps no project or default-agent state: every tool takes a
// required agent_id straight from the request.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { getClient, withSession, sendTurn } from "../lettaClient.js";
import { resolveAgentRef } from "../resolve.js";
import { ok, fail } from "../respond.js";

const agentId = z
  .string()
  .min(1)
  .describe("Agent id or name (names resolve live; unambiguous match required).");

export function registerMemoryTools(server: McpServer): void {
  server.tool(
    "memory_save",
    "Save a long-term fact to the agent's memory. Request: {agent_id, text, tags?}. Response {ok:true, data:{saved, agent_id, agent_name, tags, detail}}. Tags are prompt-routed as '(tags: …)', not stored fields. Files the fact via a turn; the agent owns block placement.",
    {
      agent_id: agentId,
      text: z.string().min(1).describe("The fact to remember."),
      tags: z.array(z.string()).optional().describe("Optional tags, e.g. [\"preferences\",\"project-x\"]."),
    },
    async (args: any) => {
      try {
        const r = await resolveAgentRef(args.agent_id);
        const tags = args.tags?.length ? " (tags: " + args.tags.join(", ") + ")" : "";
        const reply = await sendTurn(r.agent_id, "Remember this long-term fact" + tags + ": " + args.text);
        return ok({ saved: true, agent_id: r.agent_id, agent_name: r.agent_name, tags: args.tags ?? [], detail: reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "memory_search",
    "Search the agent's long-term memory and get a concise answer. Request: {agent_id, query, top_k? (default DEFAULT_TOP_K)}. Response {ok:true, data:{agent_id, agent_name, query, top_k, answer}}. Retrieval only — reasoning happens client-side. Files nothing.",
    {
      agent_id: agentId,
      query: z.string().min(1).describe("What to recall."),
      top_k: z.number().int().min(1).max(20).optional().describe("Max items to consider. Defaults to DEFAULT_TOP_K."),
    },
    async (args: any) => {
      try {
        const r = await resolveAgentRef(args.agent_id);
        const topK = args.top_k ?? config.defaultTopK;
        const reply = await sendTurn(
          r.agent_id,
          "Search your long-term memory and answer concisely (consider at most " + topK + " relevant items): " + args.query,
        );
        return ok({ agent_id: r.agent_id, agent_name: r.agent_name, query: args.query, top_k: topK, answer: reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "memory_get",
    "Get the agent's core memory blocks (persona, human, custom). Request: {agent_id}. Response {ok:true, data:{agent_id, agent_name, blocks}}. Session-backed read: agents.retrieve carries no memory fields on this backend, so the agent reports its own blocks. Truncated at STREAM_MAX_CHARS.",
    { agent_id: agentId },
    async (args: any) => {
      try {
        const r = await resolveAgentRef(args.agent_id);
        const c = await getClient();
        try {
          const agent = r.agent ?? (await c.agents.retrieve(r.agent_id));
          const blocks = (agent as any)?.memory ?? (agent as any)?.memory_blocks ?? (agent as any)?.blocks;
          if (blocks) return ok({ agent_id: r.agent_id, agent_name: r.agent_name, blocks });
        } catch {
          /* fall through to session read */
        }
        const detail = await withSession(r.agent_id, undefined, async (session) => {
          if (typeof session.bootstrapState === "function") {
            const state = await session.bootstrapState();
            if ((state as any)?.memory) return state;
          }
          await session.send("Show your current core memory blocks (persona, human, custom) as JSON.");
          let out = "";
          for await (const m of session.stream()) {
            if (String((m as any).type) === "assistant") out += String((m as any).content ?? "");
            if (out.length >= config.streamMaxChars) break;
          }
          return { raw: out };
        });
        return ok({ agent_id: r.agent_id, agent_name: r.agent_name, ...(typeof detail === "object" ? detail : { raw: detail }) });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "memory_delete",
    "Delete one item from the agent's long-term memory by describing it (id, label, or quoted text). Request: {agent_id, id}. Response {ok:true, data:{deleted, agent_id, agent_name, ref, detail}}. Semantic removal via a turn, not a row delete.",
    {
      agent_id: agentId,
      id: z.string().min(1).describe("Memory item reference: id, block label, or identifying text."),
    },
    async (args: any) => {
      try {
        const r = await resolveAgentRef(args.agent_id);
        const reply = await sendTurn(
          r.agent_id,
          "Delete this from your long-term memory: " + args.id + ". Confirm what was removed.",
        );
        return ok({ deleted: true, agent_id: r.agent_id, agent_name: r.agent_name, ref: args.id, detail: reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );
}