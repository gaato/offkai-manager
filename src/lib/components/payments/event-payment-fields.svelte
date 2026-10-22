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
    frozen = false,
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
    /** Payment obligations exist, so the server rejects changes to these fields. */
    frozen?: boolean;
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
      <a class="link" data-sveltekit-reload href={payoutsHref}>{t('payment.manage_payouts')}</a>
    </p>{/if}
  {#if frozen}
    <p id="payment-frozen-note" class="alert alert-info">{t('payment.frozen_note')}</p>
    <!-- Disabled controls are not submitted, so the unchanged values travel as hidden fields. -->
    {#each ['paymentRequirement', 'amountToCollect', 'roundingUnit', 'priceOverride', 'pricePending', 'holdMinutes'] as const as field (field)}
      <input type="hidden" name={field} value={values[field]} />
    {/each}
  {/if}
  <fieldset
    disabled={frozen}
    aria-describedby={frozen ? 'payment-frozen-note' : undefined}
    class="fieldset grid gap-4"
  >
    {#each paymentRequirements as requirement (requirement)}
      <label for={`paymentRequirement-${requirement}`} class="label min-h-12 gap-3"
        ><input
          id={`paymentRequirement-${requirement}`}
          aria-labelledby={`paymentRequirement-label-${requirement}`}
          class="radio"
          type="radio"
          name="paymentRequirement"
          value={requirement}
          bind:group={values.paymentRequirement}
          disabled={!ready && requirement !== 'none' && values.paymentRequirement !== requirement}
        /><span id={`paymentRequirement-label-${requirement}`}
          >{t(paymentRequirementLabelKey(requirement))}</span
        ></label
      >
    {/each}
    <label class="label min-h-12 gap-3" for="pricePending"
      ><input
        id="pricePending"
        class="checkbox"
        type="checkbox"
        name="pricePending"
        bind:checked={values.pricePending}
      />{t('payment.price_pending_option')}</label
    >
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
      {#each units as unit (unit)}<label for={`roundingUnit-${unit}`} class="label min-h-12 gap-3"
          ><input
            class="radio"
            type="radio"
            id={`roundingUnit-${unit}`}
            aria-labelledby={`roundingUnit-label-${unit}`}
            name="roundingUnit"
            value={unit}
            bind:group={values.roundingUnit}
          /><span id={`roundingUnit-label-${unit}`}>{t('payment.rounding_unit', { unit })}</span
          ></label
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
  </fieldset>
  <fieldset id="payment-schedule" class="fieldset grid gap-4">
    <legend class="fieldset-legend">{t('payment.opens_at')}</legend>
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="grid gap-2">
        <label class="label" for="paymentOpensAt">{t('payment.opens_at')}</label>
        <input
          class="input w-full"
          id="paymentOpensAt"
          name="paymentOpensAt"
          type="datetime-local"
          bind:value={values.paymentOpensAt}
          aria-invalid={errors.paymentOpensAt ? 'true' : undefined}
        />
        {#if errors.paymentOpensAt}<p role="alert">{errors.paymentOpensAt[0]}</p>{/if}
      </div>
      <div class="grid gap-2">
        <label class="label" for="paymentDueAt">{t('payment.due_at')}</label>
        <input
          class="input w-full"
          id="paymentDueAt"
          name="paymentDueAt"
          type="datetime-local"
          bind:value={values.paymentDueAt}
          aria-invalid={errors.paymentDueAt ? 'true' : undefined}
        />
        {#if errors.paymentDueAt}<p role="alert">{errors.paymentDueAt[0]}</p>{/if}
      </div>
    </div>
    <div class="grid gap-2">
      <label class="label" for="additionalOpensAt">{t('payment.additional_opens_at')}</label>
      <input
        class="input w-full"
        id="additionalOpensAt"
        name="additionalOpensAt"
        type="datetime-local"
        bind:value={values.additionalOpensAt}
        aria-invalid={errors.additionalOpensAt ? 'true' : undefined}
      />
      {#if errors.additionalOpensAt}<p role="alert">{errors.additionalOpensAt[0]}</p>{/if}
    </div>
  </fieldset>
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
    disabled={frozen}
    bind:value={values.holdMinutes}
    aria-describedby="hold-help"
    required
  />
  <p id="hold-help">{t('payment.hold_help')}</p>
</fieldset>
