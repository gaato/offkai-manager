<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { translator } from '$lib/i18n';
  import { eventVisibilityLabelKey } from '$lib/shared/event';

  let { data, children } = $props();
  const t = $derived(translator(data.locale));
  const overviewHref = $derived(resolve('/app/events/[eventId]', { eventId: data.event.id }));
  const discordHref = $derived(
    resolve('/app/events/[eventId]/discord', { eventId: data.event.id })
  );
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
    <div role="status" class="alert alert-warning mb-6">
      <strong>{t('organization.suspended_title')}</strong>
      <p class="mt-1">{t('organization.suspended_read_only')}</p>
    </div>
  {/if}
  <header class="pb-5">
    <a href={organizationHref} class="btn btn-ghost inline-flex min-h-10 items-center"
      >{t('organization.workspace')}</a
    >
    <div class="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p>{t('event.workspace')}</p>
        <p class="card-title mt-1">{data.event.title}</p>
        <p class="mt-2">
          {t('event.schedule', { start: data.formattedStart, end: data.formattedEnd })}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <span class="badge badge-secondary"
            >{t(eventVisibilityLabelKey(data.event.visibility))}</span
          >
          {#if data.event.cancelledAt}
            <span class="badge badge-error">{t('event.badge_cancelled')}</span>
          {/if}
          {#if data.event.archivedAt}
            <span class="badge badge-ghost">{t('event.badge_archived')}</span>
          {/if}
          {#if !data.capabilities.canManageEvent}
            <span class="badge badge-ghost">{t('event.read_only')}</span>
          {/if}
        </div>
      </div>
      <nav class="print:hidden" aria-label={t('event.navigation')}>
        <ul class="menu menu-horizontal flex-wrap">
          <li>
            <a
              aria-current={page.url.pathname === overviewHref ? 'page' : undefined}
              href={overviewHref}
              class={page.url.pathname === overviewHref ? 'menu-active' : ''}
              >{t('event.overview_nav')}</a
            >
          </li>
          {#if data.capabilities.canCheckIn}
            <li>
              <a
                aria-current={page.url.pathname === participantsHref ? 'page' : undefined}
                href={participantsHref}
                class={page.url.pathname === participantsHref ? 'menu-active' : ''}
                >{t('participants.nav')}</a
              >
            </li>
          {/if}
          {#if data.capabilities.canCheckIn}
            <li>
              <a
                aria-current={page.url.pathname === checkInHref ? 'page' : undefined}
                href={checkInHref}
                class={page.url.pathname === checkInHref ? 'menu-active' : ''}>{t('checkin.nav')}</a
              >
            </li>
          {/if}
          {#if data.capabilities.canRecordPayments}
            <li>
              <a
                aria-current={page.url.pathname === paymentsHref ? 'page' : undefined}
                href={paymentsHref}
                class={page.url.pathname === paymentsHref ? 'menu-active' : ''}
                >{t('payments.nav')}</a
              >
            </li>
          {/if}
          <li>
            <a
              aria-current={page.url.pathname === registrationFormHref ? 'page' : undefined}
              href={registrationFormHref}
              class={page.url.pathname === registrationFormHref ? 'menu-active' : ''}
              >{t('registration_form.nav')}</a
            >
          </li>
          <li>
            <a
              aria-current={page.url.pathname === discordHref ? 'page' : undefined}
              href={discordHref}
              class={page.url.pathname === discordHref ? 'menu-active' : ''}
              >{t('event.discord_nav')}</a
            >
          </li>
          <li>
            <a
              aria-current={page.url.pathname === settingsHref ? 'page' : undefined}
              href={settingsHref}
              class={page.url.pathname === settingsHref ? 'menu-active' : ''}
              >{t('event.settings_nav')}</a
            >
          </li>
          {#if data.capabilities.canViewAudit}
            <li>
              <a
                aria-current={page.url.pathname === activityHref ? 'page' : undefined}
                href={activityHref}
                class={page.url.pathname === activityHref ? 'menu-active' : ''}
                >{t('activity.nav')}</a
              >
            </li>
          {/if}
        </ul>
      </nav>
    </div>
  </header>
  <div class="pt-7">
    {@render children()}
  </div>
</div>
