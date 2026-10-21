<script lang="ts">
  import ListPage from '$lib/components/page/list-page.svelte';
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('ops.organizations.title')} · {t('brand.name')}</title></svelte:head>

<ListPage>
  {#snippet title()}{t('ops.organizations.title')}{/snippet}
  {#snippet body()}
    <div class="grid gap-6">
      <header>
        <p class="mt-2">{t('ops.organizations.intro')}</p>
      </header>
      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <h2 class="card-title">{t('ops.organizations.list_title')}</h2>
        </div>
        <div class="card-body">
          {#if data.organizations.length === 0}
            <p>{t('ops.organizations.empty')}</p>
          {:else}
            <div class="overflow-x-auto">
              <table class="table w-full">
                <caption class="sr-only">{t('ops.organizations.list_title')}</caption>
                <thead>
                  <tr>
                    <th scope="col" class="px-3 py-3">{t('ops.organization.name')}</th>
                    <th scope="col" class="px-3 py-3">{t('ops.organization.events')}</th>
                    <th scope="col" class="px-3 py-3">{t('ops.status')}</th>
                    <th scope="col" class="px-3 py-3">{t('ops.created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each data.organizations as organization (organization.id)}
                    <tr>
                      <th scope="row" class="px-3 py-4">
                        <a
                          href={resolve('/ops/organizations/[orgId]', { orgId: organization.id })}
                          class="link">{organization.name}</a
                        >
                        <p class="mt-1">/{organization.slug}</p>
                      </th>
                      <td class="px-3 py-4">{organization.eventCount}</td>
                      <td class="px-3 py-4">
                        <span
                          class={organization.suspendedAt
                            ? 'badge badge-error'
                            : 'badge badge-success'}
                        >
                          {t(
                            organization.suspendedAt ? 'ops.status.suspended' : 'ops.status.active'
                          )}
                        </span>
                      </td>
                      <td class="px-3 py-4">{organization.createdAtLabel}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/snippet}
</ListPage>
