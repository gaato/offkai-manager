<script lang="ts">
  import type { Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { translator, type Locale } from '$lib/i18n';

  let {
    title,
    home,
    displayName,
    locale,
    navigationLabel,
    accountLabel,
    links,
    children
  }: {
    title: string;
    home: string;
    displayName: string;
    locale: Locale;
    navigationLabel: string;
    accountLabel: string;
    links: { href: string; label: string }[];
    children: Snippet;
  } = $props();
  const t = $derived(translator(locale));

  function languageHref(language: Locale): string {
    const url = new URL(page.url);
    url.searchParams.set('lang', language);
    return `${url.pathname}${url.search}`;
  }
  function isCurrent(href: string): boolean {
    return (
      page.url.pathname === href || (href !== home && page.url.pathname.startsWith(`${href}/`))
    );
  }
</script>

{#snippet menu()}
  <ul class="menu w-full">
    {#each links as item (item.href)}
      <li>
        <a
          href={item.href}
          class={isCurrent(item.href) ? 'menu-active' : ''}
          aria-current={isCurrent(item.href) ? 'page' : undefined}>{item.label}</a
        >
      </li>
    {/each}
  </ul>
{/snippet}

<!-- CSP belongs to the document. Leaving payouts must restore the stricter policy. -->
<div
  class="flex min-h-dvh flex-col"
  data-sveltekit-reload={page.route.id === '/app/organizations/[orgId]/payouts'}
>
  <header class="navbar bg-base-200 flex-wrap gap-3 px-4 print:hidden">
    <details class="dropdown lg:hidden">
      <summary class="btn">{navigationLabel}</summary>
      <nav class="dropdown-content bg-base-200 w-64 p-4" aria-label={navigationLabel}>
        <p class="mb-4">{t('session.signed_in_as', { name: displayName })}</p>
        {@render menu()}
      </nav>
    </details>
    <a class="btn btn-ghost" href={home}>{title}</a>
    <nav class="ml-auto" aria-label={accountLabel}>
      <ul class="menu menu-horizontal flex-wrap">
        <li><a href={languageHref('ja')} lang="ja" hreflang="ja">{t('nav.japanese')}</a></li>
        <li><a href={languageHref('en')} lang="en" hreflang="en">{t('nav.english')}</a></li>
        <li>
          <form method="POST" action={resolve('/auth/logout')}>
            <button type="submit" class="btn btn-ghost">{t('session.logout')}</button>
          </form>
        </li>
      </ul>
    </nav>
  </header>
  <div class="flex flex-1">
    <nav
      class="bg-base-200 hidden w-64 shrink-0 p-4 lg:block print:hidden"
      aria-label={navigationLabel}
    >
      <p class="mb-4">{t('session.signed_in_as', { name: displayName })}</p>
      {@render menu()}
    </nav>
    <main id="main-content" tabindex="-1" class="mx-auto w-full max-w-7xl min-w-0 p-4 lg:p-8">
      {@render children()}
    </main>
  </div>
</div>
