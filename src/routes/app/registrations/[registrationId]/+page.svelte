<script lang="ts">
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { auditActionLabelKey } from '$lib/shared/audit';
  import { registrationStatusLabelKey } from '$lib/shared/registration';
  import { Alert } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  type ActionResult = { actionError?: string } | null;
  let { data, form: rawActionResult } = $props();
  const t = $derived(translator(data.locale));
  const actionResult = $derived(rawActionResult as ActionResult);
  const participantsHref = $derived(
    resolve('/app/events/[eventId]/participants', { eventId: data.event.id })
  );
  const cancelHref = $derived(
    resolve('/app/registrations/[registrationId]/cancel', {
      registrationId: data.registration.id
    })
  );
  const canConfirm = $derived(
    data.registration.status === 'applied' || data.registration.status === 'waitlisted'
  );
  const canWaitlist = $derived(
    data.registration.status === 'applied' || data.registration.status === 'confirmed'
  );
  const canCancel = $derived(data.registration.status !== 'cancelled');
</script>

<svelte:head
  ><title>{t('admin_registration.title')} · {data.event.title} · {t('brand.name')}</title
  ></svelte:head
>

<div class="mx-auto grid max-w-4xl gap-6">
  <header>
    <a
      class="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center font-semibold"
      href={participantsHref}>{t('admin_registration.back')}</a
    >
    <h1 class="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
      {t('admin_registration.title')}
    </h1>
    <p class="text-muted-foreground mt-2">{data.event.title}</p>
  </header>

  {#if actionResult?.actionError}
    <Alert class="border-destructive text-destructive" role="alert"
      >{actionResult.actionError}</Alert
    >
  {:else if data.changed}
    <Alert role="status">{t(`admin_registration.success.${data.changed}`)}</Alert>
  {/if}

  <Card class="shadow-none">
    <CardHeader>
      <CardTitle>{t('admin_registration.identity')}</CardTitle>
    </CardHeader>
    <CardContent>
      <dl class="grid gap-4 sm:grid-cols-2">
        <div>
          <dt class="text-muted-foreground text-sm">{t('participants.display_name')}</dt>
          <dd class="mt-1 font-semibold">{data.registration.displayNameSnapshot}</dd>
        </div>
        <div>
          <dt class="text-muted-foreground text-sm">{t('participants.username')}</dt>
          <dd class="mt-1">{data.username || t('participants.username_missing')}</dd>
        </div>
        <div>
          <dt class="text-muted-foreground text-sm">{t('participants.status')}</dt>
          <dd class="mt-1">
            <Badge class="bg-secondary text-secondary-foreground"
              >{t(registrationStatusLabelKey(data.registration.status))}</Badge
            >
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground text-sm">{t('participants.registered_at')}</dt>
          <dd class="mt-1">{data.registeredAtLabel}</dd>
        </div>
      </dl>
    </CardContent>
  </Card>

  <Card class="shadow-none">
    <CardHeader><CardTitle>{t('admin_registration.answers')}</CardTitle></CardHeader>
    <CardContent>
      {#if data.answers.length === 0}
        <p class="text-muted-foreground">{t('admin_registration.answers_empty')}</p>
      {:else}
        <dl class="grid gap-5">
          {#each data.answers as answer, index (`${answer.label}-${index}`)}
            <div>
              <dt class="font-semibold">{answer.label}</dt>
              <dd class="mt-1 whitespace-pre-wrap">
                {#if answer.type === 'select' || answer.type === 'multiselect'}
                  {answer.optionLabels.join(', ')}
                {:else if answer.type === 'checkbox' || answer.type === 'consent'}
                  {answer.valueBool ? t('registration.answer_yes') : t('registration.answer_no')}
                {:else}
                  {answer.valueText}
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
      {/if}
    </CardContent>
  </Card>

  <Card class="shadow-none">
    <CardHeader><CardTitle>{t('admin_registration.actions')}</CardTitle></CardHeader>
    <CardContent>
      {#if !data.canMutate}
        <p class="text-muted-foreground">{t('admin_registration.actions_read_only')}</p>
      {:else if !canConfirm && !canWaitlist && !canCancel}
        <p class="text-muted-foreground">{t('admin_registration.no_actions')}</p>
      {:else}
        <div class="flex flex-wrap gap-3">
          {#if canConfirm}
            <form method="POST" action="?/confirm">
              <Button type="submit">{t('admin_registration.confirm')}</Button>
            </form>
          {/if}
          {#if canWaitlist}
            <form method="POST" action="?/waitlist">
              <Button type="submit" variant="outline">{t('admin_registration.waitlist')}</Button>
            </form>
          {/if}
          {#if canCancel}
            <a
              class="border-destructive text-destructive hover:bg-destructive/10 inline-flex min-h-11 items-center rounded-md border px-4 font-semibold"
              href={cancelHref}>{t('admin_registration.cancel')}</a
            >
          {/if}
        </div>
      {/if}
    </CardContent>
  </Card>

  <Card class="shadow-none">
    <CardHeader><CardTitle>{t('admin_registration.audit')}</CardTitle></CardHeader>
    <CardContent>
      {#if data.audits.length === 0}
        <p class="text-muted-foreground">{t('admin_registration.audit_empty')}</p>
      {:else}
        <ol class="grid list-none gap-4">
          {#each data.audits as audit (audit.id)}
            <li class="border-b pb-4 last:border-0 last:pb-0">
              <p class="font-semibold">{t(auditActionLabelKey(audit.action))}</p>
              {#if audit.beforeStatus && audit.afterStatus}
                <p class="text-muted-foreground mt-1 text-sm">
                  {t('admin_registration.status_change', {
                    before: t(registrationStatusLabelKey(audit.beforeStatus)),
                    after: t(registrationStatusLabelKey(audit.afterStatus))
                  })}
                </p>
              {/if}
              <p class="text-muted-foreground mt-1 text-sm">
                {audit.actorName
                  ? t('activity.actor', { name: audit.actorName })
                  : t('activity.system_actor')}
                · {audit.createdAtLabel}
              </p>
            </li>
          {/each}
        </ol>
      {/if}
    </CardContent>
  </Card>
</div>
