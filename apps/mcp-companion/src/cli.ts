#!/usr/bin/env node
import { KoshkoBridgeServer } from './bridge-server';
import { createConfig, type CliOptions } from './config';
import { runMcpStdio } from './mcp-server';
import { CaptureStore } from './store';
import { KoshkoToolHandlers } from './tools';

async function main(): Promise<void> {
  const config = createConfig(parseCli(process.argv.slice(2)));
  const store = new CaptureStore({
    maxSessions: config.maxSessions,
    maxEntriesPerSession: config.maxEntriesPerSession,
    maxEntriesTotal: config.maxEntriesTotal,
    maxStoredBytes: config.maxStoredBytes,
  });
  const bridge = new KoshkoBridgeServer({ config, store });
  await bridge.start();
  await runMcpStdio(new KoshkoToolHandlers(store, bridge));
}

function parseCli(argumentsValue: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argumentsValue.length; index += 1) {
    const argument = argumentsValue[index];
    if (argument !== '--token' && argument !== '--host' && argument !== '--port' && argument !== '--path') {
      throw new Error('Usage: koshko-mcp-companion [--token TOKEN] [--host 127.0.0.1|::1] [--port PORT] [--path /bridge]');
    }
    const value = argumentsValue[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}.`);
    }
    index += 1;
    if (argument === '--token') {
      options.token = value;
    } else if (argument === '--host') {
      options.host = value;
    } else if (argument === '--port') {
      options.port = value;
    } else {
      options.path = value;
    }
  }
  return options;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  process.stderr.write(`koshko-mcp-companion failed to start: ${message}\n`);
  process.exitCode = 1;
});
