<script lang="ts">
  import FormPage from '$lib/components/page/form-page.svelte';
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import { registrationModeLabelKey, registrationModes } from '$lib/shared/event';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const eventForm = superForm(untrack(() => data.form));
  const { form, errors, message, enhance } = eventForm;
  const backHref = $derived(resolve('/app/organizations/[orgId]', { orgId: data.organization.id }));
</script>

<svelte:head><title>{t('event.new_title')} · {t('brand.name')}</title></svelte:head>

<FormPage>
  {#snippet title()}{t('event.new_title')}{/snippet}
  {#snippet body()}
    <div class="mx-auto max-w-2xl">
      <a href={backHref} class="btn btn-ghost inline-flex min-h-11 items-center"
        >{t('organization.home_nav')}</a
      >
      <div class="card card-border bg-base-100 mt-4">
        <div class="card-body gap-2 pb-0">
          <p class="mt-2">{t('event.new_intro')}</p>
        </div>
        <div class="card-body">
          {#if $message}
            <div role="alert" class="alert alert-error mb-6">{$message}</div>
          {/if}
          <form method="POST" action="?/create" use:enhance class="grid gap-6">
            <div class="grid gap-2">
              <label for="copyFromEventId" class="label">{t('event.copy_from')}</label>
              <select
                id="copyFromEventId"
                name="copyFromEventId"
                bind:value={$form.copyFromEventId}
                class="select w-full"
                aria-describedby="copy-help"
              >
                <option value="">{t('event.copy_none')}</option>
                {#each data.copySources as source (source.id)}<option value={source.id}
                    >{source.title}</option
                  >{/each}
              </select>
              <p id="copy-help">{t('event.copy_help')}</p>
              {#if $errors.copyFromEventId}<p role="alert">{$errors.copyFromEventId[0]}</p>{/if}
            </div>
            <div class="grid gap-2">
              <label for="title" class="label">{t('event.title')}</label>
              <input
                id="title"
                name="title"
                bind:value={$form.title}
                required
                maxlength={200}
                aria-invalid={$errors.title ? 'true' : undefined}
                aria-describedby={$errors.title ? 'title-error' : 'title-help'}
                class="input w-full"
              />
              <p id="title-help">{t('event.title_help')}</p>
              {#if $errors.title}<p id="title-error" role="alert">
                  {$errors.title[0]}
                </p>{/if}
            </div>
            <div class="grid gap-2">
              <label for="startsAt" class="label">{t('event.starts_at')}</label>
              <input
                id="startsAt"
                name="startsAt"
                type="datetime-local"
                bind:value={$form.startsAt}
                required
                aria-invalid={$errors.startsAt ? 'true' : undefined}
                class="input w-full"
              />
              {#if $errors.startsAt}<p role="alert">
                  {$errors.startsAt[0]}
                </p>{/if}
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
                aria-invalid={$errors.capacity ? 'true' : undefined}
                aria-describedby={$errors.capacity ? 'capacity-error' : 'capacity-help'}
                class="input w-full"
              />
              <p id="capacity-help">
                {t('event.capacity_help')}
              </p>
              {#if $errors.capacity}<p id="capacity-error" role="alert">
                  {$errors.capacity[0]}
                </p>{/if}
            </div>
            <fieldset class="fieldset grid gap-3">
              <legend class="fieldset-legend">{t('event.registration_mode_label')}</legend>
              <p>{t('event.registration_mode_help')}</p>
              <label class="label"
                ><input
                  type="radio"
                  name="registrationMode"
                  value=""
                  bind:group={$form.registrationMode}
                  class="radio"
                />{t('event.copy_inherit')}</label
              >
              {#each registrationModes as mode (mode)}
                <label
                  for={`field-registrationMode-${mode}`}
                  class="label flex min-h-12 items-center gap-3 px-4"
                >
                  <input
                    id={`field-registrationMode-${mode}`}
                    type="radio"
                    name="registrationMode"
                    value={mode}
                    bind:group={$form.registrationMode}
                    class="radio"
                  />
                  <span>{t(registrationModeLabelKey(mode))}</span>
                </label>
              {/each}
            </fieldset>
            <div class="flex flex-wrap gap-3">
              <button type="submit" class="btn btn-primary">{t('event.create_submit')}</button>
              <a href={backHref} class="btn inline-flex min-h-12 items-center px-5"
                >{t('form.cancel')}</a
              >
            </div>
          </form>
        </div>
      </div>
    </div>
  {/snippet}
</FormPage>
