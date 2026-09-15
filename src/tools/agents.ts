// Agent lifecycle tools: create / get / list / update / delete.
// The MCP keeps no project or default-agent state: every tool that acts on
// an existing agent takes a required agent_id straight from the request.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config, agentDefaults } from "../config.js";
import { getClient, isBridgeConfigured } from "../lettaClient.js";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ ok: true, data }) }],
});
const fail = (code: string, message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: { code, message } }) }],
  isError: true as const,
});

const agentId = z.string().min(1).describe("Agent id to act on.");

export function registerAgentTools(server: McpServer): void {
  server.tool(
    "agent_create",
    "Create a new Letta agent with persona/human memory and return its id.",
    {
      persona: z.string().optional().describe("Agent persona. Defaults to DEFAULT_PERSONA."),
      human: z.string().optional().describe("Human/user context. Defaults to DEFAULT_HUMAN."),
      name: z.string().optional(),
      description: z.string().optional(),
      model: z.string().optional().describe("Model id. Defaults to DEFAULT_MODEL (server default when empty)."),
      embedding: z.string().optional().describe("Embedding handle. Defaults to DEFAULT_EMBEDDING (server default when empty)."),
      tags: z.array(z.string()).optional(),
    },
    async (args: any) => {
      try {
        const c = await getClient();
        // Model/embedding resolution: explicit arg → agent-models.json
        // entry for args.name → DEFAULT_* env. Mapping file is optional.
        const mapped = agentDefaults(args.name);
        const model = args.model ?? mapped?.model ?? config.defaultModel;
        const embedding = args.embedding ?? mapped?.embedding ?? config.defaultEmbedding;
        const agent = await c.createAgent({
          ...(args.persona ?? config.defaultPersona ? { persona: args.persona ?? config.defaultPersona } : {}),
          ...(args.human ?? config.defaultHuman ? { human: args.human ?? config.defaultHuman } : {}),
          ...(args.name ? { name: args.name } : {}),
          ...(args.description ? { description: args.description } : {}),
          ...(model ? { model } : {}),
          ...(embedding ? { embedding } : {}),
          ...(args.tags ? { tags: args.tags } : {}),
        });
        const id = typeof agent === "string" ? agent : agent?.id ?? agent;
        return ok({ agent_id: id, agent });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "agent_get",
    "Get a single agent by id.",
    { agent_id: agentId },
    async (args: any) => {
      try {
        const c = await getClient();
        return ok(await c.agents.retrieve(args.agent_id));
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "agent_list",
    "List agents on the App Server.",
    {},
    async () => {
      try {
        const c = await getClient();
        return ok(await c.agents.list());
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "models_list",
    "List the LLM model catalog available on the App Server (no session needed). Embedding handles have no catalog endpoint and are set via DEFAULT_EMBEDDING.",
    {},
    async () => {
      try {
        const c = await getClient();
        return ok(await c.models.list());
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "agent_update",
    "Update an agent's editable fields (persona, human, name, description, model, tags). Only provided fields change.",
    {
      agent_id: agentId,
      persona: z.string().optional(),
      human: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      model: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async (args: any) => {
      try {
        const patch: Record<string, unknown> = {};
        for (const k of ["persona", "human", "name", "description", "model", "tags"]) {
          if (args[k] !== undefined) patch[k] = args[k];
        }
        if (Object.keys(patch).length === 0) return fail("invalid_request", "Nothing to update: provide at least one field.");
        const c = await getClient();
        return ok(await c.agents.update(args.agent_id, patch));
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "agent_delete",
    "Delete an agent. Requires confirm:true — the calling agent must ask the user explicitly first.",
    {
      agent_id: agentId,
      confirm: z.boolean().describe("Must be true. Deletes are irreversible."),
    },
    async (args: any) => {
      if (args.confirm !== true) {
        return fail("confirmation_required", "agent_delete requires confirm:true and explicit user approval first.");
      }
      try {
        const c = await getClient();
        await c.agents.delete(args.agent_id);
        return ok({ deleted: true, agent_id: args.agent_id });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "bridge_health",
    "Check App Server connectivity (no secrets leaked). Also reports whether the model catalog is reachable.",
    {},
    async () => {
      const base = {
        bridge_configured: isBridgeConfigured(),
        letta_url: config.lettaUrl || null,
      };
      if (!isBridgeConfigured()) return ok({ ...base, models_reachable: false });
      try {
        const c = await getClient();
        const catalog = await c.models.list();
        const count = Array.isArray((catalog as any)?.entries) ? (catalog as any).entries.length : null;
        return ok({ ...base, models_reachable: true, model_count: count });
      } catch (e) {
        return ok({ ...base, models_reachable: false, models_error: (e as Error).message });
      }
    },
  );
}
