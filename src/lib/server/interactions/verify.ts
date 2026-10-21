const encoder = new TextEncoder();
let cached: { hex: string; key: Promise<CryptoKey> } | undefined;

function importKey(hex: string): Promise<CryptoKey> {
  if (cached?.hex !== hex) {
    cached = {
      hex,
      key: crypto.subtle.importKey('raw', Buffer.from(hex, 'hex'), { name: 'Ed25519' }, false, [
        'verify'
      ])
    };
  }
  return cached.key;
}

export async function verifyInteraction(
  publicKey: string,
  signature: string | null,
  timestamp: string | null,
  rawBody: string,
  now = Date.now()
): Promise<boolean> {
  if (
    !/^[a-f\d]{64}$/i.test(publicKey) ||
    !signature ||
    !/^[a-f\d]{128}$/i.test(signature) ||
    !timestamp ||
    !/^\d{1,16}$/.test(timestamp)
  )
    return false;
  // Bound future timestamps too: otherwise a future-dated signature could be replayed indefinitely.
  if (Math.abs(now - Number(timestamp) * 1000) > 300_000) return false;
  try {
    return await crypto.subtle.verify(
      'Ed25519',
      await importKey(publicKey),
      Buffer.from(signature, 'hex'),
      encoder.encode(timestamp + rawBody)
    );
  } catch {
    return false;
  }
}
