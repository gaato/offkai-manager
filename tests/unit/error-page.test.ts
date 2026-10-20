import { describe, expect, it, vi } from 'vitest';
import { handleError } from '../../src/hooks.server';

describe('error response sanitization', () => {
  it('logs the cause server-side without returning it to the error page', async () => {
    const logError = vi.fn();
    const cause = new Error('database password and internal row identifier');
    const result = await handleError({
      error: cause,
      status: 500,
      message: 'Internal Error',
      event: {
        locals: { requestId: '0123456789abcdef', logger: { error: logError } },
        request: new Request('https://example.test/private'),
        url: new URL('https://example.test/private')
      }
    } as never);

    expect(result).toEqual({ message: 'request failed', requestId: '0123456789abcdef' });
    expect(JSON.stringify(result)).not.toContain(cause.message);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ err: cause, status: 500, path: '/private' }),
      'request error'
    );
  });
});
