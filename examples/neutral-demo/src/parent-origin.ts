/** Resolves an explicitly configured cooperating parent origin safely. */
export function getConfiguredParentOrigin(
  search: string = location.search,
  fallback: string = location.origin,
): string {
  const configured = new URLSearchParams(search).get('parentOrigin');
  if (!configured) return fallback;
  try {
    const url = new URL(configured);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : fallback;
  } catch {
    return fallback;
  }
}
