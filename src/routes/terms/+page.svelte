<script lang="ts">
  import { translator } from '$lib/i18n';
  import { Alert } from '$lib/components/ui/alert';
  let { data } = $props();
  const t = $derived(translator(data.locale));
  const items = $derived([
    t('legal.terms.item1'),
    t('legal.terms.item2'),
    t('legal.terms.item3'),
    t('legal.terms.item4'),
    t('legal.terms.item5')
  ]);
</script>

<svelte:head><title>{t('legal.terms.title')} · {t('brand.name')}</title></svelte:head>
<article class="mx-auto max-w-3xl px-5 py-16">
  <h1 class="text-4xl font-bold tracking-tight">{t('legal.terms.title')}</h1>
  {#if data.locale === 'en'}<Alert class="bg-muted mt-6">{t('legal.ja_only_note')}</Alert>{/if}
  <div class="mt-10 space-y-6 leading-8">
    <p lang="ja">{t('legal.terms.intro', { brand: t('brand.name') })}</p>
    <ol class="list-decimal space-y-4 ps-6" lang="ja">
      {#each items as item (item)}<li>{item}</li>{/each}
    </ol>
  </div>
</article>
