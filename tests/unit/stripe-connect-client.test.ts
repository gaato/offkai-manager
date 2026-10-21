import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IStripeConnectInitParams } from '@stripe/connect-js';
import { loadConnectAndInitialize } from '@stripe/connect-js/pure';
import { initializeConnect } from '$lib/client/stripe-connect';

vi.mock('@stripe/connect-js/pure', () => ({ loadConnectAndInitialize: vi.fn() }));

class FakeScript extends EventTarget {
  src = '';
  async = false;
  remove = vi.fn();
}

describe('bounded Connect.js initialization', () => {
  let script: FakeScript;
  let append: ReturnType<typeof vi.fn>;
  let params: IStripeConnectInitParams;
  let abort: AbortController;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(loadConnectAndInitialize).mockReset();
    script = new FakeScript();
    append = vi.fn();
    params = {
      publishableKey: 'pk_test_fake',
      fetchClientSecret: vi.fn().mockResolvedValue('secret')
    };
    abort = new AbortController();
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { createElement: () => script, head: { appendChild: append } });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('rejects a blocked script once without initializing components or retrying', async () => {
    const result = initializeConnect(params, abort.signal);
    script.dispatchEvent(new Event('error'));
    await expect(result).rejects.toThrow('Failed to load Connect.js');
    await vi.runAllTimersAsync();
    expect(append).toHaveBeenCalledTimes(1);
    expect(params.fetchClientSecret).not.toHaveBeenCalled();
    expect(loadConnectAndInitialize).not.toHaveBeenCalled();
    expect(script.remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out a script that never finishes', async () => {
    const rejection = expect(initializeConnect(params, abort.signal)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(append).toHaveBeenCalledTimes(1);
    expect(script.remove).toHaveBeenCalledOnce();
  });
  it('aborts loading on unmount and removes listeners and timers', async () => {
    const result = initializeConnect(params, abort.signal);
    abort.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    script.dispatchEvent(new Event('error'));
    expect(vi.getTimerCount()).toBe(0);
    expect(script.remove).toHaveBeenCalledOnce();
    expect(params.fetchClientSecret).not.toHaveBeenCalled();
  });
  it('rejects a load event without the required Stripe global', async () => {
    const result = initializeConnect(params, abort.signal);
    script.dispatchEvent(new Event('load'));
    await expect(result).rejects.toThrow('did not initialize');
    expect(params.fetchClientSecret).not.toHaveBeenCalled();
  });
  it('initializes after loading, reuses the first secret, and fetches fresh secrets on refresh', async () => {
    const instance = { create: vi.fn(), update: vi.fn(), logout: vi.fn() };
    const init = vi.mocked(loadConnectAndInitialize).mockReturnValue(instance);
    const result = initializeConnect(params, abort.signal);
    vi.stubGlobal('window', { StripeConnect: { init: vi.fn() } });
    script.dispatchEvent(new Event('load'));
    await expect(result).resolves.toBe(instance);
    expect(script.src).toBe('https://connect-js.stripe.com/v1.0/connect.js');
    const options: IStripeConnectInitParams = init.mock.calls[0][0];
    expect(params.fetchClientSecret).toHaveBeenCalledTimes(1);
    await expect(options.fetchClientSecret()).resolves.toBe('secret');
    expect(params.fetchClientSecret).toHaveBeenCalledTimes(1);
    await expect(options.fetchClientSecret()).resolves.toBe('secret');
    expect(params.fetchClientSecret).toHaveBeenCalledTimes(2);
    expect(instance.create).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports an unavailable Account Session before creating any components', async () => {
    const init = vi.mocked(loadConnectAndInitialize);
    vi.stubGlobal('window', { StripeConnect: { init } });
    params.fetchClientSecret = vi.fn().mockRejectedValue(new Error('session unavailable'));
    await expect(initializeConnect(params, abort.signal)).rejects.toThrow('session unavailable');
    expect(init).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
  it('reports a synchronous SDK initialization error to the caller', async () => {
    vi.stubGlobal('window', { StripeConnect: { init: vi.fn() } });
    vi.mocked(loadConnectAndInitialize).mockImplementation(() => {
      throw new Error('init failed');
    });
    await expect(initializeConnect(params, abort.signal)).rejects.toThrow('init failed');
  });
});
