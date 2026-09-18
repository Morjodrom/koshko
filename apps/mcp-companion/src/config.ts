import { isBridgeAuthToken } from '@koshko/bridge';

export const DEFAULT_BRIDGE_HOST = '127.0.0.1';
export const DEFAULT_BRIDGE_PORT = 34717;
export const DEFAULT_BRIDGE_PATH = '/bridge';

export interface CompanionConfig {
  authToken: string;
  host: string;
  port: number;
  path: string;
  maxSessions: number;
  maxEntriesPerSession: number;
  maxEntriesTotal: number;
  maxStoredBytes: number;
  aiLogTimeoutMs: number;
}

export interface CliOptions {
  token?: string;
  host?: string;
  port?: string;
  path?: string;
}

export function createConfig(options: CliOptions = {}, environment: NodeJS.ProcessEnv = process.env): CompanionConfig {
  const authToken = options.token ?? environment.KOSHKO_BRIDGE_TOKEN;
  if (!isBridgeAuthToken(authToken)) {
    throw new Error('KOSHKO_BRIDGE_TOKEN (or --token) must be a 32+ character base64url token.');
  }

  const host = options.host ?? environment.KOSHKO_BRIDGE_HOST ?? DEFAULT_BRIDGE_HOST;
  if (!isLiteralLoopback(host)) {
    throw new Error('Bridge host must be the literal loopback address 127.0.0.1 or ::1.');
  }

  const port = parsePort(options.port ?? environment.KOSHKO_BRIDGE_PORT);
  const path = options.path ?? environment.KOSHKO_BRIDGE_PATH ?? DEFAULT_BRIDGE_PATH;
  if (path !== DEFAULT_BRIDGE_PATH) {
    throw new Error(`Bridge path must be ${DEFAULT_BRIDGE_PATH}.`);
  }

  return {
    authToken,
    host,
    port,
    path,
    maxSessions: 32,
    maxEntriesPerSession: 2_000,
    maxEntriesTotal: 10_000,
    maxStoredBytes: 16 * 1024 * 1024,
    aiLogTimeoutMs: 5_000,
  };
}

export function isLiteralLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1';
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_BRIDGE_PORT;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error('Bridge port must be an integer between 1 and 65535.');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Bridge port must be an integer between 1 and 65535.');
  }
  return port;
}
