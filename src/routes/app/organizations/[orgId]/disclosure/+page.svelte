<script lang="ts">
  import { untrack } from 'svelte';
  import FormPage from '$lib/components/page/form-page.svelte';
  import { translator } from '$lib/i18n';
  import { superForm } from 'sveltekit-superforms';
  let { data } = $props();
  const t = $derived(translator(data.locale));
  const { form, errors, message, enhance } = superForm(
    untrack(() => data.form),
    { resetForm: false }
  );
</script>

<svelte:head><title>{t('legal.title')} · {t('brand.name')}</title></svelte:head>
<FormPage>
  {#snippet title()}{t('legal.title')}{/snippet}
  {#snippet body()}
    <p>{t('legal.provided')}</p>
    <a class="link" href={`/legal/${data.organization.id}`}>{t('legal.title')}</a>
    <form method="POST" action="?/save" use:enhance class="grid gap-5">
      {#if $message}<p role="status" class="alert">{$message}</p>{/if}
      {#each ['sellerName', 'email', 'phone'] as const as key (key)}
        <div class="fieldset">
          <label for={key} class="label">{t(`legal.${key}`)}</label>
          <input
            id={key}
            name={key}
            class="input w-full text-base"
            type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
            autocomplete={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'organization'}
            bind:value={$form[key]}
            required={key !== 'phone'}
            aria-invalid={$errors[key] ? true : undefined}
            aria-describedby={`${key}-error`}
          />
          <span id={`${key}-error`} class="text-error">{$errors[key]?.join(' ') ?? ''}</span>
        </div>
      {/each}
      <div class="fieldset">
        <label for="address" class="label">{t('legal.address')}</label>
        <textarea
          id="address"
          name="address"
          autocomplete="street-address"
          class="textarea w-full text-base"
          bind:value={$form.address}
          aria-describedby="address-error"
        ></textarea>
        <span id="address-error" class="text-error">{$errors.address?.join(' ') ?? ''}</span>
      </div>
      <label class="label whitespace-normal"
        ><input
          type="checkbox"
          name="discloseOnRequest"
          class="checkbox"
          bind:checked={$form.discloseOnRequest}
        />{t('legal.discloseOnRequest')}</label
      >
      <fieldset class="fieldset">
        <legend class="fieldset-legend">{t('legal.additionalFees')}</legend>
        {#each ['none', 'included'] as const as fee (fee)}<label class="label"
            ><input
              class="radio"
              type="radio"
              name="additionalFees"
              value={fee}
              bind:group={$form.additionalFees}
            />{t(fee === 'none' ? 'legal.fees_none' : 'legal.fees_included')}</label
          >{/each}
      </fieldset>
      <div class="fieldset">
        <label class="label" for="refundPolicy">{t('legal.refundPolicy')}</label><textarea
          id="refundPolicy"
          name="refundPolicy"
          class="textarea w-full text-base"
          required
          bind:value={$form.refundPolicy}
          aria-describedby="refund-error"
        ></textarea><span id="refund-error" class="text-error"
          >{$errors.refundPolicy?.join(' ') ?? ''}</span
        >
      </div>
      <p>{t('legal.price_text')}</p>
      <p>{t('legal.payment_text')}</p>
      <p>{t('legal.delivery_text')}</p>
      <button class="btn btn-primary min-h-12" type="submit">{t('legal.save')}</button>
    </form>
  {/snippet}
</FormPage>
