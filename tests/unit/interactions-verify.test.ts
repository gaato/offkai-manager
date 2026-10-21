import { beforeAll, describe, expect, it, vi } from 'vitest';
import { verifyInteraction } from '$lib/server/interactions/verify';
import { generateSigningKey, signedRequest } from '../support/interactions';

let key: Awaited<ReturnType<typeof generateSigningKey>>;
beforeAll(async () => {
  key = await generateSigningKey();
});
async function verify(request: Request, body?: string, publicKey = key.publicKeyHex) {
  return verifyInteraction(
    publicKey,
    request.headers.get('X-Signature-Ed25519'),
    request.headers.get('X-Signature-Timestamp'),
    body ?? (await request.text())
  );
}
describe('Ed25519 verification', () => {
  it('accepts a valid signature and imports the key only once', async () => {
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    expect(await verify(await signedRequest('{}', key.privateKey))).toBe(true);
    expect(await verify(await signedRequest('{}', key.privateKey))).toBe(true);
    expect(importKey).toHaveBeenCalledTimes(1);
    importKey.mockRestore();
  });
  it('rejects a tampered raw body', async () => {
    expect(await verify(await signedRequest('{}', key.privateKey), '{ }')).toBe(false);
  });
  it('rejects a tampered timestamp even inside the window', async () => {
    const request = await signedRequest('{}', key.privateKey);
    request.headers.set('X-Signature-Timestamp', String(Date.now() / 1000 - 1));
    expect(await verify(request)).toBe(false);
  });
  it.each([-301000, 301000])(
    'rejects timestamps outside the symmetric five-minute window (%i)',
    async (delta) => {
      expect(
        await verify(
          await signedRequest('{}', key.privateKey, String(Math.floor((Date.now() + delta) / 1000)))
        )
      ).toBe(false);
    }
  );
  it.each([-300, 300])('accepts the exact boundary (%i seconds)', async (delta) => {
    expect(
      await verify(await signedRequest('{}', key.privateKey, String(Date.now() / 1000 + delta)))
    ).toBe(true);
  });
  it('rejects a different public key', async () => {
    const wrong = await generateSigningKey();
    expect(await verify(await signedRequest('{}', key.privateKey), '{}', wrong.publicKeyHex)).toBe(
      false
    );
  });
  it.each([null, '', 'xx', '00', 'g'.repeat(128)])(
    'rejects malformed signatures (%s)',
    async (signature) => {
      expect(
        await verifyInteraction(key.publicKeyHex, signature, String(Date.now() / 1000), '{}')
      ).toBe(false);
    }
  );
  it.each([null, '', 'NaN', '-1', '1.5', '9'.repeat(17)])(
    'rejects malformed timestamps (%s)',
    async (timestamp) => {
      expect(await verifyInteraction(key.publicKeyHex, '00'.repeat(64), timestamp, '{}')).toBe(
        false
      );
    }
  );
});
