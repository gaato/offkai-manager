import { en, type MessageKey } from './messages/en';
import { ja } from './messages/ja';

export type Locale = 'en' | 'ja';
export type MessageParams = Record<string, string | number>;
export type Translator = (key: MessageKey, params?: MessageParams) => string;

const catalogs = { en, ja } satisfies Record<Locale, Record<MessageKey, string>>;

export function normalizeLocale(raw: string | null | undefined): Locale | null {
  const base = raw?.trim().toLowerCase().split('-')[0];
  return base === 'en' || base === 'ja' ? base : null;
}

export function resolveLocale(
  query: string | null,
  cookie: string | undefined,
  acceptLanguage: string | null
): Locale {
  const direct = normalizeLocale(query) ?? normalizeLocale(cookie);
  if (direct) return direct;

  const preferences = (acceptLanguage ?? '')
    .split(',')
    .map((part, order) => {
      const [tag, ...parameters] = part.trim().split(';');
      const quality = parameters
        .map((parameter) => parameter.trim().match(/^q=(\d(?:\.\d+)?)$/i)?.[1])
        .find(Boolean);
      const q = quality === undefined ? 1 : Number(quality);
      return { locale: tag === '*' ? null : normalizeLocale(tag), q, order };
    })
    .filter((item) => item.locale && item.q > 0 && item.q <= 1)
    .sort((a, b) => b.q - a.q || a.order - b.order);

  return preferences[0]?.locale ?? 'en';
}

export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const template: string | undefined = catalogs[locale][key];
  if (!template) return `⟦${key}⟧`;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder
  );
}

export function translator(locale: Locale): Translator {
  return (key, params) => translate(locale, key, params);
}

export { en, ja };
export type { MessageKey };
