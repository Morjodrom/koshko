export function normalizeOrigin(input: string): string {
  const origin = new URL(input).origin;
  if (origin === 'null') {
    throw new Error('Only http and https origins can be granted.');
  }
  return origin;
}

export function originToMatchPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function originToScriptId(origin: string): string {
  return `koshko-${origin.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'origin'}`;
}

export function normalizeOriginList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeOrigin(value)))).sort((left, right) => left.localeCompare(right));
}
