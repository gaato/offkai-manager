<script lang="ts">
  import DetailPage from '$lib/components/page/detail-page.svelte';
  import { CalendarDays, CreditCard, Users } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { eventVisibilityLabelKey } from '$lib/shared/event';
  import { organizationRoleLabelKey } from '$lib/shared/organization';
  import { stripeOnboardingStatusLabelKey } from '$lib/shared/payment';

  let { data, form: rawStripeActionResult } = $props();
  const t = $derived(translator(data.locale));
  const activeMembers = $derived(
    data.members.filter((member) => member.status === 'active').length
  );
  const newEventHref = $derived(
    resolve('/app/organizations/[orgId]/events/new', { orgId: data.organization.id })
  );
  type StripeActionResult = {
    stripeActionError?: string;
    stripeActionMessage?: string;
  } | null;
  const stripeActionResult = $derived(rawStripeActionResult as StripeActionResult);
</script>

<svelte:head><title>{data.organization.name} · {t('brand.name')}</title></svelte:head>

<DetailPage titleId="overview-title">
  {#snippet actions()}{#if data.capabilities.canManageEvent}<a
        href={newEventHref}
        class="btn btn-primary inline-flex min-h-12 items-center px-5">{t('event.create_cta')}</a
      >{/if}{/snippet}
  {#snippet title()}{t('organization.overview')}{/snippet}
  {#snippet body()}
    <section aria-labelledby="overview-title">
      <p class="mt-2">
        {t('organization.role_summary', {
          role: t(organizationRoleLabelKey(data.organization.actorRole))
        })}
      </p>

      {#if stripeActionResult?.stripeActionError}
        <div role="alert" class="alert alert-error mt-6">
          {stripeActionResult.stripeActionError}
        </div>
      {:else if stripeActionResult?.stripeActionMessage || data.stripeFlash}
        <div role="status" class="alert alert-success mt-6">
          {stripeActionResult?.stripeActionMessage ?? data.stripeFlash}
        </div>
      {/if}

      <div class="mt-7 grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <div class="card card-border bg-base-100">
          <div class="card-body flex-row items-center gap-2 gap-3 pb-0">
            <span class="bg-secondary inline-flex size-11 items-center justify-center"
              ><Users aria-hidden="true" size={21} /></span
            >
            <div>
              <h2 class="card-title">{t('organization.team_summary_title')}</h2>
              <p class="mt-1">
                {t(
                  activeMembers === 1
                    ? 'organization.team_summary_one'
                    : 'organization.team_summary_other',
                  { count: activeMembers }
                )}
              </p>
            </div>
          </div>
        </div>
        <div class="card card-border bg-base-100">
          <div class="card-body pt-6">
            <p>{t('organization.setup_status')}</p>
            <p class="mt-2">{t('organization.setup_ready')}</p>
          </div>
        </div>
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <div class="card card-border bg-base-100">
          <div class="card-body flex-row items-center justify-between gap-2 gap-4 pb-0">
            <div>
              <CalendarDays aria-hidden="true" size={24} />
              <h2 class="card-title mt-4">{t('organization.events_title')}</h2>
            </div>
          </div>
          <div class="card-body">
            {#if data.events.length === 0}
              <p>{t('organization.events_empty')}</p>
            {:else}
              <ul role="list">
                {#each data.events as event (event.id)}
                  <li class="py-4 first:pt-0 last:pb-0">
                    <a
                      href={resolve('/app/events/[eventId]', { eventId: event.id })}
                      class="link block">{event.title}</a
                    >
                    <p class="mt-1">
                      {t('organization.event_date', { date: event.formattedStartsAt })}
                    </p>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <span class="badge badge-secondary"
                        >{t(eventVisibilityLabelKey(event.visibility))}</span
                      >
                      {#if event.cancelledAt}
                        <span class="badge badge-error">{t('event.badge_cancelled')}</span>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>

        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <CreditCard aria-hidden="true" size={24} />
            <h2 class="card-title mt-4">{t('stripe.card_title')}</h2>
          </div>
          <div class="card-body">
            {#if data.stripeMode === 'disabled'}
              <span class="badge badge-secondary">{t('stripe.not_configured')}</span>
              <p class="mt-3">{t('stripe.not_configured_body')}</p>
            {:else}
              <span
                class={data.stripeAccount?.onboardingStatus === 'ready'
                  ? 'badge badge-primary'
                  : 'badge badge-ghost'}
              >
                {t(
                  stripeOnboardingStatusLabelKey(
                    data.stripeAccount?.onboardingStatus ?? 'not_connected'
                  )
                )}
              </span>
              <p class="mt-3">{t('stripe.card_body')}</p>
              {#if data.capabilities.canManageStripe}
                <div class="mt-5 flex flex-wrap gap-3">
                  {#if data.stripeAccount?.onboardingStatus !== 'ready'}
                    <form method="POST" action="?/startOnboarding">
                      <button type="submit" class="btn btn-primary">{t('stripe.start')}</button>
                    </form>
                  {/if}
                  {#if data.stripeAccount}
                    <form method="POST" action="?/syncStatus">
                      <button type="submit" class="btn btn-outline">{t('stripe.sync')}</button>
                    </form>
                  {/if}
                </div>
              {:else}
                <p class="mt-4">{t('stripe.owner_only')}</p>
              {/if}
            {/if}
          </div>
        </div>
      </div>
    </section>
  {/snippet}
</DetailPage>
