<script lang="ts">
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { paymentRequestStatusLabelKey } from '$lib/shared/payment';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('ops.payment_conflicts.title')} · {t('brand.name')}</title></svelte:head>

<div class="grid gap-6">
  <header>
    <h1 class="text-3xl font-bold tracking-tight">{t('ops.payment_conflicts.title')}</h1>
    <p class="mt-2 max-w-3xl text-slate-600">{t('ops.payment_conflicts.intro')}</p>
  </header>
  <Card class="border-slate-200 shadow-none">
    <CardHeader><CardTitle>{t('ops.payment_conflicts.list_title')}</CardTitle></CardHeader>
    <CardContent>
      {#if data.rows.length === 0}
        <p class="text-slate-600">{t('ops.payment_conflicts.empty')}</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <caption class="sr-only">{t('ops.payment_conflicts.list_title')}</caption>
            <thead class="border-b border-slate-200 text-slate-600"
              ><tr
                ><th class="px-3 py-3" scope="col">{t('ops.organization.name')}</th><th
                  class="px-3 py-3"
                  scope="col">{t('ops.payment_conflicts.event')}</th
                ><th class="px-3 py-3" scope="col">{t('ops.payment_conflicts.participant')}</th><th
                  class="px-3 py-3"
                  scope="col">{t('ops.payment_conflicts.amount')}</th
                ><th class="px-3 py-3" scope="col">{t('ops.status')}</th><th
                  class="px-3 py-3"
                  scope="col">{t('ops.payment_conflicts.received')}</th
                ></tr
              ></thead
            >
            <tbody class="divide-y divide-slate-200">
              {#each data.rows as row (row.recordId)}
                <tr>
                  <td class="px-3 py-4"
                    ><a
                      class="font-semibold underline-offset-4 hover:underline"
                      href={resolve('/ops/organizations/[orgId]', { orgId: row.organizationId })}
                      >{row.organizationName}</a
                    ></td
                  >
                  <th class="px-3 py-4" scope="row"
                    ><a
                      class="font-semibold underline-offset-4 hover:underline"
                      href={resolve('/app/events/[eventId]/payments', { eventId: row.eventId })}
                      >{row.eventTitle}</a
                    ></th
                  >
                  <td class="px-3 py-4">{row.displayName}</td>
                  <td class="px-3 py-4 font-semibold tabular-nums">{row.amountLabel}</td>
                  <td class="px-3 py-4">{t(paymentRequestStatusLabelKey(row.requestStatus))}</td>
                  <td class="px-3 py-4">{row.occurredAtLabel}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
