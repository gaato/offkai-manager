<script lang="ts">
  import { resolve } from '$app/paths';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import { translator } from '$lib/i18n';
  import { registrationStatusLabelKey } from '$lib/shared/registration';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

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

<Card class="shadow-none">
  <CardHeader>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <CardTitle>{t('participants.title')}</CardTitle>
      <a
        class="hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 font-semibold"
        href={exportHref}>{t('participants.export_csv')}</a
      >
    </div>
    <p class="text-muted-foreground mt-2 text-sm">{t('participants.intro')}</p>
  </CardHeader>
  <CardContent>
    <search>
      <form
        method="GET"
        action={participantsHref}
        class="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        {#if data.status !== 'all'}
          <input type="hidden" name="status" value={data.status} />
        {/if}
        <div class="grid min-w-0 flex-1 gap-2">
          <Label for="participant-search">{t('participants.search')}</Label>
          <Input
            id="participant-search"
            name="q"
            type="search"
            value={data.query}
            enterkeyhint="search"
          />
          <p class="text-muted-foreground text-sm">{t('participants.search_help')}</p>
        </div>
        <Button type="submit">{t('participants.search_submit')}</Button>
      </form>
    </search>

    <nav class="mt-6" aria-label={t('participants.filter_navigation')}>
      <ul class="flex list-none flex-wrap gap-2" role="list">
        {#each data.filters as filter (filter)}
          <li>
            <a
              class="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-md border px-4 font-semibold"
              class:bg-accent={data.status === filter}
              aria-current={data.status === filter ? 'page' : undefined}
              href={filterHref(filter)}
            >
              {filter === 'all'
                ? t('participants.filter.all')
                : t(registrationStatusLabelKey(filter))}
              <span class="bg-muted rounded-full px-2 py-0.5 text-xs tabular-nums"
                >{data.counts[filter]}</span
              >
            </a>
          </li>
        {/each}
      </ul>
    </nav>

    <p class="text-muted-foreground mt-5 text-sm" role="status">
      {t('participants.result_count', { count: data.rows.length })}
    </p>
    {#if data.capped}
      <p class="text-muted-foreground mt-2 text-sm">{t('participants.result_cap')}</p>
    {/if}

    {#if data.rows.length === 0}
      <p class="text-muted-foreground mt-5 rounded-lg border border-dashed p-8 text-center">
        {t('participants.empty')}
      </p>
    {:else}
      <div class="mt-4 overflow-x-auto rounded-xl border">
        <table class="w-full min-w-[42rem] border-collapse text-left">
          <caption class="sr-only">{t('participants.caption')}</caption>
          <thead class="bg-muted/65 text-sm">
            <tr>
              <th class="px-5 py-3 font-semibold" scope="col">{t('participants.display_name')}</th>
              <th class="px-5 py-3 font-semibold" scope="col">{t('participants.username')}</th>
              <th class="px-5 py-3 font-semibold" scope="col">{t('participants.status')}</th>
              <th class="px-5 py-3 font-semibold" scope="col">{t('participants.registered_at')}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.rows as row (row.id)}
              <tr class="border-t">
                <th class="px-5 py-4 font-semibold" scope="row">
                  {row.displayName}
                </th>
                <td class="px-5 py-4">{row.username || t('participants.username_missing')}</td>
                <td class="px-5 py-4">
                  <Badge class="bg-secondary text-secondary-foreground"
                    >{t(registrationStatusLabelKey(row.status))}</Badge
                  >
                </td>
                <td class="px-5 py-4">{row.registeredAtLabel}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </CardContent>
</Card>
