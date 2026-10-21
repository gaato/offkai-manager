<script lang="ts">
  import ListPage from '$lib/components/page/list-page.svelte';
  import { translator } from '$lib/i18n';
  import ActivityList from '$lib/components/activity-list.svelte';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head
  ><title>{t('activity.event_title')} · {data.event.title} · {t('brand.name')}</title></svelte:head
>

<ListPage>
  {#snippet title()}{t('activity.event_title')}{/snippet}
  {#snippet body()}
    <div class="card card-border bg-base-100">
      <div class="card-body gap-2 pb-0">
        <p class="mt-2">{t('activity.event_intro')}</p>
      </div>
      <div class="card-body">
        <ActivityList locale={data.locale} rows={data.rows} />
      </div>
    </div>
  {/snippet}
</ListPage>
