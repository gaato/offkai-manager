<script lang="ts">
  import DetailPage from '$lib/components/page/detail-page.svelte';
  import { translator } from '$lib/i18n';
  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('checkout.done')} · {t('brand.name')}</title></svelte:head>
<DetailPage>
  {#snippet title()}{t('checkout.done')}{/snippet}
  {#snippet body()}<p>{t('checkout.done_help')}</p>
    <a class="btn btn-primary" href={data.discordUrl}>{t('checkout.discord')}</a>{/snippet}
</DetailPage>
