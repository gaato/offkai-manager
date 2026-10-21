import type { APIInteractionResponse } from 'discord-api-types/v10';
import { z } from 'zod';
import { systemClock } from '../clock';
import {
  autocompleteDoor,
  changeDoorCheckin,
  doorEvents,
  doorPaymentState,
  getDoorCard
} from '../domain/checkin/door';
import {
  receptionStatus,
  previewReminder,
  confirmReminder
} from '../domain/notifications/reception';
import { interactionContext, resolveInteractionUser } from './context';
import type { RouterDependencies } from './router';
import { ephemeralReply } from './respond';
import {
  renderDoorCard,
  renderReceptionStatus,
  renderReminderPreview
} from './reception-renderers';
export const receptionActions = [
  'door_check',
  'door_undo',
  'door_cash',
  'door_paypay',
  'remind_confirm'
] as const;
export type ReceptionAction = (typeof receptionActions)[number];
type Context = ReturnType<typeof interactionContext>;
async function actorFor(context: Context, dependencies: RouterDependencies) {
  if (!context.actor || !context.guildId) throw new Error('missing guild actor');
  const user = await resolveInteractionUser(dependencies.database(), context.actor);
  if (user.suspended) throw new Error('suspended');
  return { actorUserId: user.userId, guildId: context.guildId, roles: context.roles };
}
export async function receptionCommand(
  context: Context,
  dependencies: RouterDependencies,
  command: 'checkin' | 'status' | 'remind' | ReceptionAction,
  values: { event?: string; who?: string }
): Promise<APIInteractionResponse> {
  try {
    const actor = await actorFor(context, dependencies);
    const client = dependencies.database();
    const clock = dependencies.clock ?? systemClock;
    if (command === 'remind_confirm')
      return ephemeralReply(
        context.t('door.remind_sent', {
          count: confirmReminder(client, z.uuid().parse(values.who), actor, clock)
        })
      );
    if (command.startsWith('door_')) {
      const action = {
        door_check: 'check',
        door_undo: 'undo',
        door_cash: 'cash',
        door_paypay: 'paypay'
      } as const;
      return renderDoorCard(
        changeDoorCheckin(
          client,
          z.uuid().parse(values.who),
          actor,
          action[command as keyof typeof action],
          clock
        ),
        context.locale
      );
    }
    const choices = doorEvents(client, actor, clock.now(), command !== 'checkin');
    const eventId = values.event ?? (choices.length === 1 ? choices[0].id : undefined);
    if (!eventId || !choices.some((e) => e.id === eventId))
      return ephemeralReply(context.t('door.forbidden'));
    if (command === 'status')
      return renderReceptionStatus(
        receptionStatus(client, eventId, actor),
        context.locale,
        dependencies.publicBaseUrl
      );
    if (command === 'remind')
      return renderReminderPreview(previewReminder(client, eventId, actor, clock), context.locale);
    if (!values.who) return ephemeralReply(context.t('door.choose'));
    const id = z.uuid().safeParse(values.who);
    const selected = id.success
      ? getDoorCard(client, id.data, actor)
      : autocompleteDoor(client, actor, eventId, values.who);
    const card = Array.isArray(selected)
      ? selected.length === 1
        ? selected[0].card
        : null
      : selected;
    if (!card || card.event.id !== eventId) return ephemeralReply(context.t('door.unavailable'));
    return renderDoorCard(card, context.locale);
  } catch {
    return ephemeralReply(context.t('door.unavailable'));
  }
}
export async function receptionAutocomplete(
  context: Context,
  dependencies: RouterDependencies,
  focused: { name: string; value: string },
  eventValue?: string,
  organizerOnly = false
): Promise<APIInteractionResponse> {
  try {
    const actor = await actorFor(context, dependencies);
    const client = dependencies.database();
    const events = doorEvents(
      client,
      actor,
      (dependencies.clock ?? systemClock).now(),
      organizerOnly
    );
    if (focused.name === 'event')
      return {
        type: 8,
        data: {
          choices: events
            .filter((e) => e.title.toLowerCase().includes(focused.value.toLowerCase()))
            .slice(0, 25)
            .map((e) => ({ name: e.title.slice(0, 100), value: e.id }))
        }
      };
    const eventId = eventValue ?? (events.length === 1 ? events[0].id : undefined);
    if (!eventId || !events.some((e) => e.id === eventId))
      return { type: 8, data: { choices: [] } };
    return {
      type: 8,
      data: {
        choices: autocompleteDoor(client, actor, eventId, focused.value).map((row) => ({
          name: `${String(row.number).padStart(3, '0')} ${row.displayName.slice(0, 55)} — ${row.card.checkin ? context.t('checkin.checked_in_count') : context.t(`checkin.payment.${doorPaymentState(row.card)}`)}`.slice(
            0,
            100
          ),
          value: row.id
        }))
      }
    };
  } catch {
    return { type: 8, data: { choices: [] } };
  }
}
