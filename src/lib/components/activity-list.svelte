<script lang="ts">
  import { translator, type Locale } from '$lib/i18n';
  import { auditActionLabelKey } from '$lib/shared/audit';

  interface ActivityListRow {
    id: string;
    action: string;
    actorName: string;
    eventTitle: string;
    reason: string;
    createdAtLabel: string;
  }

  let {
    locale,
    rows,
    showEvent = false
  }: { locale: Locale; rows: ActivityListRow[]; showEvent?: boolean } = $props();
  const t = $derived(translator(locale));
</script>

{#if rows.length === 0}
  <p class="text-muted-foreground">{t('activity.empty')}</p>
{:else}
  <ol class="grid list-none gap-4">
    {#each rows as row (row.id)}
      <li class="border-b pb-4 last:border-0 last:pb-0">
        <p class="font-semibold">{t(auditActionLabelKey(row.action))}</p>
        {#if showEvent && row.eventTitle}
          <p class="mt-1">{t('activity.event', { event: row.eventTitle })}</p>
        {/if}
        {#if row.reason}
          <p class="mt-1 whitespace-pre-wrap">{t('activity.reason', { reason: row.reason })}</p>
        {/if}
        <p class="text-muted-foreground mt-1 text-sm">
          {row.actorName
            ? t('activity.actor', { name: row.actorName })
            : t('activity.system_actor')}
          · {row.createdAtLabel}
        </p>
      </li>
    {/each}
  </ol>
{/if}
