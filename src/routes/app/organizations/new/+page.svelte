<script lang="ts">
  import FormPage from '$lib/components/page/form-page.svelte';
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const form = superForm(untrack(() => data.form));
  const { form: formData, errors, message, enhance } = form;
</script>

<svelte:head><title>{t('organization.new_title')} · {t('brand.name')}</title></svelte:head>

<FormPage>
  {#snippet title()}{t('organization.new_title')}{/snippet}
  {#snippet body()}
    <div class="mx-auto max-w-2xl">
      <a href={resolve('/app')} class="btn btn-ghost inline-flex min-h-11 items-center"
        >{t('app.back_dashboard')}</a
      >
      <div class="card card-border bg-base-100 mt-4">
        <div class="card-body gap-2 pb-0">
          <p class="mt-2">{t('organization.new_intro')}</p>
        </div>
        <div class="card-body">
          {#if $message}
            <div role="alert" class="alert alert-error mb-6">{$message}</div>
          {/if}
          <form method="POST" action="?/create" use:enhance class="grid gap-6">
            <div class="grid gap-2">
              <label for="name" class="label">{t('organization.name')}</label>
              <input
                id="name"
                name="name"
                bind:value={$formData.name}
                autocomplete="organization-title"
                required
                maxlength={120}
                aria-invalid={$errors.name ? 'true' : undefined}
                aria-describedby={$errors.name ? 'name-error' : 'name-help'}
                class="input w-full"
              />
              <p id="name-help">{t('organization.name_help')}</p>
              {#if $errors.name}
                <p id="name-error" role="alert">{$errors.name[0]}</p>
              {/if}
            </div>
            <div class="flex flex-wrap gap-3">
              <button type="submit" class="btn btn-primary"
                >{t('organization.create_submit')}</button
              >
              <a href={resolve('/app')} class="btn inline-flex min-h-12 items-center px-5"
                >{t('form.cancel')}</a
              >
            </div>
          </form>
        </div>
      </div>
    </div>
  {/snippet}
</FormPage>
