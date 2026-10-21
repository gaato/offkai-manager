<script lang="ts">
  import DetailPage from '$lib/components/page/detail-page.svelte';
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

<DetailPage>
  {#snippet title()}{notFound ? t('error.not_found.title') : t('error.internal.title')}{/snippet}
  {#snippet body()}
    <section class="mx-auto max-w-2xl px-5 py-24">
      <p>{page.status}</p>

      <p class="mt-5">
        {notFound ? t('error.not_found.body') : t('error.internal.body')}
      </p>
      {#if page.error?.requestId}
        <p class="mt-4">
          {t('error.request_id', { id: page.error.requestId })}
        </p>
      {/if}
      <a href={resolve('/')} class="btn btn-primary mt-8 inline-flex min-h-12 items-center px-5">
        {t('error.back_home')}
      </a>
    </section>
  {/snippet}
</DetailPage>
