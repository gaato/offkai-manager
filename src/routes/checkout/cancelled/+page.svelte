<script lang="ts">
  import DetailPage from '$lib/components/page/detail-page.svelte';
  import { translator } from '$lib/i18n';
  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('checkout.cancelled')} · {t('brand.name')}</title></svelte:head>
<DetailPage>
  {#snippet title()}{t('checkout.cancelled')}{/snippet}
  {#snippet body()}<a class="btn btn-primary" href={data.discordUrl}>{t('checkout.discord')}</a
    >{/snippet}
</DetailPage>
