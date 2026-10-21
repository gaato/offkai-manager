import type {
  APIInteractionResponse,
  APIInteractionResponseChannelMessageWithSource
} from 'discord-api-types/v10';
import { z } from 'zod';
import { systemClock } from '../clock';
import {
  autocompleteDoor,
  changeDoorCheckin,
  doorEvents,
  doorPaymentState,
  getDoorCard,
  matchReception
} from '../domain/checkin/door';
import {
  receptionStatus,
  previewReminder,
  confirmReminder
} from '../domain/notifications/reception';
import { OrganizationError } from '../domain/orgs/errors';
import { interactionContext, resolveInteractionUser } from './context';
import type { RouterDependencies } from './router';
import { ephemeralReply } from './respond';
import {
  renderDoorCard,
  renderReceptionEventPicker,
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
export type ReceptionComponentAction = ReceptionAction | 'reception_pick' | 'reception_page';
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
  values: { event?: string; who?: string; page?: string }
): Promise<APIInteractionResponseChannelMessageWithSource> {
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
    if (
      command === 'door_check' ||
      command === 'door_undo' ||
      command === 'door_cash' ||
      command === 'door_paypay'
    ) {
      const action = {
        door_check: 'check',
        door_undo: 'undo',
        door_cash: 'cash',
        door_paypay: 'paypay'
      } as const;
      return renderDoorCard(
        changeDoorCheckin(client, z.uuid().parse(values.who), actor, action[command], clock),
        context.locale
      );
    }
    const choices = doorEvents(client, actor, clock.now(), command !== 'checkin');
    // A registration choice carries its event. Re-authorize that stored event, and
    // keep an explicit event option as a strict filter rather than trusting either ID.
    if (command === 'checkin' && values.who && z.uuid().safeParse(values.who).success) {
      const card = getDoorCard(client, values.who, actor);
      if (values.event && card.event.id !== values.event)
        return ephemeralReply(context.t('door.unavailable'));
      if (!choices.some((event) => event.id === card.event.id))
        return ephemeralReply(context.t('door.unavailable'));
      return renderDoorCard(card, context.locale);
    }
    if (values.event && !choices.some((event) => event.id === values.event))
      return ephemeralReply(context.t('door.forbidden'));
    if (!choices.length) return ephemeralReply(context.t('door.forbidden'));
    const eventId = values.event ?? (choices.length === 1 ? choices[0].id : undefined);
    if (!eventId || values.page !== undefined) {
      if (command === 'checkin') return ephemeralReply(context.t('door.choose_event'));
      return renderReceptionEventPicker(choices, command, context.locale, Number(values.page ?? 0));
    }
    if (command === 'status')
      return renderReceptionStatus(
        receptionStatus(client, eventId, actor),
        context.locale,
        dependencies.publicBaseUrl
      );
    if (command === 'remind')
      return renderReminderPreview(previewReminder(client, eventId, actor, clock), context.locale);
    if (!values.who) return ephemeralReply(context.t('door.choose'));
    const selected = autocompleteDoor(client, actor, eventId, values.who);
    const card = selected.length === 1 ? selected[0].card : null;
    if (!card) return ephemeralReply(context.t('door.unavailable'));
    return renderDoorCard(card, context.locale);
  } catch (error) {
    return ephemeralReply(
      context.t(
        error instanceof OrganizationError && error.code === 'forbidden'
          ? 'door.forbidden'
          : 'door.unavailable'
      )
    );
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
    const candidates = eventValue ? events.filter((event) => event.id === eventValue) : events;
    const rows = matchReception(
      candidates.flatMap((event) => autocompleteDoor(client, actor, event.id, focused.value)),
      focused.value
    );
    return {
      type: 8,
      data: {
        choices: rows.map((row) => {
          const prefix =
            !eventValue && events.length > 1 ? `${row.card.event.title.slice(0, 20)} · ` : '';
          const state = row.card.checkin
            ? context.t('checkin.checked_in_count')
            : context.t(`checkin.payment.${doorPaymentState(row.card)}`);
          const number = String(row.number).padStart(3, '0');
          const suffix = ` — ${state}`;
          const nameBudget = 100 - prefix.length - number.length - 1 - suffix.length;
          return {
            name: `${prefix}${number} ${row.displayName.slice(0, nameBudget)}${suffix}`,
            value: row.id
          };
        })
      }
    };
  } catch {
    return { type: 8, data: { choices: [] } };
  }
}
