// Memory tools backed solely by the Letta App Server (single source of truth).
// The MCP keeps no project or default-agent state: every tool takes a
// required agent_id straight from the request.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { getClient, withSession, sendTurn } from "../lettaClient.js";
import { resolveAgentRef } from "../resolve.js";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ ok: true, data }) }],
});
const fail = (code: string, message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: { code, message } }) }],
  isError: true as const,
});

const agentId = z
  .string()
  .min(1)
  .describe("Agent id or name (names resolve live; unambiguous match required).");

export function registerMemoryTools(server: McpServer): void {
  server.tool(
    "memory_save",
    "Save a long-term fact to the agent's memory. Returns what the agent stored.",
    {
      agent_id: agentId,
      text: z.string().min(1).describe("The fact to remember."),
      tags: z.array(z.string()).optional().describe("Optional tags, e.g. [\"preferences\",\"project-x\"]."),
    },
    async (args: any) => {
      try {
        const r = await resolveAgentRef(args.agent_id);
        const tags = args.tags?.length ? ` (tags: ${args.tags.join(", ")})` : "";
        const reply = await sendTurn(r.agent_id, `Remember this long-term fact${tags}: ${args.text}`);
        return ok({ saved: true, agent_id: r.agent_id, agent_name: r.agent_name, tags: args.tags ?? [], detail: reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "memory_search",
    "Search the agent's long-term memory and get a concise answer.",
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
          `Search your long-term memory and answer concisely (consider at most ${topK} relevant items): ${args.query}`,
        );
        return ok({ agent_id: r.agent_id, agent_name: r.agent_name, query: args.query, top_k: topK, answer: reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "memory_get",
    "Get the agent's core memory blocks (persona, human, custom).",
    { agent_id: agentId },
    async (args: any) => {
      try {
        const r = await resolveAgentRef(args.agent_id);
        const c = await getClient();
        // Prefer a direct read; fall back to asking the agent.
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
    "memory_update_block",
    "Update one core memory block (e.g. label 'human') on the agent.",
    {
      agent_id: agentId,
      label: z.string().min(1).describe("Block label, e.g. 'persona' or 'human'."),
      value: z.string().min(1).describe("New block content."),
    },
    async (args: any) => {
      try {
        const r = await resolveAgentRef(args.agent_id);
        const reply = await sendTurn(
          r.agent_id,
          `Update your core memory block [${args.label}] to exactly: ${args.value}`,
        );
        return ok({ updated: true, agent_id: r.agent_id, agent_name: r.agent_name, label: args.label, detail: reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "memory_delete",
    "Delete one item from the agent's long-term memory by describing it (id, label, or quoted text).",
    {
      agent_id: agentId,
      id: z.string().min(1).describe("Memory item reference: id, block label, or identifying text."),
    },
    async (args: any) => {
      try {
        const r = await resolveAgentRef(args.agent_id);
        const reply = await sendTurn(
          r.agent_id,
          `Delete this from your long-term memory: ${args.id}. Confirm what was removed.`,
        );
        return ok({ deleted: true, agent_id: r.agent_id, agent_name: r.agent_name, ref: args.id, detail: reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );
}