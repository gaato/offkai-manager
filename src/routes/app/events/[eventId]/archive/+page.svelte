<script lang="ts">
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { Alert } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  type ActionResult = { actionError?: string } | null;
  let { data, form: rawActionResult } = $props();
  const t = $derived(translator(data.locale));
  const actionResult = $derived(rawActionResult as ActionResult);
  const backHref = $derived(resolve('/app/events/[eventId]', { eventId: data.event.id }));
</script>

<svelte:head
  ><title>{t('event.archive_confirm_title')} · {data.event.title} · {t('brand.name')}</title
  ></svelte:head
>

<Card class="mx-auto max-w-2xl shadow-none">
  <CardHeader>
    <CardTitle>{t('event.archive_confirm_title')}</CardTitle>
    <p class="font-semibold">{data.event.title}</p>
    <p class="text-muted-foreground mt-2">{t('event.archive_confirm_question')}</p>
  </CardHeader>
  <CardContent>
    {#if actionResult?.actionError}
      <Alert class="border-destructive text-destructive mb-6" role="alert"
        >{actionResult.actionError}</Alert
      >
    {/if}
    <form method="POST" action="?/archive" class="flex flex-wrap gap-3">
      <Button type="submit" variant="destructive">{t('event.archive_confirm_submit')}</Button>
      <a
        class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
        href={backHref}>{t('event.back_overview')}</a
      >
    </form>
  </CardContent>
</Card>
