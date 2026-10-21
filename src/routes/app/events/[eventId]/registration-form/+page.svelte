<script lang="ts">
  import Confirmation from '$lib/components/confirmation.svelte';
  import SettingsPage from '$lib/components/page/settings-page.svelte';
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import { formFieldTypeLabelKey, formFieldTypes } from '$lib/shared/registration-form';

  let { data, form: actionResult } = $props();
  const t = $derived(translator(data.locale));
  const fieldForm = superForm(untrack(() => data.form));
  const { form, errors, message, enhance } = fieldForm;
  let enhanced = $state(false);
  const editable = $derived(
    data.capabilities.canManageRegistrationForm && !data.event.cancelledAt && !data.event.archivedAt
  );
  const activeFields = $derived(data.fields.filter((field) => !field.archivedAt));
  const archivedFields = $derived(data.fields.filter((field) => field.archivedAt));
  const formHref = $derived(
    resolve('/app/events/[eventId]/registration-form', { eventId: data.event.id })
  );
  const editing = $derived(Boolean($form.fieldId));
  const optionField = $derived($form.fieldType === 'select' || $form.fieldType === 'multiselect');

  $effect(() => {
    enhanced = true;
    if ($form.fieldType === 'consent') $form.required = true;
  });
</script>

<svelte:head
  ><title>{t('registration_form.title')} · {data.event.title} · {t('brand.name')}</title
  ></svelte:head
>

