<script lang="ts">
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { auditActionLabelKey } from '$lib/shared/audit';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('ops.activity.title')} · {t('brand.name')}</title></svelte:head>

<div class="grid gap-6">
  <header>
    <h1 class="text-3xl font-bold tracking-tight">{t('ops.activity.title')}</h1>
    <p class="mt-2 text-slate-600">{t('ops.activity.intro')}</p>
  </header>

  <Card class="border-slate-200 shadow-none">
    <CardHeader><CardTitle>{t('ops.activity.filters')}</CardTitle></CardHeader>
    <CardContent>
      <form
        method="GET"
        action={resolve('/ops/activity')}
        class="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
      >
        <div>
          <Label for="action-prefix">{t('ops.activity.action_prefix')}</Label>
          <p id="action-prefix-help" class="mt-1 text-sm text-slate-600">
            {t('ops.activity.action_prefix_help')}
          </p>
          <Input
            id="action-prefix"
            name="action"
            value={data.actionPrefix}
            maxlength={200}
            aria-describedby="action-prefix-help"
            class="mt-2"
          />
        </div>
        <div>
          <Label for="target-id">{t('ops.activity.target_id')}</Label>
          <p id="target-id-help" class="mt-1 text-sm text-slate-600">
            {t('ops.activity.target_id_help')}
          </p>
          <Input
            id="target-id"
            name="target"
            value={data.targetId}
            maxlength={200}
            aria-describedby="target-id-help"
            class="mt-2"
          />
        </div>
        <Button type="submit">{t('ops.activity.apply')}</Button>
      </form>
    </CardContent>
  </Card>

  <Card class="border-slate-200 shadow-none">
    <CardHeader><CardTitle>{t('ops.activity.results')}</CardTitle></CardHeader>
    <CardContent>
      {#if data.rows.length === 0}
        <p class="text-slate-600">{t('ops.activity.empty')}</p>
      {:else}
        <ol class="divide-y divide-slate-200">
          {#each data.rows as row (row.id)}
            <li class="py-4 first:pt-0 last:pb-0">
              <p class="font-semibold">{t(auditActionLabelKey(row.action))}</p>
              {#if row.eventTitle}<p class="mt-1 text-sm">
                  {t('activity.event', { event: row.eventTitle })}
                </p>{/if}
              {#if row.reason}<p class="mt-1 text-sm whitespace-pre-wrap">
                  {t('activity.reason', { reason: row.reason })}
                </p>{/if}
              <p class="mt-1 text-sm text-slate-600">
                {row.actorName
                  ? t('activity.actor', { name: row.actorName })
                  : t('activity.system_actor')} · {row.createdAtLabel}
              </p>
              {#if row.targetId}<p class="mt-1 font-mono text-xs break-all text-slate-500">
                  {t('ops.activity.target_value', { id: row.targetId })}
                </p>{/if}
            </li>
          {/each}
        </ol>
      {/if}
      {#if data.previousHref || data.nextHref}
        <nav
          class="mt-6 flex justify-between gap-4 border-t border-slate-200 pt-5"
          aria-label={t('ops.activity.pagination')}
        >
          <span
            >{#if data.previousHref}<a
                class="font-semibold underline-offset-4 hover:underline"
                href={data.previousHref}>{t('ops.previous')}</a
              >{/if}</span
          >
          <span
            >{#if data.nextHref}<a
                class="font-semibold underline-offset-4 hover:underline"
                href={data.nextHref}>{t('ops.next')}</a
              >{/if}</span
          >
        </nav>
      {/if}
    </CardContent>
  </Card>
</div>
