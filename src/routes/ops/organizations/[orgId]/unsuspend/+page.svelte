<script lang="ts">
  import FormPage from '$lib/components/page/form-page.svelte';
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head
  ><title>{t('ops.organization.unsuspend')} · {data.organization.name} · {t('brand.name')}</title
  ></svelte:head
>

<FormPage>
  {#snippet title()}{t('ops.organization.unsuspend')}{/snippet}
  {#snippet body()}
    <div class="mx-auto max-w-2xl">
      <p class="mt-3">
        {t('ops.suspension.organization_restore', { name: data.organization.name })}
      </p>
      <form method="POST" action="?/unsuspend" use:enhance class="mt-8 flex flex-wrap gap-3">
        <button type="submit" class="btn btn-primary"
          >{t('ops.suspension.confirm_unsuspend')}</button
        >
        <a
          href={resolve('/ops/organizations/[orgId]', { orgId: data.organization.id })}
          class="btn inline-flex h-12 items-center justify-center px-5">{t('form.cancel')}</a
        >
      </form>
    </div>
  {/snippet}
</FormPage>
