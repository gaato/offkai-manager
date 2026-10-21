<script lang="ts">
  import DetailPage from '$lib/components/page/detail-page.svelte';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { membershipStatusLabelKey, organizationRoleLabelKey } from '$lib/shared/organization';
  import ActivityList from '$lib/components/activity-list.svelte';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const suspensionHref = $derived(
    data.user.suspendedAt
      ? resolve('/ops/users/[userId]/unsuspend', { userId: data.user.id })
      : resolve('/ops/users/[userId]/suspend', { userId: data.user.id })
  );
</script>

<svelte:head><title>{data.user.displayName} · {t('brand.name')}</title></svelte:head>

<DetailPage>
  {#snippet actions()}<a
      href={suspensionHref}
      class={[
        'btn btn-ghost',
        data.user.suspendedAt
          ? 'inline-flex h-12 items-center justify-center px-5'
          : 'inline-flex h-12 items-center justify-center px-5'
      ].join(' ')}>{t(data.user.suspendedAt ? 'ops.user.unsuspend' : 'ops.user.suspend')}</a
    >{/snippet}
  {#snippet title()}{data.user.displayName}{/snippet}
  {#snippet body()}
    <div class="grid gap-6">
      <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <a href={resolve('/ops/users')} class="link">{t('ops.back_users')}</a>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <span class={data.user.suspendedAt ? 'badge badge-error' : 'badge badge-success'}
              >{t(data.user.suspendedAt ? 'ops.status.suspended' : 'ops.status.active')}</span
            >
          </div>
          <p class="mt-2">@{data.user.username} · {data.user.discordUserId}</p>
          <p class="mt-1">
            {t('ops.user.registration_count', { count: data.user.registrationCount })} · {t(
              'ops.created_value',
              { date: data.user.createdAtLabel }
            )}
          </p>
        </div>
      </header>

      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <h2 class="card-title">{t('ops.user.memberships')}</h2>
        </div>
        <div class="card-body">
          {#if data.memberships.length === 0}
            <p>{t('ops.user.memberships_empty')}</p>
          {:else}
            <ul>
              {#each data.memberships as membership (membership.organizationId)}
                <li
                  class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <a
                    href={resolve('/ops/organizations/[orgId]', {
                      orgId: membership.organizationId
                    })}
                    class="link">{membership.organizationName}</a
                  >
                  <span
                    >{t(organizationRoleLabelKey(membership.role))} · {t(
                      membershipStatusLabelKey(membership.status)
                    )}</span
                  >
                </li>
              {/each}
            </ul>
          {/if}
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
