import type { CreateChannel, PermissionOverwrite } from './resources';
import { basePermissions, layoutPermissions, permissions } from './permissions';

export const layoutKinds = [
  'participant',
  'paid',
  'staff',
  'category',
  'announcements',
  'questions',
  'notifications',
  'staffLog'
] as const;
export type LayoutKind = (typeof layoutKinds)[number];
export interface LayoutResource {
  kind: LayoutKind;
  discordId: string;
}
export interface LayoutStep {
  kind: LayoutKind;
  name: string;
  type: 'role' | 'category' | 'channel';
}
export const recommendedLayout: readonly LayoutStep[] = [
  { kind: 'participant', name: 'offkai-participant', type: 'role' },
  { kind: 'paid', name: 'offkai-paid', type: 'role' },
  { kind: 'staff', name: 'offkai-staff', type: 'role' },
  { kind: 'category', name: 'Offkai', type: 'category' },
  { kind: 'announcements', name: 'announcements-panel', type: 'channel' },
  { kind: 'questions', name: 'questions', type: 'channel' },
  { kind: 'notifications', name: 'notifications', type: 'channel' },
  { kind: 'staffLog', name: 'staff-log', type: 'channel' }
];
/** Event-specific names also identify a pending create after a lost REST response. */
export function desiredLayout(eventId: string): LayoutStep[] {
  return recommendedLayout.map((step) => ({ ...step, name: `${step.name}-${eventId}` }));
}
/** Existing contains only recorded IDs still present in this guild, never name matches. */
export function planLayout(
  desired: readonly LayoutStep[],
  existing: readonly LayoutResource[]
): LayoutStep[] {
  return desired.filter((step) => !existing.some((resource) => resource.kind === step.kind));
}
export function layoutChannelInput(
  step: LayoutStep,
  guildId: string,
  botId: string,
  ids: Partial<Record<LayoutKind, string>>
): CreateChannel {
  const overwrite = (id: string, allow: bigint, deny = 0n, type = 0): PermissionOverwrite => ({
    id,
    type,
    allow: String(allow),
    deny: String(deny)
  });
  const visible =
    permissions.viewChannel | permissions.sendMessages | permissions.readMessageHistory;
  const privateStaff = step.kind === 'staffLog';
  const readOnly = step.kind === 'announcements' || step.kind === 'notifications';
  const channelOverwrites = [
    overwrite(guildId, 0n, permissions.viewChannel | (readOnly ? permissions.sendMessages : 0n)),
    ...(!privateStaff
      ? [
          overwrite(
            ids.participant!,
            readOnly ? permissions.viewChannel | permissions.readMessageHistory : visible,
            readOnly ? permissions.sendMessages | permissions.createPrivateThreads : 0n
          )
        ]
      : []),
    overwrite(ids.staff!, visible),
    overwrite(botId, basePermissions | layoutPermissions, 0n, 1)
  ];
  return {
    name: step.name,
    type: step.type === 'category' ? 4 : 0,
    ...(step.type === 'category' ? {} : { parent_id: ids.category! }),
    permission_overwrites: channelOverwrites
  };
}
