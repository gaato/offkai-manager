export function sourceTreeUrl(repository: string, revision: string): string | null {
  if (!/^[0-9a-f]{40}$/i.test(revision) || !repository) return null;
  try {
    const url = new URL(repository);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return `${url.toString().replace(/\/$/, '')}/tree/${revision}`;
  } catch {
    return null;
  }
}
