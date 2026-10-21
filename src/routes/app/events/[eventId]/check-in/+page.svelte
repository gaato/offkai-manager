<script lang="ts">
  import ListPage from '$lib/components/page/list-page.svelte';
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import { translator } from '$lib/i18n';
  import { checkInPaymentStateLabelKey } from '$lib/shared/checkin';
  import { registrationStatusLabelKey } from '$lib/shared/registration';

  type ActionResult = { actionError?: string } | null;

  let { data, form: rawActionResult } = $props();
  const t = $derived(translator(data.locale));
  const actionResult = $derived(rawActionResult as ActionResult);
  const checkInHref = $derived(
    resolve('/app/events/[eventId]/check-in', { eventId: data.event.id })
  );
</script>

<svelte:head>
  <title>{t('checkin.title')} · {data.event.title} · {t('brand.name')}</title>
</svelte:head>

<ListPage>
  {#snippet title()}{t('checkin.title')}{/snippet}
  {#snippet filters()}<search>
      <form
        method="GET"
        action={checkInHref}
        class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
      >
        <div class="grid gap-2">
          <label for="check-in-search" class="label">{t('checkin.search')}</label>
          <input
            id="check-in-search"
            name="q"
            type="search"
            value={data.query}
            enterkeyhint="search"
            autocomplete="off"
            aria-describedby="check-in-search-help"
            class="input w-full"
          />
          <p id="check-in-search-help">
            {t('checkin.search_help')}
          </p>
        </div>
        <button type="submit" class="btn btn-primary btn-lg">{t('checkin.search_submit')}</button>
      </form>
    </search>{/snippet}
  {#snippet body()}
    <div class="mx-auto grid max-w-3xl gap-6">
      <header>
        <p class="mt-2">{t('checkin.intro')}</p>
      </header>

      {#if actionResult?.actionError}
        <div role="alert" class="alert alert-error">
          {actionResult.actionError}
        </div>
      {:else if data.changed}
        <div role="status" class="alert alert-success">
          {t(data.changed === 'record' ? 'checkin.success_record' : 'checkin.success_undo')}
        </div>
      {/if}

      <div class="grid grid-cols-2 gap-3">
        <div class="card card-border bg-base-100">
          <div class="card-body pt-6">
            <p>{t('checkin.confirmed_count')}</p>
            <p class="mt-1">{data.confirmedCount}</p>
          </div>
        </div>
        <div class="card card-border bg-base-100">
          <div class="card-body pt-6">
            <p>{t('checkin.checked_in_count')}</p>
            <p class="mt-1">{data.checkedInCount}</p>
          </div>
        </div>
      </div>

      <p role="status">
        {t('checkin.result_count', { count: data.rows.length })}
      </p>

      {#if data.rows.length === 0}
        <p class="p-8">
          {t('checkin.empty')}
        </p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table">
            <caption class="sr-only">{t('checkin.title')}</caption>
            <thead
              ><tr
                ><th scope="col">{t('participants.display_name')}</th><th scope="col"
                  >{t('checkin.registration_status')}</th
                ><th scope="col">{t('checkin.payment_status')}</th><th scope="col"
                  >{t('payments.request_actions')}</th
                ></tr
              ></thead
            >
            <tbody
              >{#each data.rows as row (row.registrationId)}<tr>
                  <th scope="row"
                    ><span>{row.displayName}</span>
                    <p>{row.username || t('checkin.username_missing')}</p>
                    <span class={row.checkedInAt ? 'badge badge-primary' : 'badge badge-ghost'}
                      >{t(
                        row.checkedInAt
                          ? 'checkin.state_checked_in'
                          : 'checkin.state_not_checked_in'
                      )}</span
                    ></th
                  >
                  <td>{t(registrationStatusLabelKey(row.registrationStatus))}</td><td
                    >{t(checkInPaymentStateLabelKey(row.paymentState))}</td
                  ><td>
                    {#if row.checkedInAt}
                      <form method="POST" action="?/undo" use:enhance>
                        <input type="hidden" name="registrationId" value={row.registrationId} />
                        <input type="hidden" name="q" value={data.query} />
                        <button
                          type="submit"
                          aria-label={t('checkin.undo_for', { name: row.displayName })}
                          class="btn btn-outline min-h-12 w-full">{t('checkin.undo')}</button
                        >
                      </form>
                    {:else if row.registrationStatus === 'confirmed'}
                      <form method="POST" action="?/record" use:enhance>
                        <input type="hidden" name="registrationId" value={row.registrationId} />
                        <input type="hidden" name="q" value={data.query} />
                        <button
                          type="submit"
                          aria-label={t('checkin.record_for', { name: row.displayName })}
                          class="btn btn-primary btn-lg min-h-12 w-full"
                          >{t('checkin.record')}</button
                        >
                      </form>
                    {:else}
                      <p>{t('checkin.ineligible')}</p>
                    {/if}
                  </td></tr
                >{/each}</tbody
            >
          </table>
        </div>
      {/if}
    </div>
  {/snippet}
</ListPage>
