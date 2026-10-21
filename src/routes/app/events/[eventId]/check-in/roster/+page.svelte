<script lang="ts">
  import ListPage from '$lib/components/page/list-page.svelte';
  import { translator } from '$lib/i18n';
  import { systemPaymentMethodMessageKey } from '$lib/shared/payment';
  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head
  ><title>{t('roster.title')} · {data.event.title}</title><meta
    name="robots"
    content="noindex"
  /></svelte:head
>
<ListPage titleId="roster-title">
  {#snippet title()}{t('roster.title')}{/snippet}
  {#snippet actions()}<a
      class="btn print:hidden"
      href={`/app/events/${data.event.id}/check-in/roster.csv`}>{t('roster.csv')}</a
    >{/snippet}
  {#snippet body()}
    <p>{data.event.title}</p>
    <p class="print:hidden">{t('roster.help')}</p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard users must be able to scroll the roster) -->
    <div
      class="overflow-x-auto print:overflow-visible"
      role="region"
      aria-labelledby="roster-title"
      tabindex="0"
    >
      <table class="table-sm table">
        <thead
          ><tr
            >{#each ['number', 'name', 'payment', 'method', 'checked'] as const as column (column)}<th
                scope="col">{t(`roster.${column}`)}</th
              >{/each}</tr
          ></thead
        >
        <tbody
          >{#each data.rows as row (row.id)}<tr class="break-inside-avoid"
              ><th scope="row">{String(row.number).padStart(3, '0')}</th><td>{row.name}</td><td
                >{t(`checkin.payment.${row.paymentState}`)}</td
              ><td
                >{row.methods
                  .map((m) => {
                    const key = systemPaymentMethodMessageKey(m);
                    return key ? t(key) : m;
                  })
                  .join(', ')}</td
              ><td>{t(row.checkedIn ? 'registration.answer_yes' : 'registration.answer_no')}</td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  {/snippet}
</ListPage>
