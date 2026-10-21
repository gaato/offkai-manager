<script lang="ts">
  import DetailPage from '$lib/components/page/detail-page.svelte';
  import { translator } from '$lib/i18n';

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

<DetailPage>
  {#snippet title()}{t('legal.terms.title')}{/snippet}
  {#snippet body()}
    <article class="mx-auto max-w-3xl px-5 py-16">
      {#if data.locale === 'en'}<div class="alert alert-info mt-6">
          {t('legal.ja_only_note')}
        </div>{/if}
      <div class="mt-10 space-y-6">
        <p lang="ja">{t('legal.terms.intro', { brand: t('brand.name') })}</p>
        <ol lang="ja" class="space-y-4 ps-6">
          {#each items as item (item)}<li>{item}</li>{/each}
        </ol>
      </div>
    </article>
  {/snippet}
</DetailPage>
