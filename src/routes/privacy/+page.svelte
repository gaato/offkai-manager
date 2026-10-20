<script lang="ts">
  import { translator } from '$lib/i18n';
  import { Alert } from '$lib/components/ui/alert';
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
<article class="mx-auto max-w-3xl px-5 py-16">
  <h1 class="text-4xl font-bold tracking-tight">{t('legal.privacy.title')}</h1>
  {#if data.locale === 'en'}<Alert class="bg-muted mt-6">{t('legal.ja_only_note')}</Alert>{/if}
  <div class="mt-10 space-y-6 leading-8" lang="ja">
    <p>{t('legal.privacy.intro')}</p>
    <ul class="list-disc space-y-3 ps-6">
      {#each items as item (item)}<li>{item}</li>{/each}
    </ul>
    <p>{t('legal.privacy.body')}</p>
    <p>{t('legal.privacy.contact')}</p>
  </div>
</article>
