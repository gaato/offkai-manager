<script lang="ts">
  import EventPaymentFields from '$lib/components/payments/event-payment-fields.svelte';
  import SettingsPage from '$lib/components/page/settings-page.svelte';
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import {
    registrationModeLabelKey,
    registrationModes,
    venueRevealLabelKey,
    venueReveals
  } from '$lib/shared/event';
  let { data } = $props();
  const t = $derived(translator(data.locale));
  const settings = superForm(
    untrack(() => data.form),
    { resetForm: false }
  );
  const { form, errors, message, enhance } = settings;
  const editable = $derived(data.capabilities.canManageEvent && !data.event.archivedAt);
</script>

<svelte:head
  ><title>{t('event.settings_title')} · {data.event.title} · {t('brand.name')}</title></svelte:head
>
<SettingsPage>
  {#snippet title()}{t('event.settings_title')}{/snippet}
  {#snippet body()}
    <div class="grid gap-6">
      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <p class="mt-2">
            {t('event.settings_intro', { zone: data.timeZone })}
          </p>
        </div>
        <div class="card-body">
          {#if $message}
            <div
              role={$message === t('event.settings_success') ? 'status' : 'alert'}
              class={($message === t('event.settings_success') ? 'status' : 'alert') === 'status'
                ? 'alert alert-success'
                : 'alert alert-error'}
            >
              {$message}
            </div>
          {/if}
          <form method="POST" action="?/settings" use:enhance class="grid gap-6">
            <div class="grid gap-2">
              <label for="title" class="label">{t('event.title')}</label>
              <input
                id="title"
                name="title"
                bind:value={$form.title}
                required
                maxlength={200}
                disabled={!editable}
                class="input w-full"
              />
              {#if $errors.title}<p role="alert">
                  {$errors.title[0]}
                </p>{/if}
            </div>
            <div class="grid gap-2">
              <label for="description" class="label">{t('event.description')}</label>
              <textarea
                id="description"
                name="description"
                bind:value={$form.description}
                rows={5}
                maxlength={10000}
                disabled={!editable}
                class="textarea bg-base-100 min-h-28 w-full px-3 py-2"
              ></textarea>
            </div>
            <div class="grid gap-5 sm:grid-cols-2">
              <div class="grid gap-2">
                <label for="startsAt" class="label">{t('event.starts_at')}</label>
                <input
                  id="startsAt"
                  name="startsAt"
                  type="datetime-local"
                  bind:value={$form.startsAt}
                  required
                  disabled={!editable}
                  class="input w-full"
                />
                {#if $errors.startsAt}<p role="alert">
                    {$errors.startsAt[0]}
                  </p>{/if}
              </div>
              <div class="grid gap-2">
                <label for="endsAt" class="label">{t('event.ends_at')}</label>
                <input
                  id="endsAt"
                  name="endsAt"
                  type="datetime-local"
                  bind:value={$form.endsAt}
                  required
                  disabled={!editable}
                  class="input w-full"
                />
                {#if $errors.endsAt}<p role="alert">
                    {$errors.endsAt[0]}
                  </p>{/if}
              </div>
            </div>
            <div class="grid gap-2">
              <label for="capacity" class="label">{t('event.capacity')}</label>
              <input
                id="capacity"
                name="capacity"
                type="number"
                min={1}
                step={1}
                bind:value={$form.capacity}
                disabled={!editable}
                class="input w-full"
              />
              <p>{t('event.capacity_help')}</p>
              {#if $errors.capacity}<p role="alert">
                  {$errors.capacity[0]}
                </p>{/if}
            </div>
            <div class="grid gap-5 sm:grid-cols-2">
              <div class="grid gap-2">
                <label for="registrationOpensAt" class="label"
                  >{t('event.registration_opens_at')}</label
                >
                <input
                  id="registrationOpensAt"
                  name="registrationOpensAt"
                  type="datetime-local"
                  bind:value={$form.registrationOpensAt}
                  required
                  disabled={!editable}
                  class="input w-full"
                />
              </div>
              <div class="grid gap-2">
                <label for="registrationClosesAt" class="label"
                  >{t('event.registration_closes_at')}</label
                >
                <input
                  id="registrationClosesAt"
                  name="registrationClosesAt"
                  type="datetime-local"
                  bind:value={$form.registrationClosesAt}
                  required
                  disabled={!editable}
                  class="input w-full"
                />
              </div>
            </div>
            <div class="grid gap-5 sm:grid-cols-2">
              <div class="grid gap-2">
                <label for="venueName" class="label">{t('event.venue_name')}</label>
                <input
                  id="venueName"
                  name="venueName"
                  bind:value={$form.venueName}
                  maxlength={300}
                  disabled={!editable}
                  class="input w-full"
                />
              </div>
              <div class="grid gap-2">
                <label for="venueAddress" class="label">{t('event.venue_address')}</label>
                <input
                  id="venueAddress"
                  name="venueAddress"
                  bind:value={$form.venueAddress}
                  maxlength={500}
                  autocomplete="street-address"
                  disabled={!editable}
                  class="input w-full"
                />
              </div>
            </div>
            <div class="grid gap-2">
              <label for="venueReveal" class="label">{t('event.venue_reveal')}</label>
              <select
                id="venueReveal"
                name="venueReveal"
                bind:value={$form.venueReveal}
                disabled={!editable}
                class="select bg-base-100 min-h-12 w-full px-3"
              >
                {#each venueReveals as reveal (reveal)}
                  <option value={reveal}>{t(venueRevealLabelKey(reveal))}</option>
                {/each}
              </select>
            </div>
            <div class="grid gap-2">
              <label for="contact" class="label">{t('event.contact')}</label>
              <input
                id="contact"
                name="contact"
                bind:value={$form.contact}
                maxlength={500}
                disabled={!editable}
                class="input w-full"
              />
            </div>
            <EventPaymentFields
              bind:values={$form}
              errors={{
                paymentRequirement: $errors.paymentRequirement,
                amountToCollect: $errors.amountToCollect,
                priceOverride: $errors.priceOverride,
                pricePending: $errors.pricePending,
                paymentOpensAt: $errors.paymentOpensAt,
                paymentDueAt: $errors.paymentDueAt,
                additionalOpensAt: $errors.additionalOpensAt,
                roundingUnit: $errors.roundingUnit,
                holdMinutes: $errors.holdMinutes
              }}
              locale={data.locale}
              {...data.paymentUi}
              payoutsHref={`/app/organizations/${data.event.organizationId}/payouts`}
            />
            <div class="grid gap-2">
              <label for="cancellationPolicy" class="label">{t('event.cancellation_policy')}</label>
              <textarea
                id="cancellationPolicy"
                name="cancellationPolicy"
                bind:value={$form.cancellationPolicy}
                rows={4}
                maxlength={5000}
                disabled={!editable}
                class="textarea bg-base-100 min-h-24 w-full px-3 py-2"
              ></textarea>
            </div>
            <fieldset disabled={!editable} class="fieldset grid gap-3">
              <legend class="fieldset-legend">{t('event.registration_mode_label')}</legend>
              <p>{t('event.registration_mode_help')}</p>
              {#each registrationModes as mode (mode)}
                <label
                  for={`field-registrationMode-${mode}`}
                  class="label flex min-h-12 items-center gap-3 px-4"
                >
                  <input
                    id={`field-registrationMode-${mode}`}
                    aria-labelledby={`label-registrationMode-${mode}`}
                    type="radio"
                    name="registrationMode"
                    value={mode}
                    bind:group={$form.registrationMode}
                    class="radio"
                  />
                  <span id={`label-registrationMode-${mode}`}
                    >{t(registrationModeLabelKey(mode))}</span
                  >
                </label>
              {/each}
            </fieldset>
            {#if editable}<button type="submit" class="btn btn-primary justify-self-start"
                >{t('form.save')}</button
              >{/if}
          </form>
        </div>
      </div>
    </div>
  {/snippet}
</SettingsPage>
