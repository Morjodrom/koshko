# Local MCP companion

Koshko can expose the current DevTools capture to an LLM agent through an
optional local companion process. The feature is disabled by default.

```text
inspected frames -> extension service worker -> DevTools panel repository
                                             -> authenticated loopback WebSocket
                                             -> bounded companion memory
                                             -> read-only MCP tools over stdio
```

The DevTools panel, not the Manifest V3 service worker, owns the WebSocket.
Service-worker suspension therefore does not tear down the companion link. The
client reconnects with bounded backoff, resumes its session, and retries only
unacknowledged batches. Standard WebSocket is the core transport; there is no
Native Messaging dependency. Chrome and Firefox builds use the same client,
and a Safari Web Extension can reuse the transport and shared protocol.

## Security and retention

- The server binds only to literal `127.0.0.1` or `::1` and only serves
  `/bridge`.
- A 32–256 character base64url token authenticates every browser connection.
- The token is kept in extension local storage and supplied separately to the
  companion. Treat it as a local secret; extension storage is not an encrypted
  secret store.
- Capture messages are validated and size-bounded again at the bridge boundary.
- Sessions, entries, state, and cached AI logs are held only in bounded memory.
  They are not written to disk.
- MCP exposes no replay, mutation, browser-control, or page-execution tool.
- Captured page strings are untrusted data. Tool results label and delimit them
  as inert evidence, and the AI-log formatter repeats that instruction.

## Build and configure

Install and build from the repository root:

```bash
npm ci
npm run build:mcp
```

Generate one token and keep it for both sides:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Open the Koshko extension Options page, find **Local AI bridge**, and set:

1. **Enable local bridge**: on.
2. **WebSocket URL**: `ws://127.0.0.1:34717/bridge`.
3. **Authentication token**: the generated token.

Configure an MCP host to spawn the built companion. A generic stdio entry is:

```json
{
  "mcpServers": {
    "koshko": {
      "command": "node",
      "args": ["/absolute/path/to/koshko/apps/mcp-companion/dist/cli.js"],
      "env": {
        "KOSHKO_BRIDGE_TOKEN": "replace-with-the-same-token"
      }
    }
  }
}
```

The optional environment variables `KOSHKO_BRIDGE_HOST` and
`KOSHKO_BRIDGE_PORT` default to `127.0.0.1` and `34717`. A non-loopback host or
a path other than `/bridge` is rejected.

## Read-only tools

| Tool | Result |
| --- | --- |
| `koshko_list_sessions` | Available browser/tab sessions and connection status. |
| `koshko_read_trace` | A bounded chronological page of normalized entries. |
| `koshko_get_state` | The latest reconstructed state snapshot. |
| `koshko_get_entry` | One normalized entry by ID. |
| `koshko_get_ai_log` | The existing Koshko AI Log at an 8k, 16k, 32k, 64k, or full budget. |

## Manual verification

1. Build and load the Chrome extension, or run
   `npm run build:extension:firefox` and load the Firefox artifact.
2. Start the MCP host with the companion configuration above.
3. Enable the bridge in Options with the same token.
4. Open a permitted page, DevTools, and the **Koshko** panel. Emit several
   signals and one state mutation from the neutral demo.
5. Call `koshko_list_sessions`; verify one connected session appears.
6. Call `koshko_read_trace`, `koshko_get_entry`, and `koshko_get_state`; compare
   their IDs and state with the panel.
7. Call `koshko_get_ai_log` with budget `8k`; verify the text matches the panel's
   AI Log and contains the untrusted-data instruction.
8. Stop and restart the companion. Verify the panel reconnects and unacknowledged
   entries arrive once.
9. Change the token on only one side. Verify authentication fails and no capture
   data is accepted.

Automated coverage for protocol validation, authentication, reconnection,
bounded storage, tool outputs, and prompt-injection-like payloads runs under
`npm test`.
