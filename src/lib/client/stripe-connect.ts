import type { IStripeConnectInitParams, StripeConnectInstance } from '@stripe/connect-js';

const scriptUrl = 'https://connect-js.stripe.com/v1.0/connect.js';
const loadTimeoutMs = 30_000;
type ConnectScript = { init: unknown };

function loadedConnect(): ConnectScript | undefined {
  const connect = (window as Window & { StripeConnect?: ConnectScript }).StripeConnect;
  return typeof connect?.init === 'function' ? connect : undefined;
}

async function loadScript(signal: AbortSignal): Promise<ConnectScript> {
  signal.throwIfAborted();
  const existing = loadedConnect();
  if (existing) return existing;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    const finish = (cause?: Error) => {
      clearTimeout(timeout);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      const connect = loadedConnect();
      if (cause || !connect) {
        script.remove();
        reject(cause ?? new Error('Connect.js did not initialize'));
      } else resolve(connect);
    };
    const onLoad = () => finish();
    const onError = () => finish(new Error('Failed to load Connect.js'));
    const onAbort = () => finish(new DOMException('Connect.js load aborted', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('Connect.js load timed out')), loadTimeoutMs);
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    document.head.appendChild(script);
  });
}

export async function initializeConnect(
  params: IStripeConnectInitParams,
  signal: AbortSignal
): Promise<StripeConnectInstance> {
  // Await loading before the SDK creates synchronous wrappers whose per-element
  // promises would otherwise reject independently, outside the caller's try/catch.
  await loadScript(signal);
  let firstSecret: string | undefined = await params.fetchClientSecret();
  const { loadConnectAndInitialize } = await import('@stripe/connect-js/pure');
  signal.throwIfAborted();
  return loadConnectAndInitialize({
    ...params,
    fetchClientSecret: async () => {
      if (firstSecret !== undefined) {
        const secret = firstSecret;
        firstSecret = undefined;
        return secret;
      }
      return params.fetchClientSecret();
    }
  });
}
