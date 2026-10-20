<script lang="ts">
  import { CalendarDays, CreditCard, HandHeart, Users } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { eventVisibilityLabelKey } from '$lib/shared/event';
  import { organizationRoleLabelKey } from '$lib/shared/organization';
  import { stripeOnboardingStatusLabelKey } from '$lib/shared/payment';
  import { Alert } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data, form: rawStripeActionResult } = $props();
  const t = $derived(translator(data.locale));
  const activeMembers = $derived(
    data.members.filter((member) => member.status === 'active').length
  );
  const newEventHref = $derived(
    resolve('/app/organizations/[orgId]/events/new', { orgId: data.organization.id })
  );
  const campaignSummary = $derived(data.campaignSummary);
  type StripeActionResult = {
    stripeActionError?: string;
    stripeActionMessage?: string;
  } | null;
  const stripeActionResult = $derived(rawStripeActionResult as StripeActionResult);
</script>

<svelte:head><title>{data.organization.name} · {t('brand.name')}</title></svelte:head>

<section aria-labelledby="overview-title">
  <h2 id="overview-title" class="text-xl font-bold">{t('organization.overview')}</h2>
  <p class="text-muted-foreground mt-2">
    {t('organization.role_summary', {
      role: t(organizationRoleLabelKey(data.organization.actorRole))
    })}
  </p>

  {#if stripeActionResult?.stripeActionError}
    <Alert class="border-destructive text-destructive mt-6" role="alert"
      >{stripeActionResult.stripeActionError}</Alert
    >
  {:else if stripeActionResult?.stripeActionMessage || data.stripeFlash}
    <Alert class="border-primary/35 bg-secondary/50 mt-6" role="status"
      >{stripeActionResult?.stripeActionMessage ?? data.stripeFlash}</Alert
    >
  {/if}

  <div class="mt-7 grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
    <Card class="shadow-none">
      <CardHeader class="flex-row items-center gap-3">
        <span
          class="bg-secondary text-secondary-foreground inline-flex size-11 items-center justify-center rounded-lg"
          ><Users aria-hidden="true" size={21} /></span
        >
        <div>
          <CardTitle>{t('organization.team_summary_title')}</CardTitle>
          <p class="text-muted-foreground mt-1 text-sm">
            {t(
              activeMembers === 1
                ? 'organization.team_summary_one'
                : 'organization.team_summary_other',
              { count: activeMembers }
            )}
          </p>
        </div>
      </CardHeader>
    </Card>
    <Card class="bg-secondary/45 shadow-none">
      <CardContent class="pt-6">
        <p class="text-sm font-semibold">{t('organization.setup_status')}</p>
        <p class="mt-2 text-2xl font-bold">{t('organization.setup_ready')}</p>
      </CardContent>
    </Card>
  </div>

  <div
    class={campaignSummary
      ? 'mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-[1.1fr_1.1fr_0.8fr]'
      : 'mt-4 grid gap-4 lg:grid-cols-[1.35fr_0.65fr]'}
  >
    <Card class="shadow-none">
      <CardHeader class="flex-row items-center justify-between gap-4">
        <div>
          <CalendarDays aria-hidden="true" class="text-primary" size={24} />
          <CardTitle class="mt-4">{t('organization.events_title')}</CardTitle>
        </div>
        {#if data.capabilities.canManageEvent}
          <a
            class="bg-primary text-primary-foreground inline-flex min-h-12 items-center rounded-md px-5 text-sm font-semibold"
            href={newEventHref}>{t('event.create_cta')}</a
          >
        {/if}
      </CardHeader>
      <CardContent>
        {#if data.events.length === 0}
          <p class="text-muted-foreground">{t('organization.events_empty')}</p>
        {:else}
          <ul class="divide-y" role="list">
            {#each data.events as event (event.id)}
              <li class="py-4 first:pt-0 last:pb-0">
                <a
                  class="hover:text-primary block font-semibold"
                  href={resolve('/app/events/[eventId]', { eventId: event.id })}>{event.title}</a
                >
                <p class="text-muted-foreground mt-1 text-sm">
                  {t('organization.event_date', { date: event.formattedStartsAt })}
                </p>
                <div class="mt-2 flex flex-wrap gap-2">
                  <Badge class="bg-secondary text-secondary-foreground"
                    >{t(eventVisibilityLabelKey(event.visibility))}</Badge
                  >
                  {#if event.cancelledAt}
                    <Badge class="bg-destructive text-white">{t('event.badge_cancelled')}</Badge>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </CardContent>
    </Card>
    {#if campaignSummary}
      <Card class="shadow-none">
        <CardHeader class="flex-row items-start justify-between gap-4">
          <div>
            <HandHeart aria-hidden="true" class="text-primary" size={24} />
            <CardTitle class="mt-4">{t('organization.campaigns_summary_title')}</CardTitle>
            <p class="text-muted-foreground mt-2 text-sm">
              {t('organization.campaigns_summary_total', { count: campaignSummary.total })}
            </p>
          </div>
          <a
            class="hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-semibold"
            href={campaignSummary.href}>{t('organization.campaigns_summary_open')}</a
          >
        </CardHeader>
        <CardContent>
          <dl class="grid grid-cols-2 gap-3">
            {#each campaignSummary.counts as count (count.label)}
              <div class="bg-muted/55 rounded-lg px-4 py-3">
                <dt class="text-muted-foreground text-xs font-semibold">{count.label}</dt>
                <dd class="mt-1 text-xl font-bold tabular-nums">{count.count}</dd>
              </div>
            {/each}
          </dl>
          {#if campaignSummary.latest.length > 0}
            <div class="mt-6">
              <h3 class="text-sm font-semibold">{t('organization.campaigns_summary_latest')}</h3>
              <ul class="mt-2 divide-y" role="list">
                {#each campaignSummary.latest as campaign (campaign.id)}
                  <li class="flex flex-wrap items-center justify-between gap-3 py-3">
                    <a
                      class="hover:text-primary font-semibold"
                      href={resolve('/app/campaigns/[campaignId]', { campaignId: campaign.id })}
                      >{campaign.title}</a
                    >
                    <Badge class="bg-secondary text-secondary-foreground">
                      {campaign.statusLabel}
                    </Badge>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </CardContent>
      </Card>
    {/if}
    <Card class="shadow-none">
      <CardHeader>
        <CreditCard aria-hidden="true" class="text-primary" size={24} />
        <CardTitle class="mt-4">{t('stripe.card_title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {#if data.stripeMode === 'disabled'}
          <Badge class="bg-secondary text-secondary-foreground">{t('stripe.not_configured')}</Badge>
          <p class="text-muted-foreground mt-3 text-sm">{t('stripe.not_configured_body')}</p>
        {:else}
          <Badge
            class={data.stripeAccount?.onboardingStatus === 'ready'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground'}
          >
            {t(
              stripeOnboardingStatusLabelKey(
                data.stripeAccount?.onboardingStatus ?? 'not_connected'
              )
            )}
          </Badge>
          <p class="text-muted-foreground mt-3 text-sm">{t('stripe.card_body')}</p>
          {#if data.capabilities.canManageStripe}
            <div class="mt-5 flex flex-wrap gap-3">
              {#if data.stripeAccount?.onboardingStatus !== 'ready'}
                <form method="POST" action="?/startOnboarding">
                  <Button type="submit">{t('stripe.start')}</Button>
                </form>
              {/if}
              {#if data.stripeAccount}
                <form method="POST" action="?/syncStatus">
                  <Button type="submit" variant="outline">{t('stripe.sync')}</Button>
                </form>
              {/if}
            </div>
          {:else}
            <p class="text-muted-foreground mt-4 text-sm">{t('stripe.owner_only')}</p>
          {/if}
        {/if}
      </CardContent>
    </Card>
  </div>
</section>
