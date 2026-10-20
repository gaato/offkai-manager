<script lang="ts">
  import { translator } from '$lib/i18n';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('dev_stripe.title')} · {t('brand.name')}</title></svelte:head>

<section class="mx-auto max-w-xl px-5 py-16" aria-labelledby="dev-stripe-title">
  <Card>
    <CardHeader>
      <p class="text-muted-foreground text-sm font-semibold">{t('dev_stripe.eyebrow')}</p>
      <CardTitle id="dev-stripe-title">{t('dev_stripe.title')}</CardTitle>
    </CardHeader>
    <CardContent>
      <p class="text-muted-foreground text-sm">{t('dev_stripe.intro')}</p>
      <p class="mt-5 text-sm">
        {t('dev_stripe.account')}
        <code class="bg-muted ml-1 rounded px-2 py-1 font-mono">{data.accountId}</code>
      </p>
      <div class="mt-7 flex flex-wrap gap-3">
        <form method="POST" action="?/complete">
          <Button type="submit">{t('dev_stripe.complete')}</Button>
        </form>
        <form method="POST" action="?/incomplete">
          <Button type="submit" variant="outline">{t('dev_stripe.incomplete')}</Button>
        </form>
      </div>
    </CardContent>
  </Card>
</section>
