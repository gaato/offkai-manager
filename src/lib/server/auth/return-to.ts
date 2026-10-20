const DEFAULT_RETURN_TO = '/app';

export function safeReturnTo(raw: string | null | undefined): string {
  if (
    !raw ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    raw.includes('\r') ||
    raw.includes('\n')
  ) {
    return DEFAULT_RETURN_TO;
  }
  try {
    const parsed = new URL(raw, 'https://offkai.invalid');
    if (parsed.origin !== 'https://offkai.invalid') return DEFAULT_RETURN_TO;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}
