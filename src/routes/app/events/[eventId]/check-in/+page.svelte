<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import { translator } from '$lib/i18n';
  import { checkInPaymentStateLabelKey } from '$lib/shared/checkin';
  import { registrationStatusLabelKey } from '$lib/shared/registration';
  import { Alert } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

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

<div class="mx-auto grid max-w-3xl gap-6">
  <header>
    <h2 class="text-2xl font-bold tracking-tight">{t('checkin.title')}</h2>
    <p class="text-muted-foreground mt-2">{t('checkin.intro')}</p>
  </header>

  {#if actionResult?.actionError}
    <Alert class="border-destructive text-destructive" role="alert">
      {actionResult.actionError}
    </Alert>
  {:else if data.changed}
    <Alert class="border-primary/35 bg-secondary/50" role="status">
      {t(data.changed === 'record' ? 'checkin.success_record' : 'checkin.success_undo')}
    </Alert>
  {/if}

  <div class="grid grid-cols-2 gap-3">
    <Card class="shadow-none">
      <CardContent class="pt-6">
        <p class="text-muted-foreground text-sm">{t('checkin.confirmed_count')}</p>
        <p class="mt-1 text-2xl font-bold tabular-nums">{data.confirmedCount}</p>
      </CardContent>
    </Card>
    <Card class="shadow-none">
      <CardContent class="pt-6">
        <p class="text-muted-foreground text-sm">{t('checkin.checked_in_count')}</p>
        <p class="mt-1 text-2xl font-bold tabular-nums">{data.checkedInCount}</p>
      </CardContent>
    </Card>
  </div>

  <search>
    <form method="GET" action={checkInHref} class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <div class="grid gap-2">
        <Label for="check-in-search">{t('checkin.search')}</Label>
        <Input
          id="check-in-search"
          name="q"
          type="search"
          value={data.query}
          enterkeyhint="search"
          autocomplete="off"
          aria-describedby="check-in-search-help"
        />
        <p id="check-in-search-help" class="text-muted-foreground text-sm">
          {t('checkin.search_help')}
        </p>
      </div>
      <Button type="submit" size="lg">{t('checkin.search_submit')}</Button>
    </form>
  </search>

  <p class="text-muted-foreground text-sm" role="status">
    {t('checkin.result_count', { count: data.rows.length })}
  </p>

  {#if data.rows.length === 0}
    <p class="text-muted-foreground rounded-xl border border-dashed p-8 text-center">
      {t('checkin.empty')}
    </p>
  {:else}
    <ul class="grid list-none gap-3" role="list">
      {#each data.rows as row (row.registrationId)}
        <li>
          <Card class="shadow-none">
            <CardHeader class="gap-3">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{row.displayName}</CardTitle>
                  <p class="text-muted-foreground mt-1 text-sm">
                    {row.username || t('checkin.username_missing')}
                  </p>
                </div>
                <Badge
                  class={row.checkedInAt
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'}
                  >{t(
                    row.checkedInAt ? 'checkin.state_checked_in' : 'checkin.state_not_checked_in'
                  )}</Badge
                >
              </div>
            </CardHeader>
            <CardContent class="grid gap-5">
              <dl class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-muted-foreground">{t('checkin.registration_status')}</dt>
                  <dd class="mt-1 font-semibold">
                    {t(registrationStatusLabelKey(row.registrationStatus))}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted-foreground">{t('checkin.payment_status')}</dt>
                  <dd class="mt-1 font-semibold">
                    {t(checkInPaymentStateLabelKey(row.paymentState))}
                  </dd>
                </div>
              </dl>
              {#if row.checkedInAt}
                <form method="POST" action="?/undo" use:enhance>
                  <input type="hidden" name="registrationId" value={row.registrationId} />
                  <input type="hidden" name="q" value={data.query} />
                  <Button
                    type="submit"
                    variant="outline"
                    class="min-h-12 w-full"
                    aria-label={t('checkin.undo_for', { name: row.displayName })}
                    >{t('checkin.undo')}</Button
                  >
                </form>
              {:else if row.registrationStatus === 'confirmed'}
                <form method="POST" action="?/record" use:enhance>
                  <input type="hidden" name="registrationId" value={row.registrationId} />
                  <input type="hidden" name="q" value={data.query} />
                  <Button
                    type="submit"
                    size="lg"
                    class="min-h-12 w-full"
                    aria-label={t('checkin.record_for', { name: row.displayName })}
                    >{t('checkin.record')}</Button
                  >
                </form>
              {:else}
                <p class="text-muted-foreground text-sm">{t('checkin.ineligible')}</p>
              {/if}
            </CardContent>
          </Card>
        </li>
      {/each}
    </ul>
  {/if}
</div>
