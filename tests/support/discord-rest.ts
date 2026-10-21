import type { RESTOptions, ResponseLike } from '@discordjs/rest';
import { createInteractionRest } from '$lib/server/interactions/rest';

export interface RestCall {
  url: string;
  method: string;
  body: unknown;
}
export function responseLike(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {}
): ResponseLike {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
  return {
    body: null,
    bodyUsed: false,
    headers: response.headers,
    ok: response.ok,
    status,
    statusText: response.statusText,
    json: () => response.json(),
    text: () => response.text(),
    arrayBuffer: () => response.arrayBuffer()
  };
}
export function recordingRest(handler?: (call: RestCall) => ResponseLike | Promise<ResponseLike>) {
  const calls: RestCall[] = [];
  const makeRequest: RESTOptions['makeRequest'] = async (url, init) => {
    const call = {
      url,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined
    };
    calls.push(call);
    return handler
      ? handler(call)
      : responseLike({ id: String(800000000000000000n + BigInt(calls.length)) });
  };
  return { rest: createInteractionRest('fake-test-token', { makeRequest }), calls };
}
