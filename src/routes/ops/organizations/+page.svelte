<script lang="ts">
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('ops.organizations.title')} · {t('brand.name')}</title></svelte:head>

<div class="grid gap-6">
  <header>
    <h1 class="text-3xl font-bold tracking-tight">{t('ops.organizations.title')}</h1>
    <p class="mt-2 text-slate-600">{t('ops.organizations.intro')}</p>
  </header>
  <Card class="border-slate-200 shadow-none">
    <CardHeader><CardTitle>{t('ops.organizations.list_title')}</CardTitle></CardHeader>
    <CardContent>
      {#if data.organizations.length === 0}
        <p class="text-slate-600">{t('ops.organizations.empty')}</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <caption class="sr-only">{t('ops.organizations.list_title')}</caption>
            <thead class="border-b border-slate-200 text-slate-600">
              <tr>
                <th class="px-3 py-3" scope="col">{t('ops.organization.name')}</th>
                <th class="px-3 py-3" scope="col">{t('ops.organization.events')}</th>
                <th class="px-3 py-3" scope="col">{t('ops.status')}</th>
                <th class="px-3 py-3" scope="col">{t('ops.created')}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              {#each data.organizations as organization (organization.id)}
                <tr>
                  <th class="px-3 py-4" scope="row">
                    <a
                      class="font-semibold underline-offset-4 hover:underline"
                      href={resolve('/ops/organizations/[orgId]', { orgId: organization.id })}
                      >{organization.name}</a
                    >
                    <p class="mt-1 font-normal text-slate-600">/{organization.slug}</p>
                  </th>
                  <td class="px-3 py-4 tabular-nums">{organization.eventCount}</td>
                  <td class="px-3 py-4">
                    <Badge
                      class={organization.suspendedAt
                        ? 'bg-amber-100 text-amber-950'
                        : 'bg-emerald-100 text-emerald-950'}
                    >
                      {t(organization.suspendedAt ? 'ops.status.suspended' : 'ops.status.active')}
                    </Badge>
                  </td>
                  <td class="px-3 py-4">{organization.createdAtLabel}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
