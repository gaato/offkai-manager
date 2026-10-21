export const panelVariables = [
  'title',
  'date',
  'start',
  'end',
  'venue',
  'fee',
  'capacity',
  'deadline'
] as const;
export type PanelVariable = (typeof panelVariables)[number];
export function unknownPanelVariables(template: string): string[] {
  return [...template.matchAll(/\{([^{}]*)\}/g)]
    .map((match) => match[1])
    .filter((name) => !panelVariables.includes(name as PanelVariable));
}
