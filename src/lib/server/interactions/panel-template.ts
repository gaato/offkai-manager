import { escapeMarkdown } from '@discordjs/formatters';
import { panelVariables, type PanelVariable } from '$lib/shared/panel-template';

// Built from the shared list so a new variable cannot be accepted by validation but left raw here.
const variablePattern = () => new RegExp(`\\{(${panelVariables.join('|')})\\}`, 'g');
// Generated internally (Discord timestamps and catalog text), never organizer input.
const trustedVariables: readonly PanelVariable[] = [
  'payment_opens',
  'payment_due',
  'overdue_rule',
  'additional_opens'
];

/** Replace once: organizer-controlled values cannot inject another variable or mention. */
export function renderPanelTemplate(
  template: string,
  values: Partial<Record<PanelVariable, string>>
): string {
  const value = (key: PanelVariable) => values[key] ?? '';
  return template
    .split(/\r?\n/)
    .filter((line) => {
      const variables = [...line.matchAll(variablePattern())];
      return (
        variables.length === 0 ||
        variables.some((match) => value(match[1] as PanelVariable).trim() !== '')
      );
    })
    .map((line) =>
      line.replace(variablePattern(), (_, key: PanelVariable) => {
        const substituted = value(key);
        if (trustedVariables.includes(key)) return substituted;
        return escapeMarkdown(substituted).replace(/@/g, '@\u200b').replace(/</g, '<\u200b');
      })
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
