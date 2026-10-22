import { escapeMarkdown } from '@discordjs/formatters';
import type { PanelVariable } from '$lib/shared/panel-template';

/** Replace once: organizer-controlled values cannot inject another variable or mention. */
export function renderPanelTemplate(
  template: string,
  values: Partial<Record<PanelVariable, string>>
): string {
  const value = (key: PanelVariable) => values[key] ?? '';
  return template
    .split(/\r?\n/)
    .filter((line) => {
      const variables = [
        ...line.matchAll(
          /\{(title|date|start|end|venue|fee|capacity|deadline|payment_opens|payment_due|additional_opens)\}/g
        )
      ];
      return (
        variables.length === 0 ||
        variables.some((match) => value(match[1] as PanelVariable).trim() !== '')
      );
    })
    .map((line) =>
      line.replace(
        /\{(title|date|start|end|venue|fee|capacity|deadline|payment_opens|payment_due|additional_opens)\}/g,
        (_, key: PanelVariable) => {
          const substituted = value(key);
          // These values are generated internally as Discord timestamps, not organizer input.
          if (['payment_opens', 'payment_due', 'additional_opens'].includes(key))
            return substituted;
          return escapeMarkdown(substituted).replace(/@/g, '@\u200b').replace(/</g, '<\u200b');
        }
      )
    )
    .join('\n');
}
export function truncatePanelBody(body: string, budget: number, note: string): string {
  if (body.length <= budget) return body;
  const suffix = `…\n\n${note}`;
  return (
    body.slice(0, Math.max(0, budget - suffix.length)).replace(/[\uD800-\uDBFF]$/, '') + suffix
  );
}
