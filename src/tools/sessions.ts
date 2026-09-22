// Ephemeral reasoning tools: ask without filing anything durable.
// Unlike memory_search (retrieval: "what do you know about X", caller
// reasons over the result), session_ask is server-side reasoning: the agent
// reasons WITH its memory and returns the finished answer. Neither tool
// instructs a durable write; "saves nothing" is a prompt contract, not a
// storage lock (the agent retains runtime agency either way).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendTurn } from "../lettaClient.js";
import { resolveAgentRef } from "../resolve.js";
import { ok, fail } from "../respond.js";

const agentId = z
  .string()
  .min(1)
  .describe("Agent id or name (names resolve live; unambiguous match required).");

export function registerSessionTools(server: McpServer): void {
  server.tool(
    "session_ask",
    "Reason with the agent's memory and answer. Request: {agent_id, message}. Response {ok:true, data:{agent_id, agent_name, reply}}. One-shot turn, files nothing durable. Use for synthesis/advice/explanation; use memory_search for retrieval.",
    {
      agent_id: agentId,
      message: z.string().min(1).describe("The question or task. Answered once; nothing is filed to memory."),
    },
    async (args: any) => {
      try {
        const r = await resolveAgentRef(args.agent_id);
        const reply = await sendTurn(r.agent_id, args.message);
        return ok({ agent_id: r.agent_id, agent_name: r.agent_name, reply });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );
}
