import { REST, type RESTOptions } from '@discordjs/rest';

export function createInteractionRest(
  token: string,
  options: Pick<Partial<RESTOptions>, 'makeRequest'> = {}
): REST {
  return new REST({ ...options, version: '10', rejectOnRateLimit: () => true }).setToken(token);
}
