// Agent lifecycle tools: create / get / list / update / delete.
// Every tool accepts an optional agent_id; resolution order is
// explicit param -> AGENTS_FILE project mapping -> DEFAULT_LETTA_AGENT_ID.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config, resolveAgentId } from "../config.js";
import { getClient, isBridgeConfigured } from "../lettaClient.js";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ ok: true, data }) }],
});
const fail = (code: string, message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: { code, message } }) }],
  isError: true as const,
});

const agentIdParam = z.string().optional().describe("Agent id. Falls back to project mapping then DEFAULT_LETTA_AGENT_ID.");
const projectParam = z.string().optional().describe("Project key for AGENTS_FILE override lookup.");

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
      tags: z.array(z.string()).optional(),
    },
    async (args: any) => {
      try {
        const c = await getClient();
        const agent = await c.createAgent({
          persona: args.persona ?? config.defaultPersona,
          ...(args.human ?? config.defaultHuman ? { human: args.human ?? config.defaultHuman } : {}),
          ...(args.name ? { name: args.name } : {}),
          ...(args.description ? { description: args.description } : {}),
          ...(args.model ?? config.defaultModel ? { model: args.model ?? config.defaultModel } : {}),
          ...(args.tags ? { tags: args.tags } : {}),
        });
        const agentId = typeof agent === "string" ? agent : agent?.id ?? agent;
        return ok({ agent_id: agentId, agent });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "agent_get",
    "Get a single agent by id (defaults via agent resolution order).",
    { agent_id: agentIdParam, project: projectParam },
    async (args: any) => {
      try {
        const id = await resolveAgentId(args.agent_id, args.project);
        const c = await getClient();
        return ok(await c.agents.retrieve(id));
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
    "agent_update",
    "Update an agent's editable fields (persona, human, name, description, model, tags). Only provided fields change.",
    {
      agent_id: agentIdParam,
      project: projectParam,
      persona: z.string().optional(),
      human: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      model: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async (args: any) => {
      try {
        const id = await resolveAgentId(args.agent_id, args.project);
        const patch: Record<string, unknown> = {};
        for (const k of ["persona", "human", "name", "description", "model", "tags"]) {
          if (args[k] !== undefined) patch[k] = args[k];
        }
        if (Object.keys(patch).length === 0) return fail("invalid_request", "Nothing to update: provide at least one field.");
        const c = await getClient();
        return ok(await c.agents.update(id, patch));
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "agent_delete",
    "Delete an agent. Requires confirm:true — the calling agent must ask the user explicitly first.",
    {
      agent_id: agentIdParam,
      project: projectParam,
      confirm: z.boolean().describe("Must be true. Deletes are irreversible."),
    },
    async (args: any) => {
      if (args.confirm !== true) {
        return fail("confirmation_required", "agent_delete requires confirm:true and explicit user approval first.");
      }
      try {
        const id = await resolveAgentId(args.agent_id, args.project);
        const c = await getClient();
        await c.agents.delete(id);
        return ok({ deleted: true, agent_id: id });
      } catch (e) {
        return fail("bridge_error", (e as Error).message);
      }
    },
  );

  server.tool(
    "bridge_health",
    "Check App Server connectivity and default-agent configuration (no secrets leaked).",
    {},
    async () => {
      let defaultAgent: string | null = null;
      try {
        defaultAgent = await resolveAgentId();
      } catch {
        defaultAgent = null;
      }
      return ok({
        bridge_configured: isBridgeConfigured(),
        letta_url: config.lettaUrl || null,
        default_agent_resolved: Boolean(defaultAgent),
      });
    },
  );
}
