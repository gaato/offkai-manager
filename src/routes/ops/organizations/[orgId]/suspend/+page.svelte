<script lang="ts">
  import FormPage from '$lib/components/page/form-page.svelte';
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head
  ><title>{t('ops.organization.suspend')} · {data.organization.name} · {t('brand.name')}</title
  ></svelte:head
>

<FormPage>
  {#snippet title()}{t('ops.organization.suspend')}{/snippet}
  {#snippet body()}
    <div class="mx-auto max-w-2xl">
      <p class="mt-3">
        {t('ops.suspension.organization_warning', { name: data.organization.name })}
      </p>
      <form method="POST" action="?/suspend" use:enhance class="mt-8 grid gap-5">
        <div>
          <label for="reason" class="label">{t('ops.suspension.reason')}</label>
          <p id="reason-help" class="mt-1">{t('ops.suspension.reason_help')}</p>
          <textarea
            id="reason"
            name="reason"
            rows="5"
            maxlength="2000"
            required
            aria-describedby={data.form.errors.reason ? 'reason-help reason-error' : 'reason-help'}
            class="textarea mt-2 min-h-32 w-full px-3 py-2">{data.form.data.reason ?? ''}</textarea
          >
          {#if data.form.errors.reason}<p id="reason-error" class="mt-2">
              {data.form.errors.reason}
            </p>{/if}
        </div>
        {#if data.form.message}<p role="alert">{data.form.message}</p>{/if}
        <div class="flex flex-wrap gap-3">
          <button type="submit" class="btn btn-error">{t('ops.suspension.confirm_suspend')}</button>
          <a
            href={resolve('/ops/organizations/[orgId]', { orgId: data.organization.id })}
            class="btn inline-flex h-12 items-center justify-center px-5">{t('form.cancel')}</a
          >
        </div>
      </form>
    </div>
  {/snippet}
</FormPage>
