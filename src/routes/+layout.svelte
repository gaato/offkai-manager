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
  class="bg-background sr-only z-50 rounded-md px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
  href="#main-content">{t('nav.skip')}</a
>

{#if !inWorkspace}
  <header class="bg-background/95 border-b">
    <div class="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-5 py-2">
      <a class="text-lg font-bold tracking-tight" href={resolve('/')}>{t('brand.name')}</a>
      <nav aria-label={t('nav.primary')}>
        <ul class="flex list-none items-center gap-1" role="list">
          <li>
            <a
              class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-3 font-medium"
              href={resolve('/')}>{t('nav.home')}</a
            >
          </li>
          <li>
            <a
              class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-3 font-medium"
              href={languageHref('ja')}
              hreflang="ja"
              lang="ja">{t('nav.japanese')}</a
            >
          </li>
          <li>
            <a
              class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-3 font-medium"
              href={languageHref('en')}
              hreflang="en"
              lang="en">{t('nav.english')}</a
            >
          </li>
          {#if !data.session}
            <li>
              <a
                class="bg-primary text-primary-foreground inline-flex min-h-12 items-center rounded-md px-4 font-semibold"
                href={data.loginPath}>{t('session.login')}</a
              >
            </li>
          {/if}
        </ul>
      </nav>
    </div>
  </header>

  {#if data.session}
    <aside
      class="bg-muted border-b"
      aria-label={t('session.signed_in_as', { name: data.session.displayName })}
    >
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-2 text-sm">
        <span>{t('session.signed_in_as', { name: data.session.displayName })}</span>
        <form method="POST" action={resolve('/auth/logout')}>
          <button class="hover:bg-accent min-h-12 rounded-md px-3 font-semibold" type="submit">
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
  <footer class="bg-muted/50 mt-20 border-t">
    <div class="text-muted-foreground mx-auto grid max-w-6xl gap-5 px-5 py-10 text-sm">
      <p>{t('footer.legal_note')}</p>
      <nav aria-label={t('footer.source_navigation')}>
        <ul class="flex list-none flex-wrap gap-x-6 gap-y-2" role="list">
          <li>
            <a class="font-medium underline-offset-4 hover:underline" href={resolve('/terms')}
              >{t('footer.terms')}</a
            >
          </li>
          <li>
            <a class="font-medium underline-offset-4 hover:underline" href={resolve('/privacy')}
              >{t('footer.privacy')}</a
            >
          </li>
          {#if data.sourceUrl}
            <li>
              <a class="font-medium underline-offset-4 hover:underline" href={data.sourceUrl}
                >{t('footer.source')}</a
              >
            </li>
          {/if}
        </ul>
      </nav>
    </div>
  </footer>
{/if}
