<script lang="ts">
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { membershipStatusLabelKey, organizationRoleLabelKey } from '$lib/shared/organization';
  import { stripeOnboardingStatusLabelKey } from '$lib/shared/payment';
  import ActivityList from '$lib/components/activity-list.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const suspensionHref = $derived(
    data.organization.suspendedAt
      ? resolve('/ops/organizations/[orgId]/unsuspend', { orgId: data.organization.id })
      : resolve('/ops/organizations/[orgId]/suspend', { orgId: data.organization.id })
  );
</script>

<svelte:head><title>{data.organization.name} · {t('brand.name')}</title></svelte:head>

<div class="grid gap-6">
  <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <a
        class="text-sm font-semibold text-slate-600 underline-offset-4 hover:underline"
        href={resolve('/ops/organizations')}>{t('ops.back_organizations')}</a
      >
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <h1 class="text-3xl font-bold tracking-tight">{data.organization.name}</h1>
        <Badge
          class={data.organization.suspendedAt
            ? 'bg-amber-100 text-amber-950'
            : 'bg-emerald-100 text-emerald-950'}
        >
          {t(data.organization.suspendedAt ? 'ops.status.suspended' : 'ops.status.active')}
        </Badge>
      </div>
      <p class="mt-2 text-slate-600">
        /{data.organization.slug} · {t('ops.created_value', {
          date: data.organization.createdAtLabel
        })}
      </p>
    </div>
    <a
      class={data.organization.suspendedAt
        ? 'inline-flex h-12 items-center justify-center rounded-md border bg-white px-5 text-sm font-semibold hover:bg-slate-100'
        : 'inline-flex h-12 items-center justify-center rounded-md bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800'}
      href={suspensionHref}
    >
      {t(data.organization.suspendedAt ? 'ops.organization.unsuspend' : 'ops.organization.suspend')}
    </a>
  </header>

  <div class="grid gap-6 lg:grid-cols-2">
    <Card class="border-slate-200 shadow-none">
      <CardHeader><CardTitle>{t('ops.organization.connect')}</CardTitle></CardHeader>
      <CardContent>
        {#if data.connect}
          <dl class="grid gap-3 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-slate-600">{t('ops.status')}</dt>
              <dd class="font-semibold">
                {t(stripeOnboardingStatusLabelKey(data.connect.onboardingStatus))}
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-slate-600">{t('ops.organization.charges')}</dt>
              <dd>{t(data.connect.chargesEnabled ? 'ops.yes' : 'ops.no')}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-slate-600">{t('ops.organization.payouts')}</dt>
              <dd>{t(data.connect.payoutsEnabled ? 'ops.yes' : 'ops.no')}</dd>
            </div>
          </dl>
        {:else}
          <p class="text-slate-600">{t('stripe.status.not_connected')}</p>
        {/if}
      </CardContent>
    </Card>

    <Card class="border-slate-200 shadow-none">
      <CardHeader><CardTitle>{t('ops.organization.events')}</CardTitle></CardHeader>
      <CardContent>
        {#if data.events.length === 0}
          <p class="text-slate-600">{t('ops.organization.events_empty')}</p>
        {:else}
          <ul class="divide-y divide-slate-200">
            {#each data.events as event (event.id)}
              <li class="py-3 first:pt-0 last:pb-0">
                <a
                  class="font-semibold underline-offset-4 hover:underline"
                  href={resolve('/app/events/[eventId]', { eventId: event.id })}>{event.title}</a
                >
                <p class="mt-1 text-sm text-slate-600">
                  {t('ops.organization.registration_count', {
                    count: event.activeRegistrationCount
                  })}{#if event.archived}
                    · {t('event.badge_archived')}{/if}
                </p>
              </li>
            {/each}
          </ul>
        {/if}
      </CardContent>
    </Card>
  </div>

  <Card class="border-slate-200 shadow-none">
    <CardHeader><CardTitle>{t('ops.organization.members')}</CardTitle></CardHeader>
    <CardContent>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <caption class="sr-only">{t('ops.organization.members')}</caption>
          <thead class="border-b border-slate-200 text-slate-600"
            ><tr
              ><th class="px-3 py-3" scope="col">{t('ops.user.name')}</th><th
                class="px-3 py-3"
                scope="col">{t('ops.user.discord')}</th
              ><th class="px-3 py-3" scope="col">{t('team.role')}</th><th
                class="px-3 py-3"
                scope="col">{t('ops.status')}</th
              ></tr
            ></thead
          >
          <tbody class="divide-y divide-slate-200">
            {#each data.members as member (member.id)}
              <tr
                ><th class="px-3 py-4" scope="row"
                  ><a
                    class="font-semibold underline-offset-4 hover:underline"
                    href={resolve('/ops/users/[userId]', { userId: member.userId })}
                    >{member.displayName}</a
                  ></th
                ><td class="px-3 py-4">@{member.username}</td><td class="px-3 py-4"
                  >{t(organizationRoleLabelKey(member.role))}</td
                ><td class="px-3 py-4">{t(membershipStatusLabelKey(member.status))}</td></tr
              >
            {/each}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>

  <Card class="border-slate-200 shadow-none">
    <CardHeader><CardTitle>{t('ops.recent_activity')}</CardTitle></CardHeader>
    <CardContent
      ><ActivityList locale={data.locale} rows={data.recentAudits} showEvent /></CardContent
    >
  </Card>
</div>
