import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { KoshkoToolHandlers, READ_ONLY_TOOLS } from './tools';

export function createMcpServer(handlers: KoshkoToolHandlers): Server {
  const server = new Server(
    { name: 'koshko-mcp-companion', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: READ_ONLY_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => (
    handlers.call(request.params.name, request.params.arguments ?? {})
  ));
  return server;
}

export async function runMcpStdio(handlers: KoshkoToolHandlers): Promise<void> {
  const server = createMcpServer(handlers);
  await server.connect(new StdioServerTransport());
}
