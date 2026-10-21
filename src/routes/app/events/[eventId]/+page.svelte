<script lang="ts">
  import DashboardPage from '$lib/components/page/dashboard-page.svelte';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';

  type ActionResult = { actionError?: string; actionMessage?: string } | null;

  let { data, form: rawActionResult } = $props();
  const t = $derived(translator(data.locale));
  const actionResult = $derived(rawActionResult as ActionResult);
  const cancelHref = $derived(resolve('/app/events/[eventId]/cancel', { eventId: data.event.id }));
  const archiveHref = $derived(
    resolve('/app/events/[eventId]/archive', { eventId: data.event.id })
  );
  const discordHref = $derived(
    resolve('/app/events/[eventId]/discord', { eventId: data.event.id })
  );
  const venue = $derived(
    [data.event.venueName, data.event.venueAddress].filter(Boolean).join(' · ') ||
      t('event.venue_not_set')
  );
</script>

<svelte:head><title>{data.event.title} · {t('brand.name')}</title></svelte:head>

<DashboardPage titleId="event-overview-title">
  {#snippet title()}{t('event.overview_title')}{/snippet}
  {#snippet stats()}
    <div class="stat">
      <div class="stat-title">{t('event.stats_confirmed')}</div>
      <div class="stat-value">
        {data.dashboard.stats.confirmed} / {data.event.capacity ?? t('event.capacity_unlimited')}
      </div>
    </div>
    <div class="stat">
      <div class="stat-title">{t('event.stats_waitlisted')}</div>
      <div class="stat-value">{data.dashboard.stats.waitlisted}</div>
    </div>
    <div class="stat">
      <div class="stat-title">{t('event.stats_cancelled')}</div>
      <div class="stat-value">{data.dashboard.stats.cancelled}</div>
    </div>
  {/snippet}
  {#snippet steps()}
    {#each data.dashboard.steps as step (step.key)}
      <li class:step-primary={step.done} class="step" data-content={step.done ? '✓' : '○'}>
        <a
          class="link"
          href={step.anchor === 'payouts'
            ? `/app/organizations/${data.event.organizationId}/payouts`
            : `${discordHref}#${step.anchor}`}>{t(step.key)}</a
        >
      </li>
    {/each}
  {/snippet}
  {#snippet body()}
    <section aria-labelledby="event-overview-title">
      <p class="mt-2">{t('event.overview_intro')}</p>

      {#if actionResult?.actionError}
        <div role="alert" class="alert alert-error mt-6">{actionResult.actionError}</div>
      {:else if actionResult?.actionMessage}
        <div role="status" class="alert alert-success mt-6">{actionResult.actionMessage}</div>
      {/if}

      <div class="mt-7 grid gap-4 md:grid-cols-3">
        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <h2 class="card-title">{t('event.summary_schedule')}</h2>
          </div>
          <div class="card-body">
            <p>{t('event.schedule', { start: data.formattedStart, end: data.formattedEnd })}</p>
          </div>
        </div>
        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <h2 class="card-title">{t('event.summary_venue')}</h2>
          </div>
          <div class="card-body"><p>{venue}</p></div>
        </div>
        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <h2 class="card-title">{t('event.summary_capacity')}</h2>
          </div>
          <div class="card-body">
            <p>
              {data.event.capacity === null
                ? t('event.capacity_unlimited')
                : t('event.capacity_people', { count: data.event.capacity })}
            </p>
          </div>
        </div>
      </div>

      <div class="card card-border bg-base-100 mt-6">
        <div class="card-body gap-2 pb-0">
          <h2 class="card-title">{t('discord_settings.summary_title')}</h2>
        </div>
        <div class="card-body grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p class="mt-1">
              {data.discordSettings.integration?.guildNameSnapshot ||
                data.discordSettings.integration?.guildId ||
                t('discord_settings.summary_not_configured')}
            </p>
          </div>
          <a href={discordHref} class="btn btn-ghost inline-flex min-h-11 items-center px-4"
            >{t('discord_settings.manage')}</a
          >
        </div>
      </div>

      {#if data.capabilities.canManageEvent && !data.event.archivedAt}
        <div class="card card-border bg-base-100 mt-6">
          <div class="card-body gap-2 pb-0">
            <h2 class="card-title">{t('event.lifecycle_title')}</h2>
            <p class="mt-2">{t('event.lifecycle_intro')}</p>
          </div>
          <div class="card-body flex flex-wrap gap-3">
            {#if !data.event.cancelledAt && data.event.visibility === 'draft'}
              <form method="POST" action="?/publish">
                <button type="submit" class="btn btn-primary">{t('event.publish')}</button>
              </form>
            {:else if !data.event.cancelledAt && data.event.visibility === 'public'}
              <form method="POST" action="?/toggleUnlisted">
                <button type="submit" class="btn btn-outline">{t('event.unlist')}</button>
              </form>
            {:else if !data.event.cancelledAt && data.event.visibility === 'unlisted'}
              <form method="POST" action="?/toggleUnlisted">
                <button type="submit" class="btn btn-primary">{t('event.relist')}</button>
              </form>
            {/if}
            {#if !data.event.cancelledAt}
              <a href={cancelHref} class="btn btn-error inline-flex min-h-12 items-center px-5"
                >{t('event.cancel')}</a
              >
            {/if}
            <a href={archiveHref} class="btn btn-ghost inline-flex min-h-12 items-center px-5"
              >{t('event.archive')}</a
            >
          </div>
        </div>
      {/if}
    </section>
  {/snippet}
</DashboardPage>
