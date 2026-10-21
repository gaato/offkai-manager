<script lang="ts">
  import FormPage from '$lib/components/page/form-page.svelte';
  import { translator } from '$lib/i18n';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('dev_stripe.checkout_title')} · {t('brand.name')}</title></svelte:head>

<FormPage titleId="dev-checkout-title">
  {#snippet title()}{t('dev_stripe.checkout_title')}{/snippet}
  {#snippet body()}
    <section aria-labelledby="dev-checkout-title" class="mx-auto max-w-xl px-5 py-16">
      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <p>{t('dev_stripe.eyebrow')}</p>
        </div>
        <div class="card-body">
          <p>{t('dev_stripe.checkout_intro')}</p>
          <dl class="mt-6 grid gap-4 p-4">
            <div>
              <dt>
                {t('dev_stripe.checkout_item')}
              </dt>
              <dd class="mt-1">{data.productName}</dd>
            </div>
            <div>
              <dt>
                {t('dev_stripe.checkout_amount')}
              </dt>
              <dd class="mt-1">{data.amount}</dd>
            </div>
          </dl>
          <div class="mt-7 flex flex-wrap gap-3">
            <form method="POST" action="?/pay">
              <button type="submit" class="btn btn-primary">{t('dev_stripe.checkout_pay')}</button>
            </form>
            <form method="POST" action="?/cancel">
              <button type="submit" class="btn btn-outline"
                >{t('dev_stripe.checkout_cancel')}</button
              >
            </form>
          </div>
        </div>
      </div>
    </section>
  {/snippet}
</FormPage>
