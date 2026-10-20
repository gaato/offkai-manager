<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { Button } from '$lib/components/ui/button';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head
  ><title>{t('ops.user.unsuspend')} · {data.user.displayName} · {t('brand.name')}</title
  ></svelte:head
>

<div class="mx-auto max-w-2xl">
  <h1 class="text-3xl font-bold tracking-tight">{t('ops.user.unsuspend')}</h1>
  <p class="mt-3 text-slate-600">
    {t('ops.suspension.user_restore', { name: data.user.displayName })}
  </p>
  <form method="POST" action="?/unsuspend" use:enhance class="mt-8 flex flex-wrap gap-3">
    <Button type="submit">{t('ops.suspension.confirm_unsuspend')}</Button>
    <a
      class="inline-flex h-12 items-center justify-center rounded-md border bg-white px-5 text-sm font-semibold hover:bg-slate-100"
      href={resolve('/ops/users/[userId]', { userId: data.user.id })}>{t('form.cancel')}</a
    >
  </form>
</div>
