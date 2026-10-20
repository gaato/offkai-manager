<script lang="ts">
  import type { Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { Building2, LayoutDashboard, LogOut } from '@lucide/svelte';
  import { translator, type Locale } from '$lib/i18n';

  interface AppShellSession {
    displayName: string;
  }

  interface AppShellOrganization {
    id: string;
    name: string;
  }

  let {
    session,
    organizations,
    locale,
    children
  }: {
    session: AppShellSession;
    organizations: AppShellOrganization[];
    locale: Locale;
    children: Snippet;
  } = $props();

  const t = $derived(translator(locale));
  const dashboardHref = resolve('/app');

  function organizationHref(organizationId: string): string {
    return resolve('/app/organizations/[orgId]', { orgId: organizationId });
  }

  function organizationIsCurrent(organizationId: string): boolean {
    const href = organizationHref(organizationId);
    return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
  }

  function languageHref(language: Locale): string {
    const url = new URL(page.url);
    url.searchParams.set('lang', language);
    return `${url.pathname}${url.search}`;
  }
</script>

<div class="bg-muted/35 min-h-[100dvh]">
  <header class="bg-background border-b">
    <div class="mx-auto flex min-h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
      <a class="shrink-0 text-lg font-bold tracking-tight" href={dashboardHref}>{t('brand.name')}</a
      >
      <nav class="ml-auto" aria-label={t('app.account_navigation')}>
        <ul class="flex list-none items-center gap-1" role="list">
          <li>
            <a
              class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-3"
              href={languageHref('ja')}
              hreflang="ja"
              aria-current={locale === 'ja' ? 'page' : undefined}
              lang="ja">{t('nav.japanese')}</a
            >
          </li>
          <li>
            <a
              class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-3"
              href={languageHref('en')}
              hreflang="en"
              aria-current={locale === 'en' ? 'page' : undefined}
              lang="en">{t('nav.english')}</a
            >
          </li>
          <li>
            <form method="POST" action={resolve('/auth/logout')}>
              <button
                class="hover:bg-accent inline-flex min-h-12 items-center gap-2 rounded-md px-3 font-semibold"
                type="submit"
                aria-label={t('session.logout')}
              >
                <LogOut aria-hidden="true" size={17} />
                <span class="hidden sm:inline">{t('session.logout')}</span>
              </button>
            </form>
          </li>
        </ul>
      </nav>
    </div>
  </header>

  <div class="mx-auto grid max-w-7xl md:grid-cols-[15rem_minmax(0,1fr)]">
    <aside
      class="bg-background border-b px-4 py-4 md:min-h-[calc(100dvh-4rem)] md:border-r md:border-b-0 md:px-5 md:py-7"
      aria-label={t('app.workspace_navigation')}
    >
      <p class="text-muted-foreground mb-3 truncate px-3 text-sm">
        {t('session.signed_in_as', { name: session.displayName })}
      </p>
      <nav>
        <ul class="flex list-none gap-1 overflow-x-auto md:grid" role="list">
          <li>
            <a
              class="hover:bg-accent flex min-h-11 items-center gap-3 rounded-md px-3 font-semibold"
              class:bg-accent={page.url.pathname === '/app'}
              href={dashboardHref}
              aria-current={page.url.pathname === '/app' ? 'page' : undefined}
            >
              <LayoutDashboard aria-hidden="true" size={18} />
              {t('app.dashboard')}
            </a>
          </li>
          {#each organizations as organization (organization.id)}
            <li>
              <a
                class="hover:bg-accent flex min-h-11 max-w-56 items-center gap-3 rounded-md px-3 font-medium"
                class:bg-accent={organizationIsCurrent(organization.id)}
                href={organizationHref(organization.id)}
                aria-current={organizationIsCurrent(organization.id) ? 'page' : undefined}
              >
                <Building2 aria-hidden="true" class="shrink-0" size={18} />
                <span class="truncate">{organization.name}</span>
              </a>
            </li>
          {/each}
        </ul>
      </nav>
    </aside>

    <main id="main-content" tabindex="-1" class="min-w-0 px-4 py-8 sm:px-7 lg:px-10 lg:py-10">
      {@render children()}
    </main>
  </div>
</div>
