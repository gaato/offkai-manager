<script lang="ts">
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const detailHref = $derived(
    resolve('/app/registrations/[registrationId]', { registrationId: data.registration.id })
  );
  const cancelAction = $derived(`${detailHref}?/cancel`);
</script>

<svelte:head
  ><title>{t('admin_registration.cancel_title')} · {data.event.title} · {t('brand.name')}</title
  ></svelte:head
>

<Card class="border-destructive/40 mx-auto max-w-2xl shadow-none">
  <CardHeader>
    <CardTitle>{t('admin_registration.cancel_title')}</CardTitle>
    <p class="font-semibold">{data.registration.displayNameSnapshot}</p>
    <p class="text-muted-foreground mt-2">{t('admin_registration.cancel_question')}</p>
  </CardHeader>
  <CardContent>
    <form method="POST" action={cancelAction} class="flex flex-wrap gap-3">
      <Button type="submit" variant="destructive">{t('admin_registration.cancel_submit')}</Button>
      <a
        class="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
        href={detailHref}>{t('form.cancel')}</a
      >
    </form>
  </CardContent>
</Card>
