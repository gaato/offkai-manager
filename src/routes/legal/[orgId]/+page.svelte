<script lang="ts">
  import DetailPage from '$lib/components/page/detail-page.svelte';
  import { translator } from '$lib/i18n';
  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('legal.organizer.title')} · {data.organization.name}</title></svelte:head>
<DetailPage>
  {#snippet title()}{t('legal.organizer.title')}{/snippet}
  {#snippet body()}
    <h2 class="card-title">{data.organization.name}</h2>
    <p>{t('legal.organizer.intro')}</p>
  {/snippet}
</DetailPage>
