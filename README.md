# letta-appserver-mcp

Granular MCP server (Streamable HTTP) for the **Letta App Server** (`:4500`).
Letta is the single source of truth for memory — no local fallback.

## Tools (11)

Agents: `agent_create`, `agent_get`, `agent_list`, `agent_update`,
`agent_delete` (requires `confirm:true`), `bridge_health`.

Memory: `memory_save`, `memory_search`, `memory_get`,
`memory_update_block`, `memory_delete`.

Every agent/memory tool accepts optional `agent_id` (+ optional `project`).
Resolution: explicit `agent_id` → `AGENTS_FILE` project mapping →
`AGENTS_FILE` default → `DEFAULT_LETTA_AGENT_ID` → clear error.

All responses are a strict envelope:
`{ok:true, data:{…}}` or `{ok:false, error:{code, message}}`.

## Setup — full stack (App Server + MCP, one command)

```bash
cp .env.example .env        # set LETTA_APP_SERVER_TOKEN + ANTHROPIC_API_KEY
cp agents.json.example agents.json  # required for the mount, may stay placeholder
docker compose up -d
curl http://127.0.0.1:4500/readyz   # App Server (letta-code image)
curl http://127.0.0.1:6507/healthz  # MCP server
```

`docker-compose.yml` runs the App Server straight from the prebuilt
`ghcr.io/letta-ai/letta-code` image (same `letta server` startup as the
official `letta-app-server-deploy` repo) alongside this MCP, on a shared
network with persistent `letta-state` / `letta-workspace` volumes. Pin it
with `LETTA_CODE_VERSION`. All ports, tokens, and limits come from `.env`
— see `.env.example`.

`agents.json` is an optional project→agent map (`cp agents.json.example
agents.json`; it must exist for the compose mount but may stay placeholder).
`SESSION_CWD=/workspace` is the directory sessions work in — a persistent
volume where the agent reads/writes files during turns.

## Setup — MCP alone (against an existing App Server)

```bash
cp .env.example .env        # set LETTA_APP_SERVER_URL=http://127.0.0.1:4500 + TOKEN
cp agents.json.example agents.json  # optional
npm install
npm run build
npm start                   # $MCP_HOST:$MCP_PORT/mcp, GET /healthz
```

## OpenCode wiring (HTTP)

```json
{ "mcp": { "letta-mcp": { "type": "remote", "url": "http://localhost:6507/mcp", "enabled": true } } }
```

## Config

Everything is env-driven — see `.env.example`. No ports, URLs, timeouts,
limits, or default prompt text are hardcoded in `src/`.
Model provider keys live on the App Server, never here.
