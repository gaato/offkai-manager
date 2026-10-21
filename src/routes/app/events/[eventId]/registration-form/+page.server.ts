import { error, fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  addFormPreset,
  archiveField,
  EventError,
  DiscordFormLimitError,
  formPresetKeys,
  formPresets,
  listFormFields,
  reorderField,
  upsertField
} from '$lib/server/domain/events';
import { OrganizationError } from '$lib/server/domain/orgs';
import { formFieldTypes } from '$lib/shared/registration-form';

function fieldSchema(t: App.Locals['t']) {
  return z
    .object({
      fieldId: z.preprocess(
        (value) => (value === '' || value === undefined ? undefined : value),
        z.uuid().optional()
      ),
      label: z
        .string()
        .trim()
        .min(1, t('form.validation_required'))
        .max(200, t('form.validation_too_long', { max: 200 })),
      fieldType: z.enum(formFieldTypes, { error: t('registration_form.validation_type') }),
      required: z.preprocess(
        (value) => value === true || value === 'true' || value === 'on',
        z.boolean()
      ),
      helpText: z.string().max(2_000, t('form.validation_too_long', { max: 2_000 })),
      options: z.preprocess(
        (value) => (value === undefined ? '' : value),
        z.string().max(20_000, t('form.validation_too_long', { max: 20_000 }))
      )
    })
    .superRefine((value, context) => {
      if (
        (value.fieldType === 'select' || value.fieldType === 'multiselect') &&
        parseOptionLabels(value.options).length === 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: t('registration_form.validation_options')
        });
      }
    });
}

export const load: PageServerLoad = async (event) => {
  const data = await event.parent();
  const session = requireSession(event);
  const fields = await listFormFields(
    getDatabaseClient(getConfig()),
    session.userId,
    data.event.id,
    true
  );
  const editId = z.uuid().safeParse(event.url.searchParams.get('edit'));
  const editing = editId.success
    ? fields.find((field) => field.id === editId.data && !field.archivedAt)
    : undefined;
  return {
    fields,
    presets: formPresets,
    form: await superValidate(
      {
        fieldId: editing?.id,
        label: editing?.label ?? '',
        fieldType: editing?.type ?? 'text',
        required: editing?.required ?? false,
        helpText: editing?.helpText ?? '',
        options: editing?.options.map(({ label }) => label).join('\n') ?? ''
      },
      zod4(fieldSchema(event.locals.t))
    )
  };
};

export const actions: Actions = {
  upsert: async (event) => {
    const form = await superValidate(event, zod4(fieldSchema(event.locals.t)));
    if (!form.valid) return fail(400, { form });
    const identity = actionIdentity(event);
    try {
      await upsertField(getDatabaseClient(getConfig()), {
        ...identity,
        fieldId: form.data.fieldId,
        label: form.data.label,
        type: form.data.fieldType,
        required: form.data.required,
        helpText: form.data.helpText,
        optionLabels: parseOptionLabels(form.data.options)
      });
      return message(form, event.locals.t('registration_form.success_upsert'));
    } catch (cause) {
      logMutationFailure(event, cause, 'upsert registration form field failed');
      return message(form, mutationMessage(event, cause), { status: mutationStatus(cause) });
    }
  },
  archive: async (event) => {
    const identity = actionIdentity(event);
    const fieldId = await formUuid(event, 'fieldId');
    try {
      await archiveField(getDatabaseClient(getConfig()), { ...identity, fieldId });
      return { actionMessage: event.locals.t('registration_form.success_archive') };
    } catch (cause) {
      return mutationFailure(event, cause, 'archive registration form field failed');
    }
  },
  reorder: async (event) => {
    const identity = actionIdentity(event);
    const body = await event.request.formData();
    const parsed = z
      .object({ fieldId: z.uuid(), direction: z.enum(['up', 'down']) })
      .safeParse(Object.fromEntries(body));
    if (!parsed.success) {
      return fail(400, { actionError: event.locals.t('registration_form.error_validation') });
    }
    try {
      const changed = await reorderField(getDatabaseClient(getConfig()), {
        ...identity,
        ...parsed.data
      });
      return { actionMessage: event.locals.t('registration_form.success_reorder'), changed };
    } catch (cause) {
      return mutationFailure(event, cause, 'reorder registration form field failed');
    }
  },
  preset: async (event) => {
    const identity = actionIdentity(event);
    const body = await event.request.formData();
    const parsed = z
      .object({ presetKey: z.enum(formPresetKeys) })
      .safeParse(Object.fromEntries(body));
    if (!parsed.success) {
      return fail(400, { actionError: event.locals.t('registration_form.error_validation') });
    }
    try {
      const result = await addFormPreset(getDatabaseClient(getConfig()), {
        ...identity,
        presetKey: parsed.data.presetKey,
        locale: event.locals.locale
      });
      return {
        actionMessage: event.locals.t(
          result.created ? 'registration_form.success_preset' : 'registration_form.preset_exists'
        )
      };
    } catch (cause) {
      return mutationFailure(event, cause, 'add registration form preset failed');
    }
  }
};

function actionIdentity(event: RequestEvent) {
  const session = requireSession(event);
  const eventId = z.uuid().safeParse(event.params.eventId);
  if (!eventId.success) throw error(404);
  return { actorUserId: session.userId, eventId: eventId.data };
}

async function formUuid(event: RequestEvent, name: string): Promise<string> {
  const parsed = z.uuid().safeParse((await event.request.formData()).get(name));
  if (!parsed.success) throw error(400);
  return parsed.data;
}

function parseOptionLabels(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((label) => label.trim())
    .filter(Boolean);
}

function mutationFailure(event: RequestEvent, cause: unknown, logMessage: string) {
  logMutationFailure(event, cause, logMessage);
  return fail(mutationStatus(cause), { actionError: mutationMessage(event, cause) });
}

function logMutationFailure(event: RequestEvent, cause: unknown, logMessage: string): void {
  event.locals.logger[
    cause instanceof EventError || cause instanceof OrganizationError ? 'warn' : 'error'
  ]({ err: cause }, logMessage);
}

function mutationStatus(cause: unknown): 400 | 403 | 404 | 409 | 500 {
  if (cause instanceof EventError) {
    if (cause.code === 'validation') return 400;
    if (cause.code === 'forbidden') return 403;
    if (cause.code === 'not_found') return 404;
    if (cause.code === 'illegal_transition') return 409;
  }
  if (cause instanceof OrganizationError) {
    if (cause.code === 'forbidden') return 403;
    if (cause.code === 'not_found') return 404;
    return 409;
  }
  return 500;
}

function mutationMessage(event: RequestEvent, cause: unknown) {
  if (cause instanceof DiscordFormLimitError)
    return event.locals.t(
      cause.limit === 'questions'
        ? 'registration_form.discord_limit'
        : 'registration_form.discord_options_limit'
    );
  if (cause instanceof EventError) {
    if (cause.code === 'validation') return event.locals.t('registration_form.error_validation');
    if (cause.code === 'not_found') return event.locals.t('registration_form.error_not_found');
    if (cause.code === 'illegal_transition')
      return event.locals.t('registration_form.error_frozen');
    if (cause.code === 'forbidden') return event.locals.t('registration_form.error_forbidden');
  }
  if (cause instanceof OrganizationError && cause.code === 'forbidden') {
    return event.locals.t('registration_form.error_forbidden');
  }
  return event.locals.t('registration_form.error_generic');
}
