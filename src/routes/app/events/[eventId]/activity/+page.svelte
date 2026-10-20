<script lang="ts">
  import { translator } from '$lib/i18n';
  import ActivityList from '$lib/components/activity-list.svelte';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head
  ><title>{t('activity.event_title')} · {data.event.title} · {t('brand.name')}</title></svelte:head
>

<Card class="shadow-none">
  <CardHeader>
    <CardTitle>{t('activity.event_title')}</CardTitle>
    <p class="text-muted-foreground mt-2 text-sm">{t('activity.event_intro')}</p>
  </CardHeader>
  <CardContent>
    <ActivityList locale={data.locale} rows={data.rows} />
  </CardContent>
</Card>
