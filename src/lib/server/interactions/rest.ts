import { REST, type RESTOptions } from '@discordjs/rest';

export function createInteractionRest(
  token: string,
  options: Pick<Partial<RESTOptions>, 'makeRequest' | 'timeout'> = {}
): REST {
  return new REST({
    ...options,
    version: '10',
    rejectOnRateLimit: (data) => !data.route.startsWith('/webhooks/')
  }).setToken(token);
}

let runtimeRest: { token: string; timeout: number | undefined; rest: REST } | undefined;

/** Share rate-limit buckets across requests instead of constructing a client per click. */
export function getInteractionRest(token: string, timeout?: number): REST {
  if (!runtimeRest || runtimeRest.token !== token || runtimeRest.timeout !== timeout)
    runtimeRest = {
      token,
      timeout,
      rest: createInteractionRest(token, timeout === undefined ? {} : { timeout })
    };
  return runtimeRest.rest;
}
