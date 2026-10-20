import type { Locale, Translator } from '$lib/i18n';
import type { SessionData } from '$lib/server/auth/session';
import type { Logger } from 'pino';

declare global {
  namespace App {
    interface Error {
      message: string;
      requestId?: string;
    }

    interface Locals {
      locale: Locale;
      logger: Logger;
      requestId: string;
      session: SessionData | null;
      t: Translator;
    }

    interface PageData {
      locale: Locale;
    }
  }

  const __SOURCE_REPOSITORY__: string;
  const __VCS_REF__: string;
}

export {};
