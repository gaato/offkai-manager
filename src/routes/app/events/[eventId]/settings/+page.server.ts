import { error, fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  DiscordSettingsError,
  getEventDiscordSettings,
  updateEventDiscordSettings
} from '$lib/server/domain/discord';
import { EventError, updateSettings } from '$lib/server/domain/events';
import { createDiscordGateway } from '$lib/server/gateways/discord/rest';
import { OrganizationError } from '$lib/server/domain/orgs';
import { formatWallClockInput } from '$lib/server/time';
import { discordPolicySchema, registrationModeSchema, venueRevealSchema } from '$lib/shared/event';

const datetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function settingsSchema(t: App.Locals['t']) {
  const datetime = z.string().regex(datetimeLocal, t('event.validation_datetime'));
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, t('form.validation_required'))
      .max(200, t('form.validation_too_long', { max: 200 })),
    description: z.string().max(10_000, t('form.validation_too_long', { max: 10_000 })),
    startsAt: datetime,
    endsAt: datetime,
    capacity: z.preprocess(
      (value) => (value === '' || value === undefined ? null : Number(value)),
      z.number().int().positive(t('event.validation_capacity')).nullable()
    ),
    registrationOpensAt: datetime,
    registrationClosesAt: datetime,
    venueName: z.string().max(300, t('form.validation_too_long', { max: 300 })),
    venueAddress: z.string().max(500, t('form.validation_too_long', { max: 500 })),
    venueReveal: venueRevealSchema,
    contact: z.string().max(500, t('form.validation_too_long', { max: 500 })),
    cancellationPolicy: z.string().max(5_000, t('form.validation_too_long', { max: 5_000 })),
    registrationMode: registrationModeSchema
  });
}

function discordSettingsSchema(t: App.Locals['t']) {
  return z
    .object({
      policy: discordPolicySchema,
      guildId: z
        .string()
        .trim()
        .regex(/^(?:|\d{17,20})$/, t('discord_settings.validation_guild_id')),
      inviteUrl: z
        .string()
        .trim()
        .refine((value) => !value || /^https?:\/\//.test(value), {
          message: t('discord_settings.validation_invite_url')
        }),
      roleId: z
        .string()
        .trim()
        .regex(/^(?:|\d{17,20})$/, t('discord_settings.validation_role_id'))
    })
    .superRefine((value, context) => {
      if (value.policy === 'guild_join_required' && (!value.guildId || !value.inviteUrl)) {
        context.addIssue({
          code: 'custom',
          path: ['guildId'],
          message: t('discord_settings.validation_required_config')
        });
      }
    });
}

export const load: PageServerLoad = async (event) => {
  const data = await event.parent();
  const { locals } = event;
  const config = getConfig();
  const item = data.event;
  const session = requireSession(event);
  const discordSettings = await getEventDiscordSettings(
    getDatabaseClient(config),
    session.userId,
    item.id
  );
  return {
    timeZone: config.time.zone,
    form: await superValidate(
      {
        title: item.title,
        description: item.description,
        startsAt: formatWallClockInput(item.startsAt, config.time.zone),
        endsAt: formatWallClockInput(item.endsAt, config.time.zone),
        capacity: item.capacity,
        registrationOpensAt: formatWallClockInput(item.registrationOpensAt, config.time.zone),
        registrationClosesAt: formatWallClockInput(item.registrationClosesAt, config.time.zone),
        venueName: item.venueName,
        venueAddress: item.venueAddress,
        venueReveal: item.venueReveal,
        contact: item.contact,
        cancellationPolicy: item.cancellationPolicy,
        registrationMode: item.registrationMode
      },
      zod4(settingsSchema(locals.t))
    ),
    discordForm: await superValidate(
      {
        policy: discordSettings.policy,
        guildId: discordSettings.integration?.guildId ?? '',
        inviteUrl: discordSettings.integration?.inviteUrl ?? '',
        roleId: discordSettings.integration?.roleId ?? ''
      },
      zod4(discordSettingsSchema(locals.t))
    ),
    guildNameSnapshot: discordSettings.integration?.guildNameSnapshot ?? '',
    discordBotEnabled: Boolean(config.discord.botToken)
  };
};

export const actions: Actions = {
  settings: async (event) => {
    const session = requireSession(event);
    const eventId = z.uuid().safeParse(event.params.eventId);
    if (!eventId.success) throw error(404);
    const form = await superValidate(event, zod4(settingsSchema(event.locals.t)));
    if (!form.valid) return fail(400, { form });
    const config = getConfig();
    try {
      await updateSettings(getDatabaseClient(config), {
        actorUserId: session.userId,
        eventId: eventId.data,
        ...form.data,
        timeZone: config.time.zone
      });
      return message(form, event.locals.t('event.settings_success'));
    } catch (cause) {
      event.locals.logger[
        cause instanceof EventError || cause instanceof OrganizationError ? 'warn' : 'error'
      ]({ err: cause }, 'update event settings failed');
      const key =
        cause instanceof EventError && cause.code === 'illegal_transition'
          ? 'event.error_illegal_transition'
          : cause instanceof EventError && cause.code === 'validation'
            ? 'event.error_validation'
            : cause instanceof OrganizationError && cause.code === 'forbidden'
              ? 'event.error_forbidden'
              : 'event.error_generic';
      const status =
        cause instanceof EventError && cause.code === 'validation'
          ? 400
          : cause instanceof EventError && cause.code === 'illegal_transition'
            ? 409
            : cause instanceof OrganizationError && cause.code === 'forbidden'
              ? 403
              : 500;
      return message(form, event.locals.t(key), { status });
    }
  },
  discord: async (event) => {
    const session = requireSession(event);
    const eventId = z.uuid().safeParse(event.params.eventId);
    if (!eventId.success) throw error(404);
    const form = await superValidate(event, zod4(discordSettingsSchema(event.locals.t)));
    if (!form.valid) return fail(400, { form });
    const config = getConfig();
    try {
      await updateEventDiscordSettings(
        getDatabaseClient(config),
        createDiscordGateway(config.discord.botToken, { tuning: config.tuning }),
        {
          actorUserId: session.userId,
          eventId: eventId.data,
          ...form.data
        }
      );
      return message(form, event.locals.t('discord_settings.success'));
    } catch (cause) {
      event.locals.logger[cause instanceof DiscordSettingsError ? 'warn' : 'error'](
        { err: cause },
        'update Discord settings failed'
      );
      const key =
        cause instanceof DiscordSettingsError && cause.code === 'guild_not_managed'
          ? 'discord_settings.error_guild_not_managed'
          : cause instanceof DiscordSettingsError && cause.code === 'gateway'
            ? 'discord_settings.error_gateway'
            : cause instanceof DiscordSettingsError && cause.code === 'validation'
              ? 'discord_settings.error_validation'
              : cause instanceof DiscordSettingsError && cause.code === 'forbidden'
                ? 'event.error_forbidden'
                : 'event.error_generic';
      const status =
        cause instanceof DiscordSettingsError && cause.code === 'guild_not_managed'
          ? 403
          : cause instanceof DiscordSettingsError && cause.code === 'gateway'
            ? 502
            : cause instanceof DiscordSettingsError && cause.code === 'validation'
              ? 400
              : cause instanceof DiscordSettingsError && cause.code === 'forbidden'
                ? 403
                : 500;
      return message(form, event.locals.t(key), { status });
    }
  }
};
