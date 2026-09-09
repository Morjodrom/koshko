export function normalizeOrigin(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https origins can be granted.');
  }

  // Chrome match patterns cannot restrict ports. Store the permission's real
  // scheme-and-host scope so multiple ports do not create duplicate scripts.
  return `${url.protocol}//${url.hostname}`;
}

export function originToMatchPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function originToScriptId(origin: string): string {
  const suffix = originToMatchPattern(origin)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'origin';
  return `koshko-capture-${suffix}`;
}

export function matchPatternToOrigin(pattern: string): string | null {
  const match = /^(https?):\/\/([^/*]+)\/\*$/.exec(pattern);
  if (!match) {
    return null;
  }

  try {
    return normalizeOrigin(`${match[1]}://${match[2]}`);
  } catch {
    return null;
  }
}

export function normalizeOriginList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeOrigin(value)))).sort((left, right) => left.localeCompare(right));
}
