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
import {
  getDiscordSetup,
  applyDiscordLayout,
  DiscordLayoutError
} from '$lib/server/domain/discord/setup';
import {
  basePermissions,
  botAuthorizationUrl,
  layoutPermissions,
  roleAssignable
} from '$lib/server/domain/discord/permissions';
import { unknownPanelVariables } from '$lib/shared/panel-template';
import {
  EventError,
  updateSettings,
  getPanelTemplates,
  updatePanelTemplates
} from '$lib/server/domain/events';
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
      (value) => (value === '' || value === undefined || value === null ? null : Number(value)),
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
      announcementChannelId: z
        .string()
        .trim()
        .regex(/^(?:|\d{17,20})$/, t('discord_settings.validation_id')),
      staffRoleId: z
        .string()
        .trim()
        .regex(/^(?:|\d{17,20})$/, t('discord_settings.validation_id')),
      logChannelId: z
        .string()
        .trim()
        .regex(/^(?:|\d{17,20})$/, t('discord_settings.validation_id')),
      notificationChannelId: z
        .string()
        .trim()
        .regex(/^(?:|\d{17,20})$/, t('discord_settings.validation_id')),
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

function templateSchema(t: App.Locals['t']) {
  const body = z
    .string()
    .max(10_000, t('form.validation_too_long', { max: 10_000 }))
    .refine((value) => unknownPanelVariables(value).length === 0, t('panel_template.unknown'));
  return z.object({ panelTemplateJa: body, panelTemplateEn: body });
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
  const client = getDatabaseClient(config);
  let setupError = false;
  const setup = await getDiscordSetup(
    client,
    createDiscordGateway(config.discord.botToken, {
      tuning: config.tuning,
      baseUrl: config.discord.setupApiUrl
    }),
    session.userId,
    item.id
  ).catch((cause: unknown) => {
    if (cause instanceof OrganizationError || cause instanceof DiscordSettingsError) throw cause;
    setupError = true;
    locals.logger.warn(
      { error_name: cause instanceof Error ? cause.name : 'UnknownError' },
      'Discord setup lookup failed'
    );
    return { resources: null, missing: null, layout: null };
  });
  const guildId = discordSettings.integration?.guildId ?? '';
  const clientId = config.discord.applicationId || config.discord.clientId;
  return {
    setup,
    setupError,
    unassignableRoleIds: setup.resources
      ? setup.resources.roles
          .filter(
            (role) =>
              !roleAssignable(
                setup.resources!.guildId,
                role,
                setup.resources!.botRoleIds,
                setup.resources!.roles
              )
          )
          .map((role) => role.id)
      : [],
    inviteBotUrl: botAuthorizationUrl(clientId, guildId),
    addPermissionsUrl: botAuthorizationUrl(clientId, guildId, basePermissions),
    layoutPermissionsUrl: botAuthorizationUrl(
      clientId,
      guildId,
      basePermissions | layoutPermissions
    ),
    templateForm: await superValidate(
      getPanelTemplates(client, session.userId, item.id),
      zod4(templateSchema(locals.t))
    ),
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
        roleId: discordSettings.integration?.roleId ?? '',
        announcementChannelId: discordSettings.integration?.announcementChannelId ?? '',
        staffRoleId: discordSettings.integration?.staffRoleId ?? '',
        logChannelId: discordSettings.integration?.logChannelId ?? '',
        notificationChannelId: discordSettings.integration?.notificationChannelId ?? ''
      },
      zod4(discordSettingsSchema(locals.t))
    ),
    guildNameSnapshot: discordSettings.integration?.guildNameSnapshot ?? '',
    discordBotEnabled: Boolean(config.discord.botToken)
  };
};

export const actions: Actions = {
  templates: async (event) => {
    const session = requireSession(event);
    const form = await superValidate(event, zod4(templateSchema(event.locals.t)));
    if (!form.valid) return fail(400, { form });
    try {
      updatePanelTemplates(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        eventId: event.params.eventId,
        ...form.data
      });
      return message(form, event.locals.t('panel_template.saved'));
    } catch (cause) {
      event.locals.logger[
        cause instanceof EventError || cause instanceof OrganizationError ? 'warn' : 'error'
      ]({ err: cause }, 'panel template save failed');
      if (cause instanceof OrganizationError)
        return message(form, event.locals.t('event.error_forbidden'), { status: 403 });
      if (cause instanceof EventError && cause.code === 'validation')
        return message(form, event.locals.t('event.error_validation'), { status: 400 });
      if (cause instanceof EventError && cause.code === 'illegal_transition')
        return message(form, event.locals.t('event.error_illegal_transition'), { status: 409 });
      return message(form, event.locals.t('event.error_generic'), { status: 500 });
    }
  },
  previewLayout: async (event) => {
    const session = requireSession(event);
    const config = getConfig();
    try {
      // Preview is read-only; the apply service authorizes again immediately before claiming work.
      const setup = await getDiscordSetup(
        getDatabaseClient(config),
        createDiscordGateway(config.discord.botToken, {
          tuning: config.tuning,
          baseUrl: config.discord.setupApiUrl
        }),
        session.userId,
        event.params.eventId
      );
      if (!setup.layout) return fail(400, { layoutError: event.locals.t('discord_setup.error') });
      return { layoutPreview: setup.layout };
    } catch (cause) {
      event.locals.logger.warn({ err: cause }, 'Discord layout preview failed');
      return fail(400, { layoutError: event.locals.t('discord_setup.error') });
    }
  },
  applyLayout: async (event) => {
    const session = requireSession(event);
    const fingerprint = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .safeParse((await event.request.formData()).get('fingerprint'));
    if (!fingerprint.success)
      return fail(400, { layoutError: event.locals.t('discord_setup.changed') });
    const config = getConfig();
    try {
      await applyDiscordLayout(
        getDatabaseClient(config),
        createDiscordGateway(config.discord.botToken, {
          tuning: config.tuning,
          baseUrl: config.discord.setupApiUrl
        }),
        session.userId,
        event.params.eventId,
        fingerprint.data
      );
      return { layoutMessage: event.locals.t('discord_setup.complete') };
    } catch (cause) {
      event.locals.logger.warn({ err: cause }, 'Discord layout apply failed');
      if (cause instanceof DiscordSettingsError && cause.code === 'guild_not_managed')
        return fail(403, {
          layoutError: event.locals.t('discord_settings.error_guild_not_managed')
        });
      return fail(400, {
        layoutError: event.locals.t(
          cause instanceof DiscordLayoutError && ['busy', 'preview_changed'].includes(cause.code)
            ? 'discord_setup.changed'
            : 'discord_setup.error'
        )
      });
    }
  },
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
        createDiscordGateway(config.discord.botToken, {
          tuning: config.tuning,
          baseUrl: config.discord.setupApiUrl
        }),
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
