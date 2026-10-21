<script lang="ts">
  import '../app.css';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { translator } from '$lib/i18n';

  let { data, children } = $props();
  const t = $derived(translator(data.locale));
  const inWorkspace = $derived(
    page.url.pathname.startsWith('/app') || page.url.pathname.startsWith('/ops')
  );

  $effect(() => {
    document.documentElement.lang = data.locale;
  });

  function languageHref(language: 'en' | 'ja'): string {
    const url = new URL(page.url);
    url.searchParams.set('lang', language);
    return `${url.pathname}${url.search}`;
  }
</script>

<svelte:head>
  <meta name="description" content={t('meta.description')} />
</svelte:head>

<a
  href="#main-content"
  class="link bg-base-100 sr-only z-50 px-4 py-3 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
  >{t('nav.skip')}</a
>

{#if !inWorkspace}
  <header class="navbar bg-base-200">
    <div class="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-5 py-2">
      <a href={resolve('/')} class="link">{t('brand.name')}</a>
      <nav aria-label={t('nav.primary')}>
        <ul role="list" class="flex items-center gap-1">
          <li>
            <a href={resolve('/')} class="btn btn-ghost inline-flex min-h-12 items-center px-3"
              >{t('nav.home')}</a
            >
          </li>
          <li>
            <a
              href={languageHref('ja')}
              hreflang="ja"
              lang="ja"
              class="btn btn-ghost inline-flex min-h-12 items-center px-3">{t('nav.japanese')}</a
            >
          </li>
          <li>
            <a
              href={languageHref('en')}
              hreflang="en"
              lang="en"
              class="btn btn-ghost inline-flex min-h-12 items-center px-3">{t('nav.english')}</a
            >
          </li>
          {#if !data.session}
            <li>
              <a
                href={data.loginPath}
                class="btn btn-primary inline-flex min-h-12 items-center px-4"
                >{t('session.login')}</a
              >
            </li>
          {/if}
        </ul>
      </nav>
    </div>
  </header>

  {#if data.session}
    <aside aria-label={t('session.signed_in_as', { name: data.session.displayName })}>
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-2">
        <span>{t('session.signed_in_as', { name: data.session.displayName })}</span>
        <form method="POST" action={resolve('/auth/logout')}>
          <button type="submit" class="btn btn-ghost min-h-12 px-3">
            {t('session.logout')}
          </button>
        </form>
      </div>
    </aside>
  {/if}
{/if}

{#if inWorkspace}
  {@render children()}
{:else}
  <main id="main-content" tabindex="-1">
    {@render children()}
  </main>
{/if}

{#if !inWorkspace}
  <footer class="footer bg-base-200 mt-20">
    <div class="mx-auto grid max-w-6xl gap-5 px-5 py-10">
      <p>{t('footer.legal_note')}</p>
      <nav aria-label={t('footer.source_navigation')}>
        <ul role="list" class="flex flex-wrap gap-x-6 gap-y-2">
          <li>
            <a href={resolve('/terms')} class="link">{t('footer.terms')}</a>
          </li>
          <li>
            <a href={resolve('/privacy')} class="link">{t('footer.privacy')}</a>
          </li>
          {#if data.sourceUrl}
            <li>
              <a href={data.sourceUrl} class="link">{t('footer.source')}</a>
            </li>
          {/if}
        </ul>
      </nav>
    </div>
  </footer>
{/if}
