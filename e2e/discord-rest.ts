import { createServer } from 'node:http';
import { e2eUsers } from './fixtures';
import { fakeDiscordFetch } from '../tests/support/discord-setup';

/** Test-only HTTP transport. No request is ever forwarded to Discord. */
export async function startFakeDiscord() {
  const fake = fakeDiscordFetch();
  fake.control.ownerId = e2eUsers.sweepOwner;
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await fake.fetch(`http://127.0.0.1${request.url}`, {
        method: request.method,
        ...(chunks.length ? { body: Buffer.concat(chunks).toString() } : {})
      });
      response.writeHead(result.status, { 'Content-Type': 'application/json' });
      response.end(await result.text());
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fake Discord address missing');
  return {
    url: `http://127.0.0.1:${address.port}/api/v10`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}
