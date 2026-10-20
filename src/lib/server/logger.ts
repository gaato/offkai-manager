import pino from 'pino';
import type { Config } from '$lib/server/config';

let logger: pino.Logger | undefined;

export function getLogger(config: Config): pino.Logger {
  logger ??= pino({ level: config.log.level });
  return logger;
}
