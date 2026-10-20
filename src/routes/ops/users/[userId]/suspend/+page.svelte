<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head
  ><title>{t('ops.user.suspend')} · {data.user.displayName} · {t('brand.name')}</title></svelte:head
>

<div class="mx-auto max-w-2xl">
  <h1 class="text-3xl font-bold tracking-tight">{t('ops.user.suspend')}</h1>
  <p class="mt-3 text-slate-600">
    {t('ops.suspension.user_warning', { name: data.user.displayName })}
  </p>
  <form method="POST" action="?/suspend" use:enhance class="mt-8 grid gap-5">
    <div>
      <Label for="reason">{t('ops.suspension.reason')}</Label>
      <p id="reason-help" class="mt-1 text-sm text-slate-600">{t('ops.suspension.reason_help')}</p>
      <textarea
        id="reason"
        name="reason"
        rows="5"
        maxlength="2000"
        required
        aria-describedby={data.form.errors.reason ? 'reason-help reason-error' : 'reason-help'}
        class="mt-2 min-h-32 w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-base"
        >{data.form.data.reason ?? ''}</textarea
      >
      {#if data.form.errors.reason}<p id="reason-error" class="mt-2 text-sm text-red-700">
          {data.form.errors.reason}
        </p>{/if}
    </div>
    {#if data.form.message}<p role="alert" class="text-sm text-red-700">{data.form.message}</p>{/if}
    <div class="flex flex-wrap gap-3">
      <Button type="submit" variant="destructive">{t('ops.suspension.confirm_suspend')}</Button>
      <a
        class="inline-flex h-12 items-center justify-center rounded-md border bg-white px-5 text-sm font-semibold hover:bg-slate-100"
        href={resolve('/ops/users/[userId]', { userId: data.user.id })}>{t('form.cancel')}</a
      >
    </div>
  </form>
</div>
