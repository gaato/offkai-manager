<script lang="ts">
  import ListPage from '$lib/components/page/list-page.svelte';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('ops.users.title')} · {t('brand.name')}</title></svelte:head>

<ListPage>
  {#snippet title()}{t('ops.users.title')}{/snippet}
  {#snippet filters()}<div class="card card-border bg-base-100">
      <div class="card-body gap-2 pb-0">
        <h2 class="card-title">{t('ops.users.search_title')}</h2>
      </div>
      <div class="card-body">
        <form
          method="GET"
          action={resolve('/ops/users')}
          class="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div class="flex-1">
            <label for="user-query" class="label">{t('ops.users.query')}</label>
            <p id="user-query-help" class="mt-1">
              {t('ops.users.query_help')}
            </p>
            <input
              id="user-query"
              name="q"
              value={data.query}
              maxlength={128}
              aria-describedby="user-query-help"
              class="input mt-2 w-full"
            />
          </div>
          <button type="submit" class="btn btn-primary">{t('ops.users.search')}</button>
        </form>
      </div>
    </div>{/snippet}
  {#snippet body()}
    <div class="grid gap-6">
      <header>
        <p class="mt-2">{t('ops.users.intro')}</p>
      </header>

      {#if data.query}
        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <h2 class="card-title">{t('ops.users.results')}</h2>
          </div>
          <div class="card-body">
            {#if data.users.length === 0}
              <p>{t('ops.users.empty')}</p>
            {:else}
              <div class="overflow-x-auto">
                <table class="table">
                  <caption class="sr-only">{t('ops.users.results')}</caption>
                  <thead
                    ><tr
                      ><th scope="col">{t('ops.nav.users')}</th><th scope="col"
                        >{t('ops.status')}</th
                      ><th scope="col">{t('activity.column.details')}</th></tr
                    ></thead
                  >
                  <tbody
                    >{#each data.users as user (user.id)}<tr>
                        <th scope="row"
                          ><a
                            class="link"
                            href={resolve('/ops/users/[userId]', { userId: user.id })}
                            >{user.displayName}</a
                          >
                          <p>@{user.username} · {user.discordUserId}</p></th
                        >
                        <td
                          ><span
                            class={user.suspendedAt ? 'badge badge-error' : 'badge badge-success'}
                            >{t(
                              user.suspendedAt ? 'ops.status.suspended' : 'ops.status.active'
                            )}</span
                          ></td
                        >
                        <td
                          >{t('ops.user.registration_count', { count: user.registrationCount })} · {t(
                            'ops.created_value',
                            { date: user.createdAtLabel }
                          )}</td
                        >
                      </tr>{/each}</tbody
                  >
                </table>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/snippet}
</ListPage>
