<script lang="ts">
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { discordPolicyLabelKey } from '$lib/shared/event';
  import { Alert } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  type ActionResult = { actionError?: string; actionMessage?: string } | null;

  let { data, form: rawActionResult } = $props();
  const t = $derived(translator(data.locale));
  const actionResult = $derived(rawActionResult as ActionResult);
  const cancelHref = $derived(resolve('/app/events/[eventId]/cancel', { eventId: data.event.id }));
  const archiveHref = $derived(
    resolve('/app/events/[eventId]/archive', { eventId: data.event.id })
  );
  const settingsHref = $derived(
    resolve('/app/events/[eventId]/settings', { eventId: data.event.id })
  );
  const venue = $derived(
    [data.event.venueName, data.event.venueAddress].filter(Boolean).join(' · ') ||
      t('event.venue_not_set')
  );
</script>

<svelte:head><title>{data.event.title} · {t('brand.name')}</title></svelte:head>

<section aria-labelledby="event-overview-title">
  <h2 id="event-overview-title" class="text-xl font-bold">{t('event.overview_title')}</h2>
  <p class="text-muted-foreground mt-2">{t('event.overview_intro')}</p>

  {#if actionResult?.actionError}
    <Alert class="border-destructive text-destructive mt-6" role="alert"
      >{actionResult.actionError}</Alert
    >
  {:else if actionResult?.actionMessage}
    <Alert class="border-primary/35 bg-secondary/50 mt-6" role="status"
      >{actionResult.actionMessage}</Alert
    >
  {/if}

  <div class="mt-7 grid gap-4 md:grid-cols-3">
    <Card class="shadow-none">
      <CardHeader><CardTitle>{t('event.summary_schedule')}</CardTitle></CardHeader>
      <CardContent>
        <p>{t('event.schedule', { start: data.formattedStart, end: data.formattedEnd })}</p>
      </CardContent>
    </Card>
    <Card class="shadow-none">
      <CardHeader><CardTitle>{t('event.summary_venue')}</CardTitle></CardHeader>
      <CardContent><p>{venue}</p></CardContent>
    </Card>
    <Card class="shadow-none">
      <CardHeader><CardTitle>{t('event.summary_capacity')}</CardTitle></CardHeader>
      <CardContent>
        <p>
          {data.event.capacity === null
            ? t('event.capacity_unlimited')
            : t('event.capacity_people', { count: data.event.capacity })}
        </p>
      </CardContent>
    </Card>
  </div>

  <Card class="mt-6 shadow-none">
    <CardHeader><CardTitle>{t('discord_settings.summary_title')}</CardTitle></CardHeader>
    <CardContent class="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <p class="font-medium">{t(discordPolicyLabelKey(data.discordSettings.policy))}</p>
        <p class="text-muted-foreground mt-1 text-sm">
          {data.discordSettings.integration?.guildNameSnapshot ||
            t('discord_settings.summary_not_configured')}
        </p>
      </div>
      <a
        class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
        href={settingsHref}>{t('discord_settings.manage')}</a
      >
    </CardContent>
  </Card>

  {#if data.capabilities.canManageEvent && !data.event.archivedAt}
    <Card class="mt-6 shadow-none">
      <CardHeader>
        <CardTitle>{t('event.lifecycle_title')}</CardTitle>
        <p class="text-muted-foreground mt-2 text-sm">{t('event.lifecycle_intro')}</p>
      </CardHeader>
      <CardContent class="flex flex-wrap gap-3">
        {#if !data.event.cancelledAt && data.event.visibility === 'draft'}
          <form method="POST" action="?/publish">
            <Button type="submit">{t('event.publish')}</Button>
          </form>
        {:else if !data.event.cancelledAt && data.event.visibility === 'public'}
          <form method="POST" action="?/toggleUnlisted">
            <Button type="submit" variant="outline">{t('event.unlist')}</Button>
          </form>
        {:else if !data.event.cancelledAt && data.event.visibility === 'unlisted'}
          <form method="POST" action="?/toggleUnlisted">
            <Button type="submit">{t('event.relist')}</Button>
          </form>
        {/if}
        {#if !data.event.cancelledAt}
          <a
            class="border-destructive text-destructive inline-flex min-h-12 items-center rounded-md border px-5 text-sm font-semibold"
            href={cancelHref}>{t('event.cancel')}</a
          >
        {/if}
        <a
          class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-5 text-sm font-semibold"
          href={archiveHref}>{t('event.archive')}</a
        >
      </CardContent>
    </Card>
  {/if}
</section>
