<script lang="ts">
  import FormPage from '$lib/components/page/form-page.svelte';
  import { translator } from '$lib/i18n';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('dev_stripe.title')} · {t('brand.name')}</title></svelte:head>

<FormPage titleId="dev-stripe-title">
  {#snippet title()}{t('dev_stripe.title')}{/snippet}
  {#snippet body()}
    <section aria-labelledby="dev-stripe-title" class="mx-auto max-w-xl px-5 py-16">
      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <p>{t('dev_stripe.eyebrow')}</p>
        </div>
        <div class="card-body">
          <p>{t('dev_stripe.intro')}</p>
          <p class="mt-5">
            {t('dev_stripe.account')}
            <code class="ml-1 px-2 py-1">{data.accountId}</code>
          </p>
          <div class="mt-7 flex flex-wrap gap-3">
            <form method="POST" action="?/complete">
              <button type="submit" class="btn btn-primary">{t('dev_stripe.complete')}</button>
            </form>
            <form method="POST" action="?/incomplete">
              <button type="submit" class="btn btn-outline">{t('dev_stripe.incomplete')}</button>
            </form>
          </div>
        </div>
      </div>
    </section>
  {/snippet}
</FormPage>
