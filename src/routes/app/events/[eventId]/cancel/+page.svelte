<script lang="ts">
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { Alert } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Label } from '$lib/components/ui/label';

  type ActionResult = { actionError?: string; reason?: string } | null;
  let { data, form: rawActionResult } = $props();
  const t = $derived(translator(data.locale));
  const actionResult = $derived(rawActionResult as ActionResult);
  const backHref = $derived(resolve('/app/events/[eventId]', { eventId: data.event.id }));
</script>

<svelte:head
  ><title>{t('event.cancel_confirm_title')} · {data.event.title} · {t('brand.name')}</title
  ></svelte:head
>

<Card class="border-destructive/40 mx-auto max-w-2xl shadow-none">
  <CardHeader>
    <CardTitle>{t('event.cancel_confirm_title')}</CardTitle>
    <p class="font-semibold">{data.event.title}</p>
    <p class="text-muted-foreground mt-2">{t('event.cancel_confirm_question')}</p>
  </CardHeader>
  <CardContent>
    {#if actionResult?.actionError}
      <Alert class="border-destructive text-destructive mb-6" role="alert"
        >{actionResult.actionError}</Alert
      >
    {/if}
    <form method="POST" action="?/cancel" class="grid gap-5">
      <div class="grid gap-2">
        <Label for="reason">{t('event.cancel_reason')}</Label>
        <textarea
          id="reason"
          name="reason"
          required
          maxlength={2000}
          rows={4}
          class="border-input bg-background min-h-24 w-full resize-y rounded-md border px-3 py-2 text-base"
          >{actionResult?.reason ?? ''}</textarea
        >
        <p class="text-muted-foreground text-sm">{t('event.cancel_reason_help')}</p>
      </div>
      <div class="flex flex-wrap gap-3">
        <Button type="submit" variant="destructive">{t('event.cancel_confirm_submit')}</Button>
        <a
          class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
          href={backHref}>{t('event.back_overview')}</a
        >
      </div>
    </form>
  </CardContent>
</Card>
