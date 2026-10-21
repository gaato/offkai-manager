<script lang="ts">
  import FormPage from '$lib/components/page/form-page.svelte';
  import { superForm } from 'sveltekit-superforms';
  import { untrack } from 'svelte';
  import { translator } from '$lib/i18n';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const form = superForm(untrack(() => data.form));
  const { form: formData, errors, enhance } = form;
</script>

<svelte:head><title>{t('dev.title')} · {t('brand.name')}</title></svelte:head>

<FormPage>
  {#snippet title()}{t('dev.title')}{/snippet}
  {#snippet body()}
    <section class="mx-auto max-w-xl px-5 py-16">
      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0"></div>
        <div class="card-body">
          <p class="mb-6">{t('dev.warning')}</p>
          <form method="POST" action="?/signIn" use:enhance class="grid gap-6">
            <input name="returnTo" type="hidden" bind:value={$formData.returnTo} />
            <div class="grid gap-2">
              <label for="discordUserId" class="label">{t('dev.discord_user_id')}</label>
              <input
                id="discordUserId"
                name="discordUserId"
                bind:value={$formData.discordUserId}
                autocomplete="off"
                inputmode="numeric"
                pattern={'[0-9]{17,20}'}
                required
                aria-describedby={$errors.discordUserId ? 'discordUserId-error' : undefined}
                class="input w-full"
              />
              {#if $errors.discordUserId}<p id="discordUserId-error">
                  {$errors.discordUserId[0]}
                </p>{/if}
            </div>
            <div class="grid gap-2">
              <label for="username" class="label">{t('dev.username')}</label>
              <input
                id="username"
                name="username"
                bind:value={$formData.username}
                autocomplete="username"
                required
                aria-describedby={$errors.username ? 'username-error' : undefined}
                class="input w-full"
              />
              {#if $errors.username}<p id="username-error">
                  {$errors.username[0]}
                </p>{/if}
            </div>
            <div class="grid gap-2">
              <label for="displayName" class="label">{t('dev.display_name')}</label>
              <input
                id="displayName"
                name="displayName"
                bind:value={$formData.displayName}
                autocomplete="name"
                required
                aria-describedby={$errors.displayName ? 'displayName-error' : undefined}
                class="input w-full"
              />
              {#if $errors.displayName}<p id="displayName-error">
                  {$errors.displayName[0]}
                </p>{/if}
            </div>
            <div class="flex min-h-12 items-center gap-3">
              <input
                id="platformAdmin"
                name="platformAdmin"
                type="checkbox"
                bind:checked={$formData.platformAdmin}
                class="toggle"
              />
              <label for="platformAdmin" class="label">{t('dev.platform_admin')}</label>
            </div>
            <button type="submit" class="btn btn-primary">{t('dev.submit')}</button>
          </form>
        </div>
      </div>
    </section>
  {/snippet}
</FormPage>
