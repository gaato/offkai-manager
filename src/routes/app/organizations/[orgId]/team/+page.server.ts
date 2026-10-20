import { error, fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import {
  changeRole,
  authorizeOrganizationRole,
  disableMembership,
  enableMembership,
  inviteMember,
  listOrganizationMembers,
  OrganizationError
} from '$lib/server/domain/orgs';
import { organizationRoleSchema } from '$lib/shared/organization';

const inviteRoleOptions = ['viewer', 'staff', 'organizer'] as const;

function inviteSchema(t: App.Locals['t']) {
  return z.object({
    discordUserId: z
      .string()
      .trim()
      .regex(/^\d{17,20}$/, t('team.validation_snowflake')),
    role: z.enum(inviteRoleOptions, { error: t('team.validation_role') }).default('viewer')
  });
}

const membershipSchema = z.object({ membershipId: z.uuid() });
const roleChangeSchema = membershipSchema.extend({ role: organizationRoleSchema });
type MembershipActionInput = {
  membershipId: string;
  role?: z.infer<typeof organizationRoleSchema>;
};

export const load: PageServerLoad = async ({ locals }) => ({
  inviteForm: await superValidate(zod4(inviteSchema(locals.t)))
});

export const actions: Actions = {
  invite: async (event) => {
    const session = requireSession(event);
    const organizationId = routeOrganizationId(event.params.orgId);
    const form = await superValidate(event, zod4(inviteSchema(event.locals.t)));
    if (!form.valid) return fail(400, { form });
    try {
      await inviteMember(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        organizationId,
        discordUserId: form.data.discordUserId,
        role: form.data.role
      });
      return message(form, event.locals.t('team.invite_success'));
    } catch (cause) {
      event.locals.logger[cause instanceof OrganizationError ? 'warn' : 'error'](
        { err: cause },
        'invite organization member failed'
      );
      return message(form, domainMessage(event, cause, 'invite'), {
        status: domainStatus(cause)
      });
    }
  },
  prepareRole: async (event) => prepareAction(event, roleChangeSchema, 'role'),
  prepareDisable: async (event) => prepareAction(event, membershipSchema, 'disable'),
  prepareEnable: async (event) => prepareAction(event, membershipSchema, 'enable'),
  changeRole: async (event) => {
    const parsed = await parseAction(event, roleChangeSchema);
    if (!parsed.success) return parsed.failure;
    if (!parsed.data.role) {
      return fail(400, { actionError: event.locals.t('team.error_invalid_action') });
    }
    try {
      await changeRole(parsed.client, {
        actorUserId: parsed.session.userId,
        membershipId: parsed.data.membershipId,
        role: parsed.data.role
      });
      return { actionMessage: event.locals.t('team.role_success') };
    } catch (cause) {
      return actionFailure(event, cause);
    }
  },
  disable: async (event) => {
    const parsed = await parseAction(event, membershipSchema);
    if (!parsed.success) return parsed.failure;
    try {
      await disableMembership(parsed.client, {
        actorUserId: parsed.session.userId,
        membershipId: parsed.data.membershipId
      });
      return { actionMessage: event.locals.t('team.disable_success') };
    } catch (cause) {
      return actionFailure(event, cause);
    }
  },
  enable: async (event) => {
    const parsed = await parseAction(event, membershipSchema);
    if (!parsed.success) return parsed.failure;
    try {
      await enableMembership(parsed.client, {
        actorUserId: parsed.session.userId,
        membershipId: parsed.data.membershipId
      });
      return { actionMessage: event.locals.t('team.enable_success') };
    } catch (cause) {
      return actionFailure(event, cause);
    }
  }
};

async function prepareAction(
  event: RequestEvent,
  schema: z.ZodType<MembershipActionInput>,
  type: 'role' | 'disable' | 'enable'
) {
  const parsed = await parseAction(event, schema);
  if (!parsed.success) return parsed.failure;
  return { pendingAction: { type, ...parsed.data } };
}

async function parseAction(event: RequestEvent, schema: z.ZodType<MembershipActionInput>) {
  const session = requireSession(event);
  const organizationId = routeOrganizationId(event.params.orgId);
  const data = schema.safeParse(Object.fromEntries(await event.request.formData()));
  if (!data.success) {
    return {
      success: false as const,
      failure: fail(400, { actionError: event.locals.t('team.error_invalid_action') })
    };
  }
  const client = getDatabaseClient(getConfig());
  try {
    await client.db.transaction((tx) =>
      authorizeOrganizationRole(tx, organizationId, session.userId, 'owner')
    );
  } catch (cause) {
    event.locals.logger[cause instanceof OrganizationError ? 'warn' : 'error'](
      { err: cause },
      'authorize organization membership action failed'
    );
    return {
      success: false as const,
      failure: fail(domainStatus(cause), {
        actionError: domainMessage(event, cause, 'membership')
      })
    };
  }
  const belongsToRoute = await memberBelongsToOrganization(
    client,
    session.userId,
    organizationId,
    data.data.membershipId
  );
  if (!belongsToRoute) {
    return {
      success: false as const,
      failure: fail(404, { actionError: event.locals.t('team.error_not_found') })
    };
  }
  return { success: true as const, data: data.data, session, client };
}

async function memberBelongsToOrganization(
  client: DatabaseClient,
  actorUserId: string,
  organizationId: string,
  membershipId: string
): Promise<boolean> {
  try {
    const members = await listOrganizationMembers(client, actorUserId, organizationId);
    return members.some(({ id }) => id === membershipId);
  } catch {
    return false;
  }
}

function routeOrganizationId(raw: string): string {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw error(404);
  return parsed.data;
}

function actionFailure(event: RequestEvent, cause: unknown) {
  event.locals.logger[cause instanceof OrganizationError ? 'warn' : 'error'](
    { err: cause },
    'organization membership action failed'
  );
  return fail(domainStatus(cause), { actionError: domainMessage(event, cause, 'membership') });
}

function domainStatus(cause: unknown): 400 | 403 | 404 | 409 | 500 {
  if (!(cause instanceof OrganizationError)) return 500;
  switch (cause.code) {
    case 'validation':
      return 400;
    case 'forbidden':
      return 404;
    case 'not_found':
      return 404;
    case 'conflict':
    case 'last_owner':
      return 409;
  }
}

function domainMessage(
  event: RequestEvent,
  cause: unknown,
  context: 'invite' | 'membership'
): string {
  if (!(cause instanceof OrganizationError)) return event.locals.t('team.error_generic');
  if (cause.code === 'last_owner') return event.locals.t('team.error_last_owner');
  if (cause.code === 'forbidden') return event.locals.t('team.error_forbidden');
  if (cause.code === 'conflict') return event.locals.t('team.error_conflict');
  if (cause.code === 'not_found' && context === 'invite') {
    return event.locals.t('team.error_discord_not_found');
  }
  if (cause.code === 'not_found') return event.locals.t('team.error_not_found');
  return event.locals.t('team.error_invalid_action');
}
