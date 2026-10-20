<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { translator } from '$lib/i18n';

  let { data, children } = $props();
  const t = $derived(translator(data.locale));
  const homeHref = $derived(resolve('/app/organizations/[orgId]', { orgId: data.organization.id }));
  const teamHref = $derived(
    resolve('/app/organizations/[orgId]/team', { orgId: data.organization.id })
  );
  const activityHref = $derived(
    resolve('/app/organizations/[orgId]/activity', { orgId: data.organization.id })
  );
  const campaignsHref = $derived(
    resolve('/app/organizations/[orgId]/campaigns', { orgId: data.organization.id })
  );
</script>

<div class="mx-auto max-w-5xl">
  {#if data.organization.suspendedAt}
    <div
      class="mb-6 rounded-md border border-amber-700 bg-amber-50 px-4 py-3 text-amber-950"
      role="status"
    >
      <strong>{t('organization.suspended_title')}</strong>
      <p class="mt-1 text-sm">{t('organization.suspended_read_only')}</p>
    </div>
  {/if}
  <header class="border-b pb-5">
    <p class="text-muted-foreground text-sm font-semibold">{t('organization.workspace')}</p>
    <div class="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <h1 class="min-w-0 truncate text-2xl font-bold tracking-tight sm:text-3xl">
        {data.organization.name}
      </h1>
      <nav aria-label={t('organization.navigation')}>
        <ul class="flex list-none gap-1" role="list">
          <li>
            <a
              class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
              class:bg-accent={page.url.pathname === homeHref}
              aria-current={page.url.pathname === homeHref ? 'page' : undefined}
              href={homeHref}>{t('organization.home_nav')}</a
            >
          </li>
          {#if data.campaignsEnabled && data.organization.actorRole !== 'viewer'}
            <li>
              <a
                class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
                class:bg-accent={page.url.pathname === campaignsHref}
                aria-current={page.url.pathname === campaignsHref ? 'page' : undefined}
                href={campaignsHref}>{t('campaign_admin.nav')}</a
              >
            </li>
          {/if}
          {#if data.capabilities.canViewAudit}
            <li>
              <a
                class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
                class:bg-accent={page.url.pathname === activityHref}
                aria-current={page.url.pathname === activityHref ? 'page' : undefined}
                href={activityHref}>{t('activity.nav')}</a
              >
            </li>
          {/if}
          <li>
            <a
              class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
              class:bg-accent={page.url.pathname === teamHref}
              aria-current={page.url.pathname === teamHref ? 'page' : undefined}
              href={teamHref}>{t('organization.team_nav')}</a
            >
          </li>
        </ul>
      </nav>
    </div>
  </header>
  <div class="pt-7">
    {@render children()}
  </div>
</div>
