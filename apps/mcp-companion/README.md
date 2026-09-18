# Koshko MCP Companion

A local-only process that receives validated Koshko capture batches at
`ws://127.0.0.1:34717/bridge` and exposes read-only MCP tools on stdio.

Set a randomly generated **base64url token of at least 32 characters** before
starting it:

```sh
KOSHKO_BRIDGE_TOKEN='replace-with-a-32-character-base64url-token' npm run start --workspace=@koshko/mcp-companion
```

The bridge only accepts literal `127.0.0.1` or `::1`, only `/bridge`, stores
bounded in-memory data, and never writes captured data to stdout or disk.
MCP stdio owns stdout, so diagnostics intentionally remain minimal and go to
stderr.
