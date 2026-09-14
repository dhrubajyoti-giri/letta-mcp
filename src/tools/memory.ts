// Memory tools backed solely by the Letta App Server (single source of truth).
// Each tool takes an optional agent_id (+ optional project for mapping lookup).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config, resolveAgentId } from "../config.js";
import { getClient, withSession, sendTurn } from "../lettaClient.js";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ ok: true, data }) }],
});
const fail = (code: string, message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: { code, message } }) }],
  isError: true as const,
});

const agentIdParam = z.string().optional().describe("Agent id. Falls back to project mapping then DEFAULT_LETTA_AGENT_ID.");
const projectParam = z.string().optional().describe("Project key for AGENTS_FILE override lookup.");

export function registerMemoryTools(server: McpServer): void {
  server.tool(
    "memory_save",
    "Save a long-term fact to the agent's memory. Returns what the agent stored.",
    {
      agent_id: agentIdParam,
      project: projectParam,
      text: z.string().min(1).describe("The fact to remember."),
      tags: z.array(z.string()).optional().describe("Optional tags, e.g. [\"preferences\",\"project-x\"]."),
    },
    async (args: any) => {
      try {
        const id = await resolveAgentId(args.agent_id, args.project);
        const tags = args.tags?.length ? ` (tags: ${args.tags.join(", ")})` : "";
        const reply = await sendTurn(id, `Remember this long-term fact${tags}: ${args.text}`);
        return ok({ saved: true, agent_id: id, tags: args.tags ?? [], detail: reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "memory_search",
    "Search the agent's long-term memory and get a concise answer.",
    {
      agent_id: agentIdParam,
      project: projectParam,
      query: z.string().min(1).describe("What to recall."),
      top_k: z.number().int().min(1).max(20).optional().describe("Max items to consider. Defaults to DEFAULT_TOP_K."),
    },
    async (args: any) => {
      try {
        const id = await resolveAgentId(args.agent_id, args.project);
        const topK = args.top_k ?? config.defaultTopK;
        const reply = await sendTurn(
          id,
          `Search your long-term memory and answer concisely (consider at most ${topK} relevant items): ${args.query}`,
        );
        return ok({ agent_id: id, query: args.query, top_k: topK, answer: reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "memory_get",
    "Get the agent's core memory blocks (persona, human, custom).",
    { agent_id: agentIdParam, project: projectParam },
    async (args: any) => {
      try {
        const id = await resolveAgentId(args.agent_id, args.project);
        const c = await getClient();
        // Prefer a direct read; fall back to asking the agent.
        try {
          const agent = await c.agents.retrieve(id);
          const blocks = (agent as any)?.memory ?? (agent as any)?.memory_blocks ?? (agent as any)?.blocks;
          if (blocks) return ok({ agent_id: id, blocks });
        } catch {
          /* fall through to session read */
        }
        const detail = await withSession(id, undefined, async (session) => {
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
        return ok({ agent_id: id, ...(typeof detail === "object" ? detail : { raw: detail }) });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "memory_update_block",
    "Update one core memory block (e.g. label 'human') on the agent.",
    {
      agent_id: agentIdParam,
      project: projectParam,
      label: z.string().min(1).describe("Block label, e.g. 'persona' or 'human'."),
      value: z.string().min(1).describe("New block content."),
    },
    async (args: any) => {
      try {
        const id = await resolveAgentId(args.agent_id, args.project);
        const reply = await sendTurn(id, `Update your core memory block [${args.label}] to exactly: ${args.value}`);
        return ok({ updated: true, agent_id: id, label: args.label, detail: reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "memory_delete",
    "Delete one item from the agent's long-term memory by describing it (id, label, or quoted text).",
    {
      agent_id: agentIdParam,
      project: projectParam,
      id: z.string().min(1).describe("Memory item reference: id, block label, or identifying text."),
    },
    async (args: any) => {
      try {
        const id = await resolveAgentId(args.agent_id, args.project);
        const reply = await sendTurn(id, `Delete this from your long-term memory: ${args.id}. Confirm what was removed.`);
        return ok({ deleted: true, agent_id: id, ref: args.id, detail: reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );
}