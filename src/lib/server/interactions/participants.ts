import { startCheckout, ownedPaymentSnapshot } from '$lib/server/domain/payments/checkout';
import { tickOnce } from '$lib/server/domain/payments/holds';
import { collectionPaymentMethods } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import type { APIInteractionResponse, APIModalSubmitInteraction } from 'discord-api-types/v10';
import { escapeMarkdown } from '@discordjs/formatters';
import { defaultTuning } from '$lib/server/config';
import { systemClock } from '$lib/server/clock';
import { read } from '$lib/server/db/client';
import {
  assertFreeEvent,
  getParticipantPanelEvent,
  PanelError,
  requireActiveRegistration
} from '$lib/server/domain/discord/panels';
import {
  clearInteractionDraft,
  loadInteractionDraft,
  saveInteractionDraft,
  type DraftKind
} from '$lib/server/domain/discord/drafts';
import { decideRegistration } from '$lib/server/domain/registrations/lifecycle';
import { createRegistration } from '$lib/server/domain/registrations/service';
import {
  getOwnedRegistration,
  withdrawRegistration
} from '$lib/server/domain/registrations/participant';
import {
  editRegistrationAnswers,
  loadOwnedAnswerData
} from '$lib/server/domain/registrations/answers';
import {
  buildRegistrationSchema,
  registrationAnswersFromData
} from '$lib/server/domain/registrations/runtime-schema';
import { RegistrationError } from '$lib/server/domain/registrations/errors';
import type { MessageKey } from '$lib/i18n';
import { resolveInteractionUser, type interactionContext } from './context';
import type { CustomAction } from './custom-id';
import {
  ModalLimitError,
  renderRegistrationModal,
  submittedAnswers,
  retainUnchangedLongAnswers
} from './modal';
import { actionButton, ephemeralCard, renderCancelConfirm, renderStatus } from './renderers';
import { ephemeralReply } from './respond';
import type { RouterDependencies } from './router';

type ParticipantAction = Exclude<
  CustomAction,
  { action: 'web' | 'soon' | import('./reception').ReceptionComponentAction }
