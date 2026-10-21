<script lang="ts">
  import ListPage from '$lib/components/page/list-page.svelte';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { paymentRequestStatusLabelKey } from '$lib/shared/payment';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('ops.payment_conflicts.title')} · {t('brand.name')}</title></svelte:head>

<ListPage>
  {#snippet title()}{t('ops.payment_conflicts.title')}{/snippet}
  {#snippet body()}
    <div class="grid gap-6">
      <header>
        <p class="mt-2 max-w-3xl">{t('ops.payment_conflicts.intro')}</p>
      </header>
      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <h2 class="card-title">{t('ops.payment_conflicts.list_title')}</h2>
        </div>
        <div class="card-body">
          {#if data.rows.length === 0}
            <p>{t('ops.payment_conflicts.empty')}</p>
          {:else}
            <div class="overflow-x-auto">
              <table class="table w-full">
                <caption class="sr-only">{t('ops.payment_conflicts.list_title')}</caption>
                <thead
                  ><tr
                    ><th scope="col" class="px-3 py-3">{t('ops.organization.name')}</th><th
                      scope="col"
                      class="px-3 py-3">{t('ops.payment_conflicts.event')}</th
                    ><th scope="col" class="px-3 py-3">{t('ops.payment_conflicts.participant')}</th
                    ><th scope="col" class="px-3 py-3">{t('ops.payment_conflicts.amount')}</th><th
                      scope="col"
                      class="px-3 py-3">{t('ops.status')}</th
                    ><th scope="col" class="px-3 py-3">{t('ops.payment_conflicts.received')}</th
                    ></tr
                  ></thead
                >
                <tbody>
                  {#each data.rows as row (row.recordId)}
                    <tr>
                      <td class="px-3 py-4"
                        ><a
                          href={resolve('/ops/organizations/[orgId]', {
                            orgId: row.organizationId
                          })}
                          class="link">{row.organizationName}</a
                        ></td
                      >
                      <th scope="row" class="px-3 py-4"
                        ><a
                          href={resolve('/app/events/[eventId]/payments', { eventId: row.eventId })}
                          class="link">{row.eventTitle}</a
                        ></th
                      >
                      <td class="px-3 py-4">{row.displayName}</td>
                      <td class="px-3 py-4">{row.amountLabel}</td>
                      <td class="px-3 py-4">{t(paymentRequestStatusLabelKey(row.requestStatus))}</td
                      >
                      <td class="px-3 py-4">{row.occurredAtLabel}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/snippet}
</ListPage>
