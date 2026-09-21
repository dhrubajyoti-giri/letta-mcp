# letta-appserver-mcp

Granular MCP server (Streamable HTTP) for the **Letta App Server** (`:4500`).
Letta is the single source of truth for memory — no local fallback.

## Tools (14)

Agents: `agent_create`, `agent_get`, `agent_list` (optional
`query`/`name`/`tags`/`limit`/`order` filters), `agent_lookup`,
`agent_update` (optional `system`/`model_settings`/
`context_window_limit`/`hidden` in addition to persona/human/name/
description/model/tags), `agent_delete` (requires `confirm:true`),
`models_list`, `bridge_health`.

Memory: `memory_save`, `memory_search` (retrieval only — you reason over
the answer), `memory_get`, `memory_update_block`, `memory_delete`.

Session: `session_ask` — reason with the agent's memory and answer.
One-shot turn, files nothing durable. Use for synthesis/advice/
explanation; use `memory_search` for retrieval.

### Request / response contracts

Every tool takes a JSON object (see its schema) and returns a strict
envelope: `{ok:true, data:{…}}` or `{ok:false, error:{code, message}}`.
`agent_id` everywhere accepts an id **or** a name.

| Tool | Request body | Response `data` |
|---|---|---|
| `agent_create` | `{persona?, human?, name?, description?, model?, embedding?, tags?}` | `{agent_id, agent_name, agent}` |
| `agent_get` | `{agent_id}` | `{…agent, agent_name}` |
| `agent_list` | `{query?, name?, tags?, limit?, order?}` | `[{…agent}]` |
| `agent_lookup` | `{name?}` | `[{agent_id, name, model, tags}]` |
| `agent_update` | `{agent_id, persona?, human?, name?, description?, model?, system?, model_settings?, context_window_limit?, hidden?, tags?}` | `{…agent, agent_name}` |
| `agent_delete` | `{agent_id, confirm:true}` | `{deleted, agent_id, agent_name}` |
| `models_list` | `{}` | catalog object |
| `bridge_health` | `{}` | `{bridge_configured, letta_url, models_reachable, model_count?}` |
| `memory_save` | `{agent_id, text, tags?}` | `{saved, agent_id, agent_name, tags, detail}` |
| `memory_search` | `{agent_id, query, top_k?}` | `{agent_id, agent_name, query, top_k, answer}` |
| `memory_get` | `{agent_id}` | `{agent_id, agent_name, blocks}` |
| `memory_update_block` | `{agent_id, label, value}` | `{updated, agent_id, agent_name, label, detail}` |
| `memory_delete` | `{agent_id, id}` | `{deleted, agent_id, agent_name, ref, detail}` |
| `session_ask` | `{agent_id, message}` | `{agent_id, agent_name, reply}` |

`memory_search` retrieves (you reason); `session_ask` reasons (it
answers); `memory_save` files. Neither ask path instructs a durable
write — "saves nothing" is a prompt contract, not a storage lock.

Every tool that acts on an agent takes a required `agent_id` — the MCP
keeps no default agent. Which project uses which agent is decided per
request by the caller; one project may use many agents.

Every `agent_id` parameter accepts an id **or a name** (`"dhruba"` works;
exact match preferred, substring fallback, errors on miss/ambiguity), and
every response echoes `agent_name` next to `agent_id`.

New sessions bootstrap ids via `agent_lookup` (compact id/name/model —
no system-prompt dump; optional name filter). `block-registry.json` in
backups is the offline id record.

`config/agent-models.json` maps agent **names** to `model` / `embedding`
handles, applied by `agent_create` when the call omits them (explicit args
always win; `DEFAULT_MODEL` / `DEFAULT_EMBEDDING` fill the rest). Edit the
file and recreate the container — no rebuild needed. Override its location
with `AGENT_MODELS_FILE`.

All responses are a strict envelope:
`{ok:true, data:{…}}` or `{ok:false, error:{code, message}}` (see the
table above for each tool's `data` shape).

## Setup — full stack (App Server + MCP, one command)

```bash
cp .env.example .env        # set LETTA_APP_SERVER_TOKEN + MCP_AUTH_TOKEN (+ model path below)
docker compose up -d
curl http://127.0.0.1:4500/readyz   # App Server (letta-code image)
curl http://127.0.0.1:6507/healthz  # MCP server
```

Zero-cost path (no API keys): install Ollama on the host, `ollama pull
qwen3`, then connect it once with `docker exec -it <app-server-container>
letta connect ollama` pointed at `http://host.docker.internal:11434`, and
pass that model in `agent_create`. Note weaker local models can behave
unexpectedly as agent drivers — prefer a tool-capable one. Paid path: set
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env` instead.

`docker-compose.yml` runs the App Server straight from the prebuilt
`ghcr.io/letta-ai/letta-code` image (same `letta server` startup as the
official `letta-app-server-deploy` repo) alongside this MCP, on a shared
network with persistent `letta-state` / `letta-workspace` volumes. Pin it
with `LETTA_CODE_VERSION` (kept compatible with
`@letta-ai/letta-agent-sdk` in `package.json`). All ports, tokens, and
limits come from `.env` — see `.env.example`.

`agent_create` accepts optional `model` / `embedding` handles, falling back
to `DEFAULT_MODEL` / `DEFAULT_EMBEDDING` (all empty by default — the server
decides when omitted). `models_list` shows the LLM catalog; embeddings have
no catalog endpoint, so set `DEFAULT_EMBEDDING` to a provider-qualified
handle. For free local embeddings: `docker compose --profile
local-embeddings up -d`, `docker exec ollama ollama pull
qwen3-embedding:0.6b`, then `OLLAMA_BASE_URL=http://ollama:11434/v1` plus
`DEFAULT_EMBEDDING=ollama/qwen3-embedding:0.6b` in `.env`.

`SESSION_CWD=/workspace` is the directory sessions work in — a persistent
volume where the agent reads/writes files during turns.

## Setup — MCP alone (against an existing App Server)

```bash
cp .env.example .env        # set LETTA_APP_SERVER_URL=http://127.0.0.1:4500 + both tokens
npm install
npm run build
npm start                   # $MCP_HOST:$MCP_PORT/mcp, GET /healthz
```

## OpenCode wiring (HTTP, authenticated)

```json
{ "mcp": { "letta-mcp": {
  "type": "remote",
  "url": "http://localhost:6507/mcp",
  "headers": { "Authorization": "Bearer {env:MCP_AUTH_TOKEN}" },
  "enabled": true } } }
```

`/mcp` requires the `MCP_AUTH_TOKEN` Bearer token (`401` without it);
`/healthz` stays open for container healthchecks. The server refuses to
start if `MCP_AUTH_TOKEN` is unset.

## Config

Everything is env-driven — see `.env.example`. No ports, URLs, timeouts,
limits, or default prompt text are hardcoded in `src/`.
Model provider keys live on the App Server, never here.