>;
export async function participantAction(
  action: ParticipantAction,
  context: ReturnType<typeof interactionContext>,
  dependencies: RouterDependencies,
  modal?: APIModalSubmitInteraction
): Promise<APIInteractionResponse> {
  const clock = dependencies.clock ?? systemClock;
  const t = context.t;
  const minutes = Math.ceil(
    (dependencies.tuning ?? defaultTuning).OFFKAI_INTERACTION_DRAFT_TTL_SECONDS / 60
  );
  if (!context.actor) return ephemeralReply(t('interaction.unknown'));
  const client = dependencies.database();
  const user = await resolveInteractionUser(client, context.actor);
  if (user.suspended) return ephemeralReply(t('interaction.unavailable'));
  const eventId = action.args[0];
  const buildStatus = async (): Promise<APIInteractionResponse> => {
    tickOnce(client, clock.now(), dependencies.tuning);
    const current = getParticipantPanelEvent(client, eventId, context.guildId, user.userId);
    let detail = current.registration
      ? await getOwnedRegistration(client, current.registration.id, user.userId)
      : null;
    let payment = current.registration
      ? ownedPaymentSnapshot(client, current.registration.id, user.userId)
      : null;
    let checkoutUrl: string | undefined;
    if (
      current.registration &&
      payment &&
      ['pending', 'payment_pending'].includes(payment.status) &&
      ['held', 'confirmed'].includes(current.registration.status) &&
      dependencies.paymentGateway
    ) {
      try {
        const target = new URLSearchParams({
          guild: context.guildId ?? '',
          channel: context.channelId ?? '',
          lang: context.locale
        });
        checkoutUrl = await startCheckout(
          client,
          dependencies.paymentGateway,
          {
            userId: user.userId,
            registrationId: current.registration.id,
            successUrl: `${dependencies.publicBaseUrl}/checkout/done?${target}`,
            cancelUrl: `${dependencies.publicBaseUrl}/checkout/cancelled?${target}`
          },
          clock
        );
        payment = ownedPaymentSnapshot(client, current.registration.id, user.userId);
        detail = await getOwnedRegistration(client, current.registration.id, user.userId);
      } catch {
        /* Keep a Pay control so a transient failure is retryable. */
      }
    }
    const manualMethods = payment
      ? read(client, (tx) =>
          tx
            .select()
            .from(collectionPaymentMethods)
            .where(
              and(
                eq(collectionPaymentMethods.collectionId, payment!.collectionId),
                eq(collectionPaymentMethods.confirmation, 'manual'),
                eq(collectionPaymentMethods.enabled, true)
              )
            )
            .all()
            .map((m) => m.label)
        )
      : [];
    return renderStatus(
      detail,
      eventId,
      context.locale,
      payment
        ? {
            request: payment,
            checkoutUrl: checkoutUrl
              ? new URL(checkoutUrl, dependencies.publicBaseUrl).href
              : undefined,
            manualMethods
          }
        : undefined
    );
  };
  const statusCard = async (): Promise<APIInteractionResponse> => {
    if (
      dependencies.defer &&
      dependencies.editReply &&
      getParticipantPanelEvent(client, eventId, context.guildId, user.userId).event
        .paymentRequirement !== 'none'
    ) {
      dependencies.defer(async () => {
        await dependencies.editReply!(await buildStatus());
      });
      return { type: 5, data: { flags: 64 } };
    }
    return buildStatus();
  };
  try {
    tickOnce(client, clock.now(), dependencies.tuning);
    const data = getParticipantPanelEvent(client, eventId, context.guildId, user.userId);
    const active = data.registration && data.registration.status !== 'cancelled';
    // A modal submit cannot open another modal, and component buttons cannot submit answers.
    const isSubmit = action.action === 'join_submit' || action.action === 'edit_submit';
    if (isSubmit !== Boolean(modal)) return ephemeralReply(t('interaction.unknown'));
    switch (action.action) {
      case 'pay': {
        if (!active && data.registration?.holdReleased) {
          const previous = loadOwnedAnswerData(client, data.registration.id, user.userId);
          const parsed = buildRegistrationSchema(data.fields, {
            required: t('form.validation_required'),
            tooLong: (max) => t('form.validation_too_long', { max }),
            invalidOption: t('participant.invalid_option'),
            consentRequired: t('participant.consent_required')
          }).safeParse(previous);
          if (parsed.success) {
            await createRegistration(
              client,
              {
                organizationSlug: data.organizationSlug,
                eventSlug: data.event.slug,
                userId: user.userId,
                displayName: context.actor.global_name || context.actor.username,
                locale: context.locale,
                answers: registrationAnswersFromData(data.fields, parsed.data)
              },
              clock
            );
            return statusCard();
          }
        }
        if (!active)
          return participantAction({ action: 'join', args: [eventId] }, context, dependencies);
        return statusCard();
      }
      case 'status':
        return statusCard();
      case 'cancel':
        if (!active) return statusCard();
        return renderCancelConfirm(data.event, context.locale);
      case 'cancel_confirm':
        if (!active) return statusCard();
        await withdrawRegistration(
          client,
          { registrationId: requireActiveRegistration(data).id, userId: user.userId },
          clock
        );
        return statusCard();
      case 'join':
        if (active) return statusCard();
        read(client, (tx) => {
          assertFreeEvent(tx, eventId);
          decideRegistration(tx, data.event, { kind: 'none' }, { type: 'join' }, clock);
        });
        if (data.fields.length)
          return renderRegistrationModal(
            eventId,
            data.fields,
            context.locale,
            'join',
            loadInteractionDraft(client, user.userId, eventId, 'join', clock) ??
              loadInteractionDraft(client, user.userId, eventId, 'edit', clock) ??
              {}
          );
        await createRegistration(
          client,
          {
            organizationSlug: data.organizationSlug,
            eventSlug: data.event.slug,
            userId: user.userId,
            displayName: context.actor.global_name || context.actor.username,
            locale: context.locale,
            answers: []
          },
          clock
        );
        return statusCard();
      case 'edit': {
        if (!active) return statusCard();
        const registration = requireActiveRegistration(data);
        if (!data.fields.length) return statusCard();
        return renderRegistrationModal(
          eventId,
          data.fields,
          context.locale,
          'edit',
          loadInteractionDraft(client, user.userId, eventId, 'edit', clock) ??
            loadOwnedAnswerData(client, registration.id, user.userId)
        );
      }
      case 'retry_join':
      case 'retry_edit': {
        const kind: DraftKind = action.action === 'retry_join' ? 'join' : 'edit';
        if (kind === 'join' && active) return statusCard();
        if (!data.fields.length) {
          if (active) return statusCard();
          return participantAction({ action: 'join', args: [eventId] }, context, dependencies);
        }
        const draft = loadInteractionDraft(client, user.userId, eventId, kind, clock);
        if (!draft)
          return ephemeralCard(t('participant.expired'), [
            actionButton(
              { action: kind === 'join' ? 'join' : 'edit', args: [eventId] },
              t('participant.retry')
            )
          ]);
        return renderRegistrationModal(
          eventId,
          data.fields,
          context.locale,
          kind === 'edit' && !active ? 'join' : kind,
          draft
        );
      }
      case 'join_submit':
      case 'edit_submit': {
        const kind: DraftKind = action.action === 'join_submit' ? 'join' : 'edit';
        if (kind === 'join' && active) return statusCard();
        const submitted = submittedAnswers(modal!, data.fields);
        const answers =
          kind === 'edit' && active
            ? retainUnchangedLongAnswers(
                data.fields,
                submitted,
                loadOwnedAnswerData(client, requireActiveRegistration(data).id, user.userId)
              )
            : submitted;
        try {
          const parsed = buildRegistrationSchema(data.fields, {
            required: t('form.validation_required'),
            tooLong: (max) => t('form.validation_too_long', { max }),
            invalidOption: t('participant.invalid_option'),
            consentRequired: t('participant.consent_required')
          }).safeParse(answers);
          if (!parsed.success)
            throw new RegistrationError('validation', 'invalid submitted answers', {
              cause: parsed.error
            });
          const input = registrationAnswersFromData(data.fields, parsed.data);
          if (kind === 'join') {
            read(client, (tx) => assertFreeEvent(tx, eventId));
            await createRegistration(
              client,
              {
                organizationSlug: data.organizationSlug,
                eventSlug: data.event.slug,
                userId: user.userId,
                displayName: context.actor.global_name || context.actor.username,
                locale: context.locale,
                answers: input
              },
              clock
            );
          } else {
            editRegistrationAnswers(
              client,
              {
                userId: user.userId,
                registrationId: requireActiveRegistration(data).id,
                locale: context.locale,
                answers: input
              },
              clock
            );
          }
          clearInteractionDraft(client, user.userId, eventId, kind, clock);
          if (kind === 'join') clearInteractionDraft(client, user.userId, eventId, 'edit', clock);
          return statusCard();
        } catch (cause) {
          if (cause instanceof RegistrationError && cause.code === 'duplicate') return statusCard();
          saveInteractionDraft(
            client,
            user.userId,
            eventId,
            kind,
            answers,
            clock,
            dependencies.tuning
          );
          const key = participantErrorKey(cause, true);
          const issues =
            cause instanceof RegistrationError &&
            cause.cause &&
            typeof cause.cause === 'object' &&
            'issues' in cause.cause &&
            Array.isArray(cause.cause.issues)
              ? cause.cause.issues
              : [];
          const hints = issues
            .flatMap((issue: unknown) => {
              if (
                !issue ||
                typeof issue !== 'object' ||
                !('path' in issue) ||
                !Array.isArray(issue.path) ||
                !('message' in issue) ||
                typeof issue.message !== 'string'
              )
                return [];
              const fieldKey = issue.path[0];
              const field = data.fields.find((field) => field.key === fieldKey);
              return field
                ? [`${escapeMarkdown(field.label)}: ${escapeMarkdown(issue.message)}`]
                : [];
            })
            .join('\n');
          return ephemeralCard(
            [t(key === 'participant.error' ? 'participant.invalid' : key, { minutes }), hints]
              .filter(Boolean)
              .join('\n\n'),
            [
              actionButton(
                { action: kind === 'join' ? 'retry_join' : 'retry_edit', args: [eventId] },
                t('participant.retry')
              )
            ]
          );
        }
      }
      default:
        return action satisfies never;
    }
  } catch (cause) {
    if (cause instanceof RegistrationError && cause.code === 'duplicate') return statusCard();
    return ephemeralReply(t(participantErrorKey(cause), { minutes }));
  }
}
function participantErrorKey(cause: unknown, answersSaved = false): MessageKey {
  if (cause instanceof PanelError) return `panel.${cause.code}`;
  if (cause instanceof ModalLimitError) return 'participant.form_unavailable';
  if (cause instanceof RegistrationError) {
    if (cause.code === 'not_registrable')
      return answersSaved ? 'participant.closed_saved' : 'participant.closed';
    if (cause.code === 'not_withdrawable') return 'participant.not_withdrawable';
    if (cause.code === 'validation')
      return answersSaved ? 'participant.invalid' : 'participant.error';
    if (cause.code === 'forbidden') return 'interaction.unavailable';
  }
  return 'participant.error';
}
