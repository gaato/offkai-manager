<script lang="ts">
  import ListPage from '$lib/components/page/list-page.svelte';
  import { resolve } from '$app/paths';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import { translator } from '$lib/i18n';
  import { registrationStatusLabelKey } from '$lib/shared/registration';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const participantsHref = $derived(
    resolve('/app/events/[eventId]/participants', { eventId: data.event.id })
  );
  const exportHref = $derived(
    resolve('/app/events/[eventId]/participants.csv', { eventId: data.event.id })
  );

  function filterHref(status: (typeof data.filters)[number]): string {
    const parameters = new SvelteURLSearchParams();
    if (status !== 'all') parameters.set('status', status);
    if (data.query) parameters.set('q', data.query);
    const suffix = parameters.toString();
    return suffix ? `${participantsHref}?${suffix}` : participantsHref;
  }
</script>

<svelte:head
  ><title>{t('participants.title')} · {data.event.title} · {t('brand.name')}</title></svelte:head
>

<ListPage>
  {#snippet actions()}<a
      href={exportHref}
      class="btn btn-ghost inline-flex min-h-11 items-center px-4">{t('participants.export_csv')}</a
    >{/snippet}
  {#snippet title()}{t('participants.title')}{/snippet}
  {#snippet filters()}<search>
      <form
        method="GET"
        action={participantsHref}
        class="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        {#if data.status !== 'all'}
          <input type="hidden" name="status" value={data.status} />
        {/if}
        <div class="grid min-w-0 flex-1 gap-2">
          <label for="participant-search" class="label">{t('participants.search')}</label>
          <input
            id="participant-search"
            name="q"
            type="search"
            value={data.query}
            enterkeyhint="search"
            class="input w-full"
          />
          <p>{t('participants.search_help')}</p>
        </div>
        <button type="submit" class="btn btn-primary">{t('participants.search_submit')}</button>
      </form>
    </search>{/snippet}
  {#snippet body()}
    <div class="card card-border bg-base-100">
      <div class="card-body gap-2 pb-0">
        <div class="flex flex-wrap items-center justify-between gap-3"></div>
        <p class="mt-2">{t('participants.intro')}</p>
      </div>
      <div class="card-body">
        <nav aria-label={t('participants.filter_navigation')} class="mt-6">
          <ul role="list" class="flex flex-wrap gap-2">
            {#each data.filters as filter (filter)}
              <li>
                <a
                  aria-current={data.status === filter ? 'page' : undefined}
                  href={filterHref(filter)}
                  class="btn btn-ghost inline-flex min-h-11 items-center gap-2 px-4"
                >
                  {filter === 'all'
                    ? t('participants.filter.all')
                    : t(registrationStatusLabelKey(filter))}
                  <span class="px-2 py-0.5">{data.counts[filter]}</span>
                </a>
              </li>
            {/each}
          </ul>
        </nav>

        <p role="status" class="mt-5">
          {t('participants.result_count', { count: data.rows.length })}
        </p>
        {#if data.capped}
          <p class="mt-2">{t('participants.result_cap', { limit: data.limit })}</p>
        {/if}

        {#if data.rows.length === 0}
          <p class="mt-5 p-8">
            {t('participants.empty')}
          </p>
        {:else}
          <div class="mt-4 overflow-x-auto">
            <table class="table w-full min-w-[42rem]">
              <caption class="sr-only">{t('participants.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col" class="px-5 py-3">{t('participants.display_name')}</th>
                  <th scope="col" class="px-5 py-3">{t('participants.username')}</th>
                  <th scope="col" class="px-5 py-3">{t('participants.status')}</th>
                  <th scope="col" class="px-5 py-3">{t('participants.registered_at')}</th>
                </tr>
              </thead>
              <tbody>
                {#each data.rows as row (row.id)}
                  <tr>
                    <th scope="row" class="px-5 py-4">
                      {row.displayName}
                    </th>
                    <td class="px-5 py-4">{row.username || t('participants.username_missing')}</td>
                    <td class="px-5 py-4">
                      <span class="badge badge-secondary"
                        >{t(registrationStatusLabelKey(row.status))}</span
                      >
                    </td>
                    <td class="px-5 py-4">{row.registeredAtLabel}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </div>
  {/snippet}
</ListPage>
