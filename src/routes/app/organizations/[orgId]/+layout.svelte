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
</script>

<div class="mx-auto max-w-5xl">
  {#if data.organization.suspendedAt}
    <div role="status" class="alert alert-warning mb-6">
      <strong>{t('organization.suspended_title')}</strong>
      <p class="mt-1">{t('organization.suspended_read_only')}</p>
    </div>
  {/if}
  <header class="pb-5">
    <p>{t('organization.workspace')}</p>
    <div class="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <p class="card-title min-w-0">
        {data.organization.name}
      </p>
      <nav aria-label={t('organization.navigation')}>
        <ul class="menu menu-horizontal flex-wrap">
          <li>
            <a
              aria-current={page.url.pathname === homeHref ? 'page' : undefined}
              href={homeHref}
              class={page.url.pathname === homeHref ? 'menu-active' : ''}
              >{t('organization.home_nav')}</a
            >
          </li>

          {#if data.capabilities.canViewAudit}
            <li>
              <a
                aria-current={page.url.pathname === activityHref ? 'page' : undefined}
                href={activityHref}
                class={page.url.pathname === activityHref ? 'menu-active' : ''}
                >{t('activity.nav')}</a
              >
            </li>
          {/if}

          {#if data.capabilities.canManageStripe}
            <li>
              <a data-sveltekit-reload href={`/app/organizations/${data.organization.id}/payouts`}
                >{t('payouts.title')}</a
              >
            </li>
          {/if}
          <li>
            <a
              aria-current={page.url.pathname === teamHref ? 'page' : undefined}
              href={teamHref}
              class={page.url.pathname === teamHref ? 'menu-active' : ''}
              >{t('organization.team_nav')}</a
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