<SettingsPage>
  {#snippet title()}{t('registration_form.title')}{/snippet}
  {#snippet body()}
    <div class="grid gap-6">
      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <p class="mt-2">{t('registration_form.intro')}</p>
        </div>
        <div class="card-body">
          {#if data.event.cancelledAt || data.event.archivedAt}
            <div role="status" class="alert alert-info mb-5">{t('registration_form.frozen')}</div>
          {:else if !data.capabilities.canManageRegistrationForm}
            <div role="status" class="alert alert-info mb-5">
              {t('registration_form.read_only')}
            </div>
          {/if}
          {#if actionResult?.actionMessage}
            <div role="status" class="alert alert-success mb-5">{actionResult.actionMessage}</div>
          {/if}
          {#if actionResult?.actionError}
            <div role="alert" class="alert alert-error mb-5">{actionResult.actionError}</div>
          {/if}
          {#if $message}
            <div
              role={$message === t('registration_form.success_upsert') ? 'status' : 'alert'}
              class={($message === t('registration_form.success_upsert') ? 'status' : 'alert') ===
              'status'
                ? 'alert alert-success'
                : 'alert alert-error'}
            >
              {$message}
            </div>
          {/if}

          <section aria-labelledby="current-fields-title">
            <h2 id="current-fields-title" class="card-title">
              {t('registration_form.fields_title')}
            </h2>
            {#if activeFields.length === 0}
              <p class="mt-3">{t('registration_form.empty')}</p>
            {:else}
              <ol class="mt-4 grid gap-3">
                {#each activeFields as field, index (field.id)}
                  <li>
                    <article class="p-4">
                      <div
                        class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div class="min-w-0">
                          <h3 class="card-title">{field.label}</h3>
                          {#if field.helpText}
                            <p class="mt-1">{field.helpText}</p>
                          {/if}
                          <div class="mt-3 flex flex-wrap gap-2">
                            <span class="badge badge-secondary">
                              {t(formFieldTypeLabelKey(field.type))}
                            </span>
                            <span class="badge badge-ghost">
                              {field.required
                                ? t('registration_form.required')
                                : t('registration_form.optional')}
                            </span>
                          </div>
                          {#if field.options.length > 0}
                            <div class="mt-3">
                              <p>
                                {t('registration_form.options')}
                              </p>
                              <ul class="mt-2 flex flex-wrap gap-2">
                                {#each field.options as option (option.id)}
                                  <li class="px-3 py-1">
                                    {option.label}
                                  </li>
                                {/each}
                              </ul>
                            </div>
                          {/if}
                        </div>
                        {#if editable}
                          <div class="flex flex-wrap items-center gap-2">
                            <form method="POST" action="?/reorder">
                              <input type="hidden" name="fieldId" value={field.id} />
                              <input type="hidden" name="direction" value="up" />
                              <button
                                type="submit"
                                disabled={index === 0}
                                class="btn btn-outline btn-sm"
                              >
                                {t('registration_form.move_up')}
                              </button>
                            </form>
                            <form method="POST" action="?/reorder">
                              <input type="hidden" name="fieldId" value={field.id} />
                              <input type="hidden" name="direction" value="down" />
                              <button
                                type="submit"
                                disabled={index === activeFields.length - 1}
                                class="btn btn-outline btn-sm"
                              >
                                {t('registration_form.move_down')}
                              </button>
                            </form>
                            <a
                              href={`${formHref}?edit=${field.id}`}
                              class="btn btn-ghost inline-flex min-h-9 items-center px-3"
                              >{t('registration_form.edit')}</a
                            >
                            <Confirmation
                              label={t('registration_form.archive')}
                              cancelLabel={t('form.cancel')}
                            >
                              {#snippet trigger()}{t('registration_form.archive')}{/snippet}

                              <div class="bg-base-100 right-0 z-10 mt-2 w-72 p-4">
                                <p>{t('registration_form.archive_question')}</p>
                                <form method="POST" action="?/archive" class="mt-3">
                                  <input type="hidden" name="fieldId" value={field.id} />
                                  <button type="submit" class="btn btn-error btn-sm">
                                    {t('registration_form.archive_confirm')}
                                  </button>
                                </form>
                              </div>
                            </Confirmation>
                          </div>
                        {/if}
                      </div>
                    </article>
                  </li>
                {/each}
              </ol>
            {/if}
          </section>

          <details class="mt-6 p-4">
            <summary class="min-h-8">
              {t('registration_form.archived_title')} ({archivedFields.length})
            </summary>
            {#if archivedFields.length === 0}
              <p class="mt-3">
                {t('registration_form.archived_empty')}
              </p>
            {:else}
              <ul class="mt-4 grid gap-3">
                {#each archivedFields as field (field.id)}
                  <li class="p-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <span>{field.label}</span>
                      <span class="badge badge-ghost">
                        {t(formFieldTypeLabelKey(field.type))}
                      </span>
                      <span class="badge badge-ghost">
                        {t('registration_form.archived_badge')}
                      </span>
                    </div>
                    {#if field.options.length > 0}
                      <ul class="mt-2 flex flex-wrap gap-2">
                        {#each field.options as option (option.id)}
                          <li class="bg-base-100 px-3 py-1">{option.label}</li>
                        {/each}
                      </ul>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </details>
        </div>
      </div>

      {#if editable}
        <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
          <div class="card card-border bg-base-100">
            <div class="card-body gap-2 pb-0">
              <h2 class="card-title">
                {editing ? t('registration_form.edit_title') : t('registration_form.add_title')}
              </h2>
            </div>
            <div class="card-body">
              <form method="POST" action="?/upsert" use:enhance class="grid gap-5">
                <input type="hidden" name="fieldId" bind:value={$form.fieldId} />
                <div class="grid gap-2">
                  <label for="registration-field-label" class="label"
                    >{t('registration_form.label')}</label
                  >
                  <input
                    id="registration-field-label"
                    name="label"
                    bind:value={$form.label}
                    required
                    maxlength={200}
                    aria-describedby={$errors.label ? 'registration-field-label-error' : undefined}
                    class="input w-full"
                  />
                  {#if $errors.label}
                    <p id="registration-field-label-error" role="alert">
                      {$errors.label[0]}
                    </p>
                  {/if}
                </div>
                <div class="grid gap-2">
                  <label for="registration-field-type" class="label"
                    >{t('registration_form.field_type')}</label
                  >
                  <select
                    id="registration-field-type"
                    name="fieldType"
                    bind:value={$form.fieldType}
                    class="select bg-base-100 min-h-12 w-full px-3"
                  >
                    {#each formFieldTypes as type (type)}
                      <option value={type}>{t(formFieldTypeLabelKey(type))}</option>
                    {/each}
                  </select>
                </div>
                <label for="field-required" class="label flex min-h-12 items-center gap-3 px-4">
                  <input
                    id="field-required"
                    type="checkbox"
                    name="required"
                    bind:checked={$form.required}
                    disabled={$form.fieldType === 'consent'}
                    class="checkbox"
                  />
                  <span>{t('registration_form.required_answer')}</span>
                </label>
                <div class="grid gap-2">
                  <label for="registration-field-help" class="label"
                    >{t('registration_form.help_text')}</label
                  >
                  <input
                    id="registration-field-help"
                    name="helpText"
                    bind:value={$form.helpText}
                    maxlength={2000}
                    class="input w-full"
                  />
                </div>
                {#if !enhanced || optionField}
                  <div class="grid gap-2">
                    <label for="registration-field-options" class="label">
                      {t('registration_form.option_labels')}
                    </label>
                    <textarea
                      id="registration-field-options"
                      name="options"
                      bind:value={$form.options}
                      rows={6}
                      maxlength={20000}
                      aria-describedby="registration-field-options-help registration-field-options-error"
                      class="textarea bg-base-100 min-h-32 w-full px-3 py-2"
                    ></textarea>
                    <p id="registration-field-options-help">
                      {t('registration_form.options_help')}
                    </p>
                    {#if $errors.options}
                      <p id="registration-field-options-error" role="alert">
                        {$errors.options[0]}
                      </p>
                    {/if}
                  </div>
                {/if}
                <div class="flex flex-wrap gap-3">
                  <button type="submit" class="btn btn-primary">
                    {editing
                      ? t('registration_form.edit_submit')
                      : t('registration_form.add_submit')}
                  </button>
                  {#if editing}
                    <a href={formHref} class="btn inline-flex min-h-10 items-center px-4"
                      >{t('registration_form.cancel_edit')}</a
                    >
                  {/if}
                </div>
              </form>
            </div>
          </div>

          <div class="card card-border bg-base-100">
            <div class="card-body gap-2 pb-0">
              <h2 class="card-title">{t('registration_form.presets_title')}</h2>
              <p class="mt-2">
                {t('registration_form.presets_intro')}
              </p>
            </div>
            <div class="card-body grid gap-3">
              {#each data.presets as preset (preset.key)}
                <form method="POST" action="?/preset">
                  <input type="hidden" name="presetKey" value={preset.key} />
                  <button
                    type="submit"
                    class="btn btn-outline h-auto min-h-11 w-full justify-start"
                  >
                    {t('registration_form.preset_add', { label: t(preset.labelKey) })}
                  </button>
                </form>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/snippet}
</SettingsPage>
