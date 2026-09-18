# `@koshko/bridge`

Private shared wire contract between the Koshko DevTools panel and the local
MCP companion. It contains browser-compatible types, limits, and defensive
parsers for authenticated hello, capture batches, acknowledgements, sessions,
state snapshots, and token-budgeted AI Log requests.

This package does not open sockets or compare authentication tokens. The
extension and companion own those transport responsibilities. Captured page
content remains inert JSON data and is never used as a bridge control field.
