/** Only Discord's documented DM-block codes permit private-thread fallback. */
export function notificationRoute(
  status: number,
  code: number | string
): 'thread' | 'stop' | 'retry' {
  if (code === 10007) return 'stop';
  if (status === 403 && (code === 50007 || code === 50278)) return 'thread';
  if (status === 429 || status >= 500) return 'retry';
  return 'stop';
}
