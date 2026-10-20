<script lang="ts">
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { membershipStatusLabelKey, organizationRoleLabelKey } from '$lib/shared/organization';
  import ActivityList from '$lib/components/activity-list.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const suspensionHref = $derived(
    data.user.suspendedAt
      ? resolve('/ops/users/[userId]/unsuspend', { userId: data.user.id })
      : resolve('/ops/users/[userId]/suspend', { userId: data.user.id })
  );
</script>

<svelte:head><title>{data.user.displayName} · {t('brand.name')}</title></svelte:head>

<div class="grid gap-6">
  <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <a
        class="text-sm font-semibold text-slate-600 underline-offset-4 hover:underline"
        href={resolve('/ops/users')}>{t('ops.back_users')}</a
      >
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <h1 class="text-3xl font-bold tracking-tight">{data.user.displayName}</h1>
        <Badge
          class={data.user.suspendedAt
            ? 'bg-amber-100 text-amber-950'
            : 'bg-emerald-100 text-emerald-950'}
          >{t(data.user.suspendedAt ? 'ops.status.suspended' : 'ops.status.active')}</Badge
        >
      </div>
      <p class="mt-2 text-slate-600">@{data.user.username} · {data.user.discordUserId}</p>
      <p class="mt-1 text-sm text-slate-600">
        {t('ops.user.registration_count', { count: data.user.registrationCount })} · {t(
          'ops.created_value',
          { date: data.user.createdAtLabel }
        )}
      </p>
    </div>
    <a
      class={data.user.suspendedAt
        ? 'inline-flex h-12 items-center justify-center rounded-md border bg-white px-5 text-sm font-semibold hover:bg-slate-100'
        : 'inline-flex h-12 items-center justify-center rounded-md bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800'}
      href={suspensionHref}
      >{t(data.user.suspendedAt ? 'ops.user.unsuspend' : 'ops.user.suspend')}</a
    >
  </header>

  <Card class="border-slate-200 shadow-none">
    <CardHeader><CardTitle>{t('ops.user.memberships')}</CardTitle></CardHeader>
    <CardContent>
      {#if data.memberships.length === 0}
        <p class="text-slate-600">{t('ops.user.memberships_empty')}</p>
      {:else}
        <ul class="divide-y divide-slate-200">
          {#each data.memberships as membership (membership.organizationId)}
            <li class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <a
                class="font-semibold underline-offset-4 hover:underline"
                href={resolve('/ops/organizations/[orgId]', { orgId: membership.organizationId })}
                >{membership.organizationName}</a
              >
              <span class="text-sm text-slate-600"
                >{t(organizationRoleLabelKey(membership.role))} · {t(
                  membershipStatusLabelKey(membership.status)
                )}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
    </CardContent>
  </Card>

  <Card class="border-slate-200 shadow-none">
    <CardHeader><CardTitle>{t('ops.recent_activity')}</CardTitle></CardHeader>
    <CardContent
      ><ActivityList locale={data.locale} rows={data.recentAudits} showEvent /></CardContent
    >
  </Card>
</div>
