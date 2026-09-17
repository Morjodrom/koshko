import type { JsonValue } from '@koshko/protocol';

export const EXTENSION_MESSAGE_RULES_STORAGE_KEY = 'koshko:extension-message-rules';
export const EXTENSION_MESSAGE_RULES_VERSION = 1;
export const MAX_EXTENSION_MESSAGE_RULES = 50;
export const MAX_EXTENSION_RULE_PATH_DEPTH = 4;
export const MAX_EXTENSION_RULE_TEXT_LENGTH = 160;

export type ExtensionMessageRuleOperator = 'equals' | 'starts-with' | 'exists';
export type ExtensionMessageRuleScalar = string | number | boolean | null;

export interface ExtensionMessageRule {
  id: string;
  name: string;
  enabled: boolean;
  path: string;
  operator: ExtensionMessageRuleOperator;
  value?: ExtensionMessageRuleScalar;
}

export interface ExtensionMessageRulesConfig {
  version: typeof EXTENSION_MESSAGE_RULES_VERSION;
  rules: ExtensionMessageRule[];
}

export const DEFAULT_EXTENSION_MESSAGE_RULES: readonly ExtensionMessageRule[] = [
  {
    id: 'react-devtools',
    name: 'React DevTools',
    enabled: true,
    path: 'source',
    operator: 'starts-with',
    value: 'react-devtools-',
  },
  {
    id: 'pixi-devtools',
    name: 'PIXI DevTools',
    enabled: true,
    path: 'method',
    operator: 'starts-with',
    value: 'pixi-',
  },
];

const DEFAULT_CONFIG: ExtensionMessageRulesConfig = {
  version: EXTENSION_MESSAGE_RULES_VERSION,
  rules: DEFAULT_EXTENSION_MESSAGE_RULES.map((rule) => ({ ...rule })),
};

function isScalar(value: unknown): value is ExtensionMessageRuleScalar {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EXTENSION_RULE_TEXT_LENGTH) return null;
  return value;
}

function normalizeRule(value: unknown): ExtensionMessageRule | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = sanitizeText(record.id);
  const name = sanitizeText(record.name);
  const path = sanitizeText(record.path);
  const operator = record.operator;
  if (!id || !name || !path || typeof record.enabled !== 'boolean'
    || (operator !== 'equals' && operator !== 'starts-with' && operator !== 'exists')) return null;
  const segments = path.split('.');
  if (segments.length > MAX_EXTENSION_RULE_PATH_DEPTH
    || segments.some((segment) => !/^[A-Za-z_$][\w$]*$/.test(segment))) return null;
  if (operator === 'exists') return { id, name, enabled: record.enabled, path, operator };
  const ruleValue = record.value;
  if (!isScalar(ruleValue)) return null;
  if (typeof ruleValue === 'string' && ruleValue.length > MAX_EXTENSION_RULE_TEXT_LENGTH) return null;
  if (operator === 'starts-with') {
    if (typeof ruleValue !== 'string' || ruleValue.length === 0) return null;
  }
  return { id, name, enabled: record.enabled, path, operator, value: ruleValue };
}

export function defaultExtensionMessageRulesConfig(): ExtensionMessageRulesConfig {
  return { version: DEFAULT_CONFIG.version, rules: DEFAULT_CONFIG.rules.map((rule) => ({ ...rule })) };
}

export function normalizeExtensionMessageRules(value: unknown): ExtensionMessageRulesConfig {
  if (!value || typeof value !== 'object') return defaultExtensionMessageRulesConfig();
  const record = value as Record<string, unknown>;
  if (record.version !== EXTENSION_MESSAGE_RULES_VERSION || !Array.isArray(record.rules)) {
    return defaultExtensionMessageRulesConfig();
  }
  const rules: ExtensionMessageRule[] = [];
  const ids = new Set<string>();
  for (const candidate of record.rules) {
    if (rules.length >= MAX_EXTENSION_MESSAGE_RULES) break;
    const rule = normalizeRule(candidate);
    if (rule && !ids.has(rule.id)) {
      ids.add(rule.id);
      rules.push(rule);
    }
  }
  if (record.rules.length > 0 && rules.length === 0) return defaultExtensionMessageRulesConfig();
  return { version: EXTENSION_MESSAGE_RULES_VERSION, rules };
}

export function classifyExtensionPostMessage(data: JsonValue, rules: readonly ExtensionMessageRule[]): string | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const value = readOwnPath(data, rule.path);
    if (value === MISSING) continue;
    if (rule.operator === 'exists') return rule.name;
    if (rule.operator === 'equals' && value === rule.value) return rule.name;
    if (rule.operator === 'starts-with' && typeof value === 'string' && value.startsWith(rule.value as string)) return rule.name;
  }
  return null;
}

const MISSING = Symbol('missing');

function readOwnPath(value: JsonValue, path: string): JsonValue | typeof MISSING {
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return MISSING;
    const descriptor = Object.getOwnPropertyDescriptor(current, segment);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return MISSING;
    current = descriptor.value;
  }
  return current as JsonValue;
}

export async function getStoredExtensionMessageRules(): Promise<ExtensionMessageRulesConfig> {
  const stored = await chrome.storage.local.get({
    [EXTENSION_MESSAGE_RULES_STORAGE_KEY]: defaultExtensionMessageRulesConfig(),
  });
  return normalizeExtensionMessageRules(stored[EXTENSION_MESSAGE_RULES_STORAGE_KEY]);
}

export async function setStoredExtensionMessageRules(
  config: ExtensionMessageRulesConfig | readonly ExtensionMessageRule[],
): Promise<ExtensionMessageRulesConfig> {
  const normalized = normalizeExtensionMessageRules(Array.isArray(config)
    ? { version: EXTENSION_MESSAGE_RULES_VERSION, rules: config }
    : config);
  await chrome.storage.local.set({ [EXTENSION_MESSAGE_RULES_STORAGE_KEY]: normalized });
  return normalized;
}

export function subscribeToStoredExtensionMessageRules(
  listener: (config: ExtensionMessageRulesConfig) => void,
): () => void {
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (areaName !== 'local' || !changes[EXTENSION_MESSAGE_RULES_STORAGE_KEY]) return;
    listener(normalizeExtensionMessageRules(changes[EXTENSION_MESSAGE_RULES_STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}
