<script lang="ts">
  import { translator } from '$lib/i18n';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('dev_stripe.checkout_title')} · {t('brand.name')}</title></svelte:head>

<section class="mx-auto max-w-xl px-5 py-16" aria-labelledby="dev-checkout-title">
  <Card>
    <CardHeader>
      <p class="text-muted-foreground text-sm font-semibold">{t('dev_stripe.eyebrow')}</p>
      <CardTitle id="dev-checkout-title">{t('dev_stripe.checkout_title')}</CardTitle>
    </CardHeader>
    <CardContent>
      <p class="text-muted-foreground text-sm">{t('dev_stripe.checkout_intro')}</p>
      <dl class="mt-6 grid gap-4 rounded-lg border p-4">
        <div>
          <dt class="text-muted-foreground text-sm font-semibold">
            {t('dev_stripe.checkout_item')}
          </dt>
          <dd class="mt-1 font-semibold">{data.productName}</dd>
        </div>
        <div>
          <dt class="text-muted-foreground text-sm font-semibold">
            {t('dev_stripe.checkout_amount')}
          </dt>
          <dd class="mt-1 text-2xl font-bold tabular-nums">{data.amount}</dd>
        </div>
      </dl>
      <div class="mt-7 flex flex-wrap gap-3">
        <form method="POST" action="?/pay">
          <Button type="submit">{t('dev_stripe.checkout_pay')}</Button>
        </form>
        <form method="POST" action="?/cancel">
          <Button type="submit" variant="outline">{t('dev_stripe.checkout_cancel')}</Button>
        </form>
      </div>
    </CardContent>
  </Card>
</section>
