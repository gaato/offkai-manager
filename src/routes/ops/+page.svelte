<script lang="ts">
  import DashboardPage from '$lib/components/page/dashboard-page.svelte';
  import { translator } from '$lib/i18n';
  import { auditActionLabelKey } from '$lib/shared/audit';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const metrics = $derived([
    { label: t('ops.metric.organizations'), value: data.organizationCount },
    { label: t('ops.metric.users'), value: data.userCount },
    { label: t('ops.metric.events'), value: data.eventCount }
  ]);
</script>

<svelte:head><title>{t('ops.dashboard_title')} · {t('brand.name')}</title></svelte:head>

<DashboardPage>
  {#snippet title()}{t('ops.dashboard_title')}{/snippet}
  {#snippet stats()}
    {#each metrics as metric (metric.label)}
      <div class="stat">
        <h2 class="stat-title">{metric.label}</h2>
        <p class="stat-value">{metric.value}</p>
      </div>
    {/each}
  {/snippet}
  {#snippet steps()}
    <li class="step">{t('ops.nav.organizations')}</li>
    <li class="step">{t('ops.nav.users')}</li>
    <li class="step">{t('ops.nav.activity')}</li>
  {/snippet}
  {#snippet body()}
    <div class="grid gap-8">
      <header>
        <p>{t('ops.eyebrow')}</p>

        <p class="mt-2 max-w-3xl">{t('ops.dashboard_intro')}</p>
      </header>
    </div>
  {/snippet}
  {#snippet recent()}
    <div class="card card-border bg-base-100">
      <div class="card-body gap-2 pb-0"><h2 class="card-title">{t('ops.recent_activity')}</h2></div>
      <div class="card-body">
        {#if data.recentAudits.length === 0}
          <p>{t('ops.activity_empty')}</p>
        {:else}
          <ol>
            {#each data.recentAudits as row (row.id)}
              <li class="py-4 first:pt-0 last:pb-0">
                <p>{t(auditActionLabelKey(row.action))}</p>
                <p class="mt-1">
                  {row.actorName
                    ? t('activity.actor', { name: row.actorName })
                    : t('activity.system_actor')}
                  {#if row.eventTitle}
                    · {row.eventTitle}{/if} · {row.createdAtLabel}
                </p>
                {#if row.reason}<p class="mt-1">{row.reason}</p>{/if}
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    </div>{/snippet}
</DashboardPage>
