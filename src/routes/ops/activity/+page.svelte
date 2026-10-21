<script lang="ts">
  import ListPage from '$lib/components/page/list-page.svelte';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { auditActionLabelKey } from '$lib/shared/audit';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('ops.activity.title')} · {t('brand.name')}</title></svelte:head>

<ListPage>
  {#snippet title()}{t('ops.activity.title')}{/snippet}
  {#snippet filters()}<div class="card card-border bg-base-100">
      <div class="card-body gap-2 pb-0">
        <h2 class="card-title">{t('ops.activity.filters')}</h2>
      </div>
      <div class="card-body">
        <form
          method="GET"
          action={resolve('/ops/activity')}
          class="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
        >
          <div>
            <label for="action-prefix" class="label">{t('ops.activity.action_prefix')}</label>
            <p id="action-prefix-help" class="mt-1">
              {t('ops.activity.action_prefix_help')}
            </p>
            <input
              id="action-prefix"
              name="action"
              value={data.actionPrefix}
              maxlength={200}
              aria-describedby="action-prefix-help"
              class="input mt-2 w-full"
            />
          </div>
          <div>
            <label for="target-id" class="label">{t('ops.activity.target_id')}</label>
            <p id="target-id-help" class="mt-1">
              {t('ops.activity.target_id_help')}
            </p>
            <input
              id="target-id"
              name="target"
              value={data.targetId}
              maxlength={200}
              aria-describedby="target-id-help"
              class="input mt-2 w-full"
            />
          </div>
          <button type="submit" class="btn btn-primary">{t('ops.activity.apply')}</button>
        </form>
      </div>
    </div>{/snippet}
  {#snippet body()}
    <div class="grid gap-6">
      <header>
        <p class="mt-2">{t('ops.activity.intro')}</p>
      </header>

      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <h2 class="card-title">{t('ops.activity.results')}</h2>
        </div>
        <div class="card-body">
          {#if data.rows.length === 0}
            <p>{t('ops.activity.empty')}</p>
          {:else}
            <div class="overflow-x-auto">
              <table class="table">
                <caption class="sr-only">{t('ops.activity.results')}</caption>
                <thead
                  ><tr
                    ><th scope="col">{t('activity.column.action')}</th><th scope="col"
                      >{t('activity.column.actor')}</th
                    ><th scope="col">{t('activity.column.date')}</th><th scope="col"
                      >{t('activity.column.details')}</th
                    ></tr
                  ></thead
                >
                <tbody
                  >{#each data.rows as row (row.id)}<tr>
                      <th scope="row">{t(auditActionLabelKey(row.action))}</th>
                      <td
                        >{row.actorName
                          ? t('activity.actor', { name: row.actorName })
                          : t('activity.system_actor')}</td
                      >
                      <td>{row.createdAtLabel}</td><td>
                        {#if row.eventTitle}<p>
                            {t('activity.event', { event: row.eventTitle })}
                          </p>{/if}
                        {#if row.reason}<p>{t('activity.reason', { reason: row.reason })}</p>{/if}
                        {#if row.targetId}<p>
                            {t('ops.activity.target_value', { id: row.targetId })}
                          </p>{/if}
                      </td></tr
                    >{/each}</tbody
                >
              </table>
            </div>
          {/if}
          {#if data.previousHref || data.nextHref}
            <nav
              aria-label={t('ops.activity.pagination')}
              class="mt-6 flex justify-between gap-4 pt-5"
            >
              <span
                >{#if data.previousHref}<a href={data.previousHref} class="link"
                    >{t('ops.previous')}</a
                  >{/if}</span
              >
              <span
                >{#if data.nextHref}<a href={data.nextHref} class="link">{t('ops.next')}</a
                  >{/if}</span
              >
            </nav>
          {/if}
        </div>
      </div>
    </div>
  {/snippet}
</ListPage>
