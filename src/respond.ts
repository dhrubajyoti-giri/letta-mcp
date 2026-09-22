// Shared MCP response envelope: every tool returns
// {ok:true, data} or {ok:false, error:{code, message}}.
export const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ ok: true, data }) }],
});
export const fail = (code: string, message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: { code, message } }) }],
  isError: true as const,
});
