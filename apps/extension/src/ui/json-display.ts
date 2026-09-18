const MAX_STRINGIFIED_JSON_DEPTH = 20;

type JsonDisplayValue = null | boolean | number | string | JsonDisplayValue[] | { [key: string]: JsonDisplayValue };
type ExpansionResult = { value: unknown; safe: boolean };

function isJsonContainer(value: unknown): value is JsonDisplayValue[] | { [key: string]: JsonDisplayValue } {
  return typeof value === 'object' && value !== null;
}

function parseJsonContainer(value: string): JsonDisplayValue[] | { [key: string]: JsonDisplayValue } | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isJsonContainer(parsed) ? parsed as JsonDisplayValue[] | { [key: string]: JsonDisplayValue } : null;
  } catch {
    return null;
  }
}

function expandValue(value: unknown, depth: number): ExpansionResult {
  if (depth > MAX_STRINGIFIED_JSON_DEPTH) {
    return { value, safe: !isJsonContainer(value) };
  }
  if (typeof value === 'string') {
    if (depth >= MAX_STRINGIFIED_JSON_DEPTH) {
      return { value, safe: true };
    }
    const parsed = parseJsonContainer(value);
    if (parsed === null) {
      return { value, safe: true };
    }
    const expanded = expandValue(parsed, depth + 1);
    return expanded.safe ? expanded : { value, safe: true };
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => expandValue(item, depth + 1));
    return items.every((item) => item.safe)
      ? { value: items.map((item) => item.value), safe: true }
      : { value, safe: false };
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => [key, expandValue(item, depth + 1)] as const);
    return entries.every(([, item]) => item.safe)
      ? { value: Object.fromEntries(entries.map(([key, item]) => [key, item.value])), safe: true }
      : { value, safe: false };
  }
  return { value, safe: true };
}

export function expandStringifiedJson(value: unknown, depth = 0): unknown {
  return expandValue(value, depth).value;
}

export function formatJsonForDisplay(value: unknown, parseJsonStrings: boolean): string {
  try {
    return JSON.stringify(parseJsonStrings ? expandStringifiedJson(value) : value, null, 2);
  } catch {
    return String(value);
  }
}
