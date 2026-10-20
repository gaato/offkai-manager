<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { translator, type Locale } from '$lib/i18n';
  const locale = $derived((page.data.locale ?? 'en') as Locale);
  const t = $derived(translator(locale));
  const notFound = $derived(page.status === 404);
</script>

<svelte:head>
  <title
    >{notFound ? t('error.not_found.title') : t('error.internal.title')} · {t('brand.name')}</title
  >
</svelte:head>
<section class="mx-auto max-w-2xl px-5 py-24 text-center">
  <p class="text-primary text-sm font-bold tracking-widest">{page.status}</p>
  <h1 class="mt-3 text-4xl font-bold tracking-tight">
    {notFound ? t('error.not_found.title') : t('error.internal.title')}
  </h1>
  <p class="text-muted-foreground mt-5 text-lg">
    {notFound ? t('error.not_found.body') : t('error.internal.body')}
  </p>
  {#if page.error?.requestId}
    <p class="text-muted-foreground mt-4 text-sm">
      {t('error.request_id', { id: page.error.requestId })}
    </p>
  {/if}
  <a
    class="bg-primary text-primary-foreground mt-8 inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
    href={resolve('/')}
  >
    {t('error.back_home')}
  </a>
</section>
