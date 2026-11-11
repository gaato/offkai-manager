<script lang="ts">
  import FormPage from '$lib/components/page/form-page.svelte';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';

  type ActionResult = { actionError?: string } | null;
  let { data, form: rawActionResult } = $props();
  const t = $derived(translator(data.locale));
  const actionResult = $derived(rawActionResult as ActionResult);
  const backHref = $derived(resolve('/app/events/[eventId]', { eventId: data.event.id }));
</script>

<svelte:head
  ><title>{t('payment.overdue_release_title')} · {data.event.title} · {t('brand.name')}</title
  ></svelte:head
>

<FormPage>
  {#snippet title()}{t('payment.overdue_release_title')}{/snippet}
  {#snippet body()}
    <div class="card card-border bg-base-100 mx-auto max-w-2xl">
      <div class="card-body gap-2 pb-0">
        <p>{data.event.title}</p>
        <p class="mt-2">
          {data.notYet
            ? t('payment.overdue_release_not_yet', { release: data.notYet })
            : data.overdue.length === 0
              ? t('payment.overdue_release_none')
              : t(
                  data.overdue.length === 1
                    ? 'payment.overdue_release_question_one'
                    : 'payment.overdue_release_question_other',
                  { count: data.overdue.length }
                )}
        </p>
        {#if data.overdue.length > 0}
          <ul class="list mt-2">
            {#each data.overdue as row (row.registrationId)}
              <li class="list-row">{row.displayName}</li>
            {/each}
          </ul>
        {/if}
        <p class="mt-2">{t('payment.overdue_release_paying_note')}</p>
      </div>
      <div class="card-body">
        {#if actionResult?.actionError}
          <div role="alert" class="alert alert-error mb-6">{actionResult.actionError}</div>
        {/if}
        <form method="POST" action="?/release" class="flex flex-wrap gap-3">
          {#each data.overdue as row (row.registrationId)}
            <input type="hidden" name="registrationId" value={row.registrationId} />
          {/each}
          {#if data.overdue.length > 0}
            <button type="submit" class="btn btn-error"
              >{t(
                data.overdue.length === 1
                  ? 'payment.overdue_release_submit_one'
                  : 'payment.overdue_release_submit_other',
                { count: data.overdue.length }
              )}</button
            >
          {/if}
          <a href={backHref} class="btn inline-flex min-h-12 items-center px-5"
            >{t('event.back_overview')}</a
          >
        </form>
      </div>
    </div>
  {/snippet}
</FormPage>
