<script lang="ts">
  import DetailPage from '$lib/components/page/detail-page.svelte';
  import { translator } from '$lib/i18n';
  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head
  ><meta name="robots" content="noindex" /><title
    >{t('legal.title')} · {data.organization.name}</title
  ></svelte:head
>
<DetailPage>
  {#snippet title()}{t('legal.title')}{/snippet}
  {#snippet body()}
    <h2 class="card-title">{data.organization.name}</h2>
    <p>{t('legal.provided')}</p>
    {#if data.organization.disclosure}
      {@const d = data.organization.disclosure}
      <dl class="grid gap-4">
        <div>
          <dt class="font-bold">{t('legal.sellerName')}</dt>
          <dd>{d.sellerName}</dd>
        </div>
        {#if d.discloseOnRequest}<div>
            <dt class="font-bold">{t('legal.address')} / {t('legal.phone')}</dt>
            <dd>{t('legal.request')}</dd>
          </div>
        {:else}<div>
            <dt class="font-bold">{t('legal.address')}</dt>
            <dd class="whitespace-pre-wrap">{d.address}</dd>
          </div>
          <div>
            <dt class="font-bold">{t('legal.phone')}</dt>
            <dd>{d.phone}</dd>
          </div>{/if}
        <div>
          <dt class="font-bold">{t('legal.email')}</dt>
          <dd><a class="link" href={`mailto:${d.email}`}>{d.email}</a></dd>
        </div>
        <div>
          <dt class="font-bold">{t('legal.price')}</dt>
          <dd>{t('legal.price_text')}</dd>
        </div>
        <div>
          <dt class="font-bold">{t('legal.additionalFees')}</dt>
          <dd>{t(d.additionalFees === 'none' ? 'legal.fees_none' : 'legal.fees_included')}</dd>
        </div>
        <div>
          <dt class="font-bold">{t('legal.payment')}</dt>
          <dd>{t('legal.payment_text')}</dd>
        </div>
        <div>
          <dt class="font-bold">{t('legal.delivery')}</dt>
          <dd>{t('legal.delivery_text')}</dd>
        </div>
        <div>
          <dt class="font-bold">{t('legal.refundPolicy')}</dt>
          <dd class="whitespace-pre-wrap">
            {t('legal.policy_text')}
            {d.refundPolicy}
          </dd>
        </div>
      </dl>
    {:else}<p>{t('legal.incomplete')}</p>{/if}
  {/snippet}
</DetailPage>
