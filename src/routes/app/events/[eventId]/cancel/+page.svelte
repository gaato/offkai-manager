<script lang="ts">
  import FormPage from '$lib/components/page/form-page.svelte';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';

  type ActionResult = { actionError?: string; reason?: string } | null;
  let { data, form: rawActionResult } = $props();
  const t = $derived(translator(data.locale));
  const actionResult = $derived(rawActionResult as ActionResult);
  const backHref = $derived(resolve('/app/events/[eventId]', { eventId: data.event.id }));
</script>

<svelte:head
  ><title>{t('event.cancel_confirm_title')} · {data.event.title} · {t('brand.name')}</title
  ></svelte:head
>

<FormPage>
  {#snippet title()}{t('event.cancel_confirm_title')}{/snippet}
  {#snippet body()}
    <div class="card card-border bg-base-100 mx-auto max-w-2xl">
      <div class="card-body gap-2 pb-0">
        <p>{data.event.title}</p>
        <p class="mt-2">{t('event.cancel_confirm_question')}</p>
      </div>
      <div class="card-body">
        {#if actionResult?.actionError}
          <div role="alert" class="alert alert-error mb-6">{actionResult.actionError}</div>
        {/if}
        <form method="POST" action="?/cancel" class="grid gap-5">
          <div class="grid gap-2">
            <label for="reason" class="label">{t('event.cancel_reason')}</label>
            <textarea
              id="reason"
              name="reason"
              required
              maxlength={2000}
              rows={4}
              class="textarea bg-base-100 min-h-24 w-full px-3 py-2"
              >{actionResult?.reason ?? ''}</textarea
            >
            <p>{t('event.cancel_reason_help')}</p>
          </div>
          <div class="flex flex-wrap gap-3">
            <button type="submit" class="btn btn-error">{t('event.cancel_confirm_submit')}</button>
            <a href={backHref} class="btn inline-flex min-h-12 items-center px-5"
              >{t('event.back_overview')}</a
            >
          </div>
        </form>
      </div>
    </div>
  {/snippet}
</FormPage>
