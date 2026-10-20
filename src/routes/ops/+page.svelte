<script lang="ts">
  import { translator } from '$lib/i18n';
  import { auditActionLabelKey } from '$lib/shared/audit';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const metrics = $derived([
    { label: t('ops.metric.organizations'), value: data.organizationCount },
    { label: t('ops.metric.users'), value: data.userCount },
    { label: t('ops.metric.events'), value: data.eventCount }
  ]);
</script>

<svelte:head><title>{t('ops.dashboard_title')} · {t('brand.name')}</title></svelte:head>

<div class="grid gap-8">
  <header>
    <p class="text-sm font-semibold text-slate-600">{t('ops.eyebrow')}</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">{t('ops.dashboard_title')}</h1>
    <p class="mt-2 max-w-3xl text-slate-600">{t('ops.dashboard_intro')}</p>
  </header>

  <section aria-labelledby="platform-totals">
    <h2 id="platform-totals" class="sr-only">{t('ops.totals_title')}</h2>
    <div class="grid gap-4 sm:grid-cols-3">
      {#each metrics as metric (metric.label)}
        <Card class="border-slate-200 shadow-none">
          <CardHeader
            ><CardTitle class="text-base text-slate-600">{metric.label}</CardTitle></CardHeader
          >
          <CardContent><p class="text-3xl font-bold tabular-nums">{metric.value}</p></CardContent>
        </Card>
      {/each}
    </div>
  </section>

  <Card class="border-slate-200 shadow-none">
    <CardHeader><CardTitle>{t('ops.recent_activity')}</CardTitle></CardHeader>
    <CardContent>
      {#if data.recentAudits.length === 0}
        <p class="text-slate-600">{t('ops.activity_empty')}</p>
      {:else}
        <ol class="divide-y divide-slate-200">
          {#each data.recentAudits as row (row.id)}
            <li class="py-4 first:pt-0 last:pb-0">
              <p class="font-semibold">{t(auditActionLabelKey(row.action))}</p>
              <p class="mt-1 text-sm text-slate-600">
                {row.actorName
                  ? t('activity.actor', { name: row.actorName })
                  : t('activity.system_actor')}
                {#if row.eventTitle}
                  · {row.eventTitle}{/if} · {row.createdAtLabel}
              </p>
              {#if row.reason}<p class="mt-1 text-sm">{row.reason}</p>{/if}
            </li>
          {/each}
        </ol>
      {/if}
    </CardContent>
  </Card>
</div>
