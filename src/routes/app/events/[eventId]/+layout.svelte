<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { translator } from '$lib/i18n';
  import { eventVisibilityLabelKey } from '$lib/shared/event';
  import { Badge } from '$lib/components/ui/badge';

  let { data, children } = $props();
  const t = $derived(translator(data.locale));
  const overviewHref = $derived(resolve('/app/events/[eventId]', { eventId: data.event.id }));
  const settingsHref = $derived(
    resolve('/app/events/[eventId]/settings', { eventId: data.event.id })
  );
  const registrationFormHref = $derived(
    resolve('/app/events/[eventId]/registration-form', { eventId: data.event.id })
  );
  const participantsHref = $derived(
    resolve('/app/events/[eventId]/participants', { eventId: data.event.id })
  );
  const checkInHref = $derived(
    resolve('/app/events/[eventId]/check-in', { eventId: data.event.id })
  );
  const paymentsHref = $derived(
    resolve('/app/events/[eventId]/payments', { eventId: data.event.id })
  );
  const activityHref = $derived(
    resolve('/app/events/[eventId]/activity', { eventId: data.event.id })
  );
  const organizationHref = $derived(
    resolve('/app/organizations/[orgId]', { orgId: data.event.organizationId })
  );
</script>

<div class="mx-auto max-w-5xl">
  {#if data.organizationSuspended}
    <div
      class="mb-6 rounded-md border border-amber-700 bg-amber-50 px-4 py-3 text-amber-950"
      role="status"
    >
      <strong>{t('organization.suspended_title')}</strong>
      <p class="mt-1 text-sm">{t('organization.suspended_read_only')}</p>
    </div>
  {/if}
  <header class="border-b pb-5">
    <a
      class="text-muted-foreground hover:text-foreground inline-flex min-h-10 items-center text-sm font-semibold"
      href={organizationHref}>{t('organization.workspace')}</a
    >
    <div class="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-muted-foreground text-sm font-semibold">{t('event.workspace')}</p>
        <h1 class="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{data.event.title}</h1>
        <p class="text-muted-foreground mt-2 text-sm">
          {t('event.schedule', { start: data.formattedStart, end: data.formattedEnd })}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <Badge class="bg-secondary text-secondary-foreground"
            >{t(eventVisibilityLabelKey(data.event.visibility))}</Badge
          >
          {#if data.event.cancelledAt}
            <Badge class="bg-destructive text-white">{t('event.badge_cancelled')}</Badge>
          {/if}
          {#if data.event.archivedAt}
            <Badge class="bg-muted text-muted-foreground">{t('event.badge_archived')}</Badge>
          {/if}
          {#if !data.capabilities.canManageEvent}
            <Badge class="bg-muted text-muted-foreground">{t('event.read_only')}</Badge>
          {/if}
        </div>
      </div>
      <nav aria-label={t('event.navigation')}>
        <ul class="flex list-none flex-wrap gap-1" role="list">
          {#if data.capabilities.canRecordPayments}
            <li>
              <a
                class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
                class:bg-accent={page.url.pathname === paymentsHref}
                aria-current={page.url.pathname === paymentsHref ? 'page' : undefined}
                href={paymentsHref}>{t('payments.nav')}</a
              >
            </li>
          {/if}
          {#if data.capabilities.canCheckIn}
            <li>
              <a
                class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
                class:bg-accent={page.url.pathname === checkInHref}
                aria-current={page.url.pathname === checkInHref ? 'page' : undefined}
                href={checkInHref}>{t('checkin.nav')}</a
              >
            </li>
            <li>
              <a
                class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
                class:bg-accent={page.url.pathname === participantsHref}
                aria-current={page.url.pathname === participantsHref ? 'page' : undefined}
                href={participantsHref}>{t('participants.nav')}</a
              >
            </li>
          {/if}
          {#if data.capabilities.canViewAudit}
            <li>
              <a
                class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
                class:bg-accent={page.url.pathname === activityHref}
                aria-current={page.url.pathname === activityHref ? 'page' : undefined}
                href={activityHref}>{t('activity.nav')}</a
              >
            </li>
          {/if}
          <li>
            <a
              class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
              class:bg-accent={page.url.pathname === registrationFormHref}
              aria-current={page.url.pathname === registrationFormHref ? 'page' : undefined}
              href={registrationFormHref}>{t('registration_form.nav')}</a
            >
          </li>
          <li>
            <a
              class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
              class:bg-accent={page.url.pathname === overviewHref}
              aria-current={page.url.pathname === overviewHref ? 'page' : undefined}
              href={overviewHref}>{t('event.overview_nav')}</a
            >
          </li>
          <li>
            <a
              class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
              class:bg-accent={page.url.pathname === settingsHref}
              aria-current={page.url.pathname === settingsHref ? 'page' : undefined}
              href={settingsHref}>{t('event.settings_nav')}</a
            >
          </li>
        </ul>
      </nav>
    </div>
  </header>
  <div class="pt-7">
    {@render children()}
  </div>
</div>
