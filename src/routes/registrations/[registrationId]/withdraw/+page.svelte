<script lang="ts">
  import { translator } from '$lib/i18n';
  import { Alert } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head>
  <title>{t('withdraw.title')} · {data.eventTitle} · {t('brand.name')}</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
  <header>
    <p class="text-primary text-sm font-semibold">{data.eventTitle}</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">{t('withdraw.title')}</h1>
  </header>
  <Alert class="border-destructive text-destructive mt-8" role="alert">
    {t('withdraw.confirm_question')}
  </Alert>
  <div class="mt-8 flex flex-wrap gap-3">
    <form method="POST" action="?/withdraw">
      <Button type="submit" variant="destructive" size="lg">{t('withdraw.confirm')}</Button>
    </form>
    <a
      class="border-input bg-background hover:bg-accent inline-flex min-h-13 items-center rounded-lg border px-7 py-2 text-sm font-semibold"
      href={data.statusHref}>{t('withdraw.keep')}</a
    >
  </div>
</div>
