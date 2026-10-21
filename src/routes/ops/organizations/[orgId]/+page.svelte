<script lang="ts">
  import DetailPage from '$lib/components/page/detail-page.svelte';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { membershipStatusLabelKey, organizationRoleLabelKey } from '$lib/shared/organization';
  import { stripeOnboardingStatusLabelKey } from '$lib/shared/payment';
  import ActivityList from '$lib/components/activity-list.svelte';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const suspensionHref = $derived(
    data.organization.suspendedAt
      ? resolve('/ops/organizations/[orgId]/unsuspend', { orgId: data.organization.id })
      : resolve('/ops/organizations/[orgId]/suspend', { orgId: data.organization.id })
  );
</script>

<svelte:head><title>{data.organization.name} · {t('brand.name')}</title></svelte:head>

<DetailPage>
  {#snippet actions()}<a
      href={suspensionHref}
      class={[
        'btn btn-ghost',
        data.organization.suspendedAt
          ? 'inline-flex h-12 items-center justify-center px-5'
          : 'inline-flex h-12 items-center justify-center px-5'
      ].join(' ')}
    >
      {t(data.organization.suspendedAt ? 'ops.organization.unsuspend' : 'ops.organization.suspend')}
    </a>{/snippet}
  {#snippet title()}{data.organization.name}{/snippet}
  {#snippet body()}
    <div class="grid gap-6">
      <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <a href={resolve('/ops/organizations')} class="link">{t('ops.back_organizations')}</a>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <span
              class={data.organization.suspendedAt ? 'badge badge-error' : 'badge badge-success'}
            >
              {t(data.organization.suspendedAt ? 'ops.status.suspended' : 'ops.status.active')}
            </span>
          </div>
          <p class="mt-2">
            /{data.organization.slug} · {t('ops.created_value', {
              date: data.organization.createdAtLabel
            })}
          </p>
        </div>
      </header>

      <div class="grid gap-6 lg:grid-cols-2">
        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <h2 class="card-title">{t('ops.organization.connect')}</h2>
          </div>
          <div class="card-body">
            {#if data.connect}
              <dl class="grid gap-3">
                <div class="flex justify-between gap-4">
                  <dt>{t('ops.status')}</dt>
                  <dd>
                    {t(stripeOnboardingStatusLabelKey(data.connect.onboardingStatus))}
                  </dd>
                </div>
                <div class="flex justify-between gap-4">
                  <dt>{t('ops.organization.charges')}</dt>
                  <dd>{t(data.connect.chargesEnabled ? 'ops.yes' : 'ops.no')}</dd>
                </div>
                <div class="flex justify-between gap-4">
                  <dt>{t('ops.organization.payouts')}</dt>
                  <dd>{t(data.connect.payoutsEnabled ? 'ops.yes' : 'ops.no')}</dd>
                </div>
              </dl>
            {:else}
              <p>{t('stripe.status.not_connected')}</p>
            {/if}
          </div>
        </div>

        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <h2 class="card-title">{t('ops.organization.events')}</h2>
          </div>
          <div class="card-body">
            {#if data.events.length === 0}
              <p>{t('ops.organization.events_empty')}</p>
            {:else}
              <ul>
                {#each data.events as event (event.id)}
                  <li class="py-3 first:pt-0 last:pb-0">
                    <a href={resolve('/app/events/[eventId]', { eventId: event.id })} class="link"
                      >{event.title}</a
                    >
                    <p class="mt-1">
                      {t('ops.organization.registration_count', {
                        count: event.activeRegistrationCount
                      })}{#if event.archived}
                        · {t('event.badge_archived')}{/if}
                    </p>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      </div>

      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <h2 class="card-title">{t('ops.organization.members')}</h2>
        </div>
        <div class="card-body">
          <div class="overflow-x-auto">
            <table class="table w-full">
              <caption class="sr-only">{t('ops.organization.members')}</caption>
              <thead
                ><tr
                  ><th scope="col" class="px-3 py-3">{t('ops.user.name')}</th><th
                    scope="col"
                    class="px-3 py-3">{t('ops.user.discord')}</th
                  ><th scope="col" class="px-3 py-3">{t('team.role')}</th><th
                    scope="col"
                    class="px-3 py-3">{t('ops.status')}</th
                  ></tr
                ></thead
              >
              <tbody>
                {#each data.members as member (member.id)}
                  <tr
                    ><th scope="row" class="px-3 py-4"
                      ><a
                        href={resolve('/ops/users/[userId]', { userId: member.userId })}
                        class="link">{member.displayName}</a
                      ></th
                    ><td class="px-3 py-4">@{member.username}</td><td class="px-3 py-4"
                      >{t(organizationRoleLabelKey(member.role))}</td
                    ><td class="px-3 py-4">{t(membershipStatusLabelKey(member.status))}</td></tr
                  >
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <h2 class="card-title">{t('ops.recent_activity')}</h2>
        </div>
        <div class="card-body">
          <ActivityList locale={data.locale} rows={data.recentAudits} showEvent />
        </div>
      </div>
    </div>
  {/snippet}
</DetailPage>
