import { escapeMarkdown } from '@discordjs/formatters';
import type { PanelVariable } from '$lib/shared/panel-template';

/** Replace once: substituted text can never inject another template variable or mention. */
export function renderPanelTemplate(
  template: string,
  values: Record<PanelVariable, string>
): string {
  return template.replace(
    /\{(title|date|start|end|venue|fee|capacity|deadline)\}/g,
    (_, key: PanelVariable) =>
      escapeMarkdown(values[key]).replace(/@/g, '@\u200b').replace(/</g, '<\u200b')
  );
}
export function truncatePanelBody(body: string, budget: number, note: string): string {
  if (body.length <= budget) return body;
  const suffix = `…\n\n${note}`;
  return (
    body.slice(0, Math.max(0, budget - suffix.length)).replace(/[\uD800-\uDBFF]$/, '') + suffix
  );
}
