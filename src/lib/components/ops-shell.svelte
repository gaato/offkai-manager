<script lang="ts">
  import type { Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { Activity, Building2, CircleDollarSign, Gauge, LogOut, Users } from '@lucide/svelte';
  import { translator, type Locale } from '$lib/i18n';

  let {
    displayName,
    locale,
    children
  }: { displayName: string; locale: Locale; children: Snippet } = $props();

  const t = $derived(translator(locale));
  const navigation = $derived([
    { href: resolve('/ops'), label: t('ops.nav.dashboard'), icon: Gauge },
    { href: '/ops/organizations', label: t('ops.nav.organizations'), icon: Building2 },
    { href: '/ops/users', label: t('ops.nav.users'), icon: Users },
    { href: '/ops/activity', label: t('ops.nav.activity'), icon: Activity },
    {
      href: '/ops/payment-conflicts',
      label: t('ops.nav.payment_conflicts'),
      icon: CircleDollarSign
    }
  ]);

  function isCurrent(href: string): boolean {
    if (href === '/ops') return page.url.pathname === href;
    return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
  }

  function languageHref(language: Locale): string {
    const url = new URL(page.url);
    url.searchParams.set('lang', language);
    return `${url.pathname}${url.search}`;
  }
</script>

<div class="min-h-[100dvh] bg-slate-950 text-slate-100">
  <header class="border-b border-slate-800 bg-slate-950">
    <div class="mx-auto flex min-h-16 max-w-[90rem] items-center gap-4 px-4 sm:px-6">
      <a class="text-lg font-bold tracking-tight" href={resolve('/ops')}>{t('ops.shell_title')}</a>
      <span class="hidden text-sm text-slate-400 sm:inline">{t('brand.name')}</span>
      <nav class="ml-auto" aria-label={t('ops.account_navigation')}>
        <ul class="flex list-none items-center gap-1" role="list">
          <li>
            <a
              class="inline-flex min-h-12 items-center rounded-md px-3 hover:bg-slate-800"
              href={languageHref('ja')}
              hreflang="ja"
              lang="ja">{t('nav.japanese')}</a
            >
          </li>
          <li>
            <a
              class="inline-flex min-h-12 items-center rounded-md px-3 hover:bg-slate-800"
              href={languageHref('en')}
              hreflang="en"
              lang="en">{t('nav.english')}</a
            >
          </li>
          <li>
            <form method="POST" action={resolve('/auth/logout')}>
              <button
                class="inline-flex min-h-12 items-center gap-2 rounded-md px-3 font-semibold hover:bg-slate-800"
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

  <div class="mx-auto grid max-w-[90rem] md:grid-cols-[16rem_minmax(0,1fr)]">
    <aside
      class="border-b border-slate-800 bg-slate-900/70 px-4 py-4 md:min-h-[calc(100dvh-4rem)] md:border-r md:border-b-0 md:px-5 md:py-7"
      aria-label={t('ops.navigation')}
    >
      <p class="mb-4 truncate px-3 text-sm text-slate-400">
        {t('session.signed_in_as', { name: displayName })}
      </p>
      <nav>
        <ul class="flex list-none gap-1 overflow-x-auto md:grid" role="list">
          {#each navigation as item (item.href)}
            <li>
              <a
                class="flex min-h-11 items-center gap-3 rounded-md px-3 font-semibold hover:bg-slate-800"
                class:bg-slate-800={isCurrent(item.href)}
                href={item.href}
                aria-current={isCurrent(item.href) ? 'page' : undefined}
              >
                <item.icon aria-hidden="true" size={18} />
                <span class="whitespace-nowrap">{item.label}</span>
              </a>
            </li>
          {/each}
        </ul>
      </nav>
    </aside>

    <main
      id="main-content"
      tabindex="-1"
      class="min-w-0 bg-slate-50 px-4 py-8 text-slate-950 sm:px-7 lg:px-10 lg:py-10"
    >
      {@render children()}
    </main>
  </div>
</div>
