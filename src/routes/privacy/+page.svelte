<script lang="ts">
  import DetailPage from '$lib/components/page/detail-page.svelte';
  import { translator } from '$lib/i18n';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const items = $derived([
    t('legal.privacy.item1'),
    t('legal.privacy.item2'),
    t('legal.privacy.item3'),
    t('legal.privacy.item4')
  ]);
</script>

<svelte:head><title>{t('legal.privacy.title')} · {t('brand.name')}</title></svelte:head>

<DetailPage>
  {#snippet title()}{t('legal.privacy.title')}{/snippet}
  {#snippet body()}
    <article class="mx-auto max-w-3xl px-5 py-16">
      {#if data.locale === 'en'}<div class="alert alert-info mt-6">
          {t('legal.ja_only_note')}
        </div>{/if}
      <div lang="ja" class="mt-10 space-y-6">
        <p>{t('legal.privacy.intro')}</p>
        <ul class="space-y-3 ps-6">
          {#each items as item (item)}<li>{item}</li>{/each}
        </ul>
        <p>{t('legal.privacy.body')}</p>
        <p>{t('legal.privacy.contact')}</p>
      </div>
    </article>
  {/snippet}
</DetailPage>
