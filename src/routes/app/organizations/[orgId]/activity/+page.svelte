<script lang="ts">
  import { translator } from '$lib/i18n';
  import ActivityList from '$lib/components/activity-list.svelte';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head
  ><title>{t('activity.organization_title')} · {data.organization.name} · {t('brand.name')}</title
  ></svelte:head
>

<Card class="shadow-none">
  <CardHeader>
    <CardTitle>{t('activity.organization_title')}</CardTitle>
    <p class="text-muted-foreground mt-2 text-sm">{t('activity.organization_intro')}</p>
  </CardHeader>
  <CardContent>
    <ActivityList locale={data.locale} rows={data.rows} showEvent />
  </CardContent>
</Card>
