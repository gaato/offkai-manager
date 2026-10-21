<script lang="ts">
  import { translator, type Locale } from '$lib/i18n';
  import { paymentRequirements, paymentRequirementLabelKey } from '$lib/shared/payment';
  import { grossUp, feeBreakdown } from '$lib/shared/fees';
  import { formatMoney } from '$lib/shared/money';
  import type { EventPaymentForm } from '$lib/shared/event-payment-form';
  let {
    values = $bindable(),
    locale,
    stripeBps,
    platformBps,
    units,
    holdMin,
    holdMax,
    ready,
    payoutsHref,
    errors = {}
  }: {
    values: EventPaymentForm;
    locale: Locale;
    stripeBps: number;
    platformBps: number;
    units: number[];
    holdMin: number;
    holdMax: number;
    ready: boolean;
    payoutsHref: string;
    errors?: Partial<Record<keyof EventPaymentForm, string[]>>;
  } = $props();
  const t = $derived(translator(locale));
  const preview = $derived.by(() => {
    try {
      if (!/^\d{1,8}$/.test(values.amountToCollect) || !/^\d{0,8}$/.test(values.priceOverride))
        return null;
      const price = values.priceOverride
        ? BigInt(values.priceOverride)
        : grossUp(BigInt(values.amountToCollect), stripeBps, platformBps, values.roundingUnit);
      return feeBreakdown(price, stripeBps, platformBps);
    } catch {
      return null;
    }
  });
</script>

<fieldset class="fieldset grid gap-4">
  <legend class="fieldset-legend">{t('payment.requirement')}</legend>
  {#each Object.entries(errors) as [field, messages] (field)}{#if messages?.length}<p
        role="alert"
        class="text-error"
      >
        {messages[0]}
      </p>{/if}{/each}
  {#if !ready}<p>
      {t('payment.finish_payouts')}
      <a class="link" href={payoutsHref}>{t('payment.manage_payouts')}</a>
    </p>{/if}
  {#each paymentRequirements as requirement (requirement)}
    <label class="label min-h-12 gap-3"
      ><input
        class="radio"
        type="radio"
        name="paymentRequirement"
        value={requirement}
        bind:group={values.paymentRequirement}
        disabled={!ready && requirement !== 'none' && values.paymentRequirement !== requirement}
      />{t(paymentRequirementLabelKey(requirement))}</label
    >
  {/each}
  <label class="label" for="amountToCollect">{t('payment.amount_to_collect')}</label>
  <input
    class="input w-full"
    id="amountToCollect"
    name="amountToCollect"
    inputmode="numeric"
    pattern={'[0-9]{1,8}'}
    bind:value={values.amountToCollect}
    required
  />
  <fieldset class="fieldset">
    <legend class="fieldset-legend">{t('payment.rounding')}</legend>
    {#each units as unit (unit)}<label class="label min-h-12 gap-3"
        ><input
          class="radio"
          type="radio"
          name="roundingUnit"
          value={unit}
          bind:group={values.roundingUnit}
        />{unit}</label
      >{/each}
  </fieldset>
  <label class="label" for="priceOverride">{t('payment.override')}</label>
  <input
    class="input w-full"
    id="priceOverride"
    name="priceOverride"
    inputmode="numeric"
    pattern={'[0-9]{0,8}'}
    bind:value={values.priceOverride}
  />
  {#if preview}
    <dl class="grid grid-cols-2 gap-3" aria-live="polite" data-testid="fee-breakdown">
      <dt>{t('payment.price')}</dt>
      <dd data-testid="participant-price">{formatMoney(preview.price, 'JPY', locale)}</dd>
      <dt>{t('payment.stripe_fee')}</dt>
      <dd>{formatMoney(preview.stripeFee, 'JPY', locale)}</dd>
      <dt>{t('payment.platform_fee')}</dt>
      <dd>{formatMoney(preview.platformFee, 'JPY', locale)}</dd>
      <dt>{t('payment.take_home')}</dt>
      <dd>{formatMoney(preview.takeHome, 'JPY', locale)}</dd>
    </dl>
  {/if}
  <p>{t('payment.same_price')}</p>
  <fieldset class="fieldset">
    <legend class="fieldset-legend">{t('payment.manual_methods')}</legend>
    <label class="label min-h-12 gap-3"
      ><input
        class="checkbox"
        type="checkbox"
        name="manualCash"
        bind:checked={values.manualCash}
      />{t('payment.cash')}</label
    >
    <label class="label min-h-12 gap-3"
      ><input
        class="checkbox"
        type="checkbox"
        name="manualPayPay"
        bind:checked={values.manualPayPay}
      />{t('payment.paypay')}</label
    >
  </fieldset>
  <label class="label" for="holdMinutes">{t('payment.hold_minutes')}</label>
  <input
    class="input w-full"
    id="holdMinutes"
    name="holdMinutes"
    type="number"
    min={holdMin}
    max={holdMax}
    step="1"
    bind:value={values.holdMinutes}
    aria-describedby="hold-help"
    required
  />
  <p id="hold-help">{t('payment.hold_help')}</p>
</fieldset>
