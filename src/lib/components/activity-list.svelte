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
  <p>{t('activity.empty')}</p>
{:else}
  <div class="overflow-x-auto">
    <table class="table">
      <caption class="sr-only">{t('activity.nav')}</caption>
      <thead
        ><tr>
          <th scope="col">{t('activity.column.action')}</th>
          <th scope="col">{t('activity.column.actor')}</th>
          <th scope="col">{t('activity.column.date')}</th>
          <th scope="col">{t('activity.column.details')}</th>
        </tr></thead
      >
      <tbody>
        {#each rows as row (row.id)}
          <tr>
            <th scope="row">{t(auditActionLabelKey(row.action))}</th>
            <td
              >{row.actorName
                ? t('activity.actor', { name: row.actorName })
                : t('activity.system_actor')}</td
            >
            <td>{row.createdAtLabel}</td>
            <td>
              {#if showEvent && row.eventTitle}<p>
                  {t('activity.event', { event: row.eventTitle })}
                </p>{/if}
              {#if row.reason}<p>{t('activity.reason', { reason: row.reason })}</p>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
