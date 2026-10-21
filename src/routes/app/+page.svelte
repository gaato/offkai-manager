<script lang="ts">
  import DashboardPage from '$lib/components/page/dashboard-page.svelte';
  import { resolve } from '$app/paths';
  import { ArrowRight, Building2 } from '@lucide/svelte';
  import { translator } from '$lib/i18n';
  import { organizationRoleLabelKey } from '$lib/shared/organization';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('app.dashboard')} · {t('brand.name')}</title></svelte:head>

<DashboardPage>
  {#snippet actions()}<a class="btn btn-primary" href={resolve('/app/organizations/new')}
      >{t('organization.create_cta')}</a
    >{/snippet}
  {#snippet title()}{t('app.dashboard')}{/snippet}
  {#snippet stats()}<div class="stat">
      <p class="stat-title">{t('app.organizations')}</p>
      <p class="stat-value">{data.organizations.length}</p>
    </div>{/snippet}
  {#snippet steps()}
    <li class="step">{t('organization.create_cta')}</li>
    <li class="step">{t('app.organizations')}</li>
  {/snippet}
  {#snippet body()}
    <div class="mx-auto max-w-5xl">
      <div class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="mt-2 max-w-2xl">{t('app.dashboard_intro')}</p>
        </div>
      </div>

      <section aria-labelledby="organizations-heading" class="mt-10">
        <h2 id="organizations-heading" class="card-title">{t('app.organizations')}</h2>
        {#if data.organizations.length === 0}
          <div class="bg-base-100 mt-4 p-7 sm:p-9">
            <Building2 aria-hidden="true" size={28} />
            <h3 class="card-title mt-4">{t('app.empty_title')}</h3>
            <p class="mt-2 max-w-xl">{t('app.empty_body')}</p>
            <a
              href={resolve('/app/organizations/new')}
              class="btn btn-ghost mt-5 inline-flex min-h-12 items-center gap-2"
            >
              {t('organization.create_cta')}<ArrowRight aria-hidden="true" size={18} />
            </a>
          </div>
        {:else}
          <div class="bg-base-100 mt-4 overflow-hidden">
            {#each data.organizations as organization (organization.id)}
              <a
                href={resolve('/app/organizations/[orgId]', { orgId: organization.id })}
                class="btn btn-ghost flex min-h-20 items-center justify-between gap-5 px-5 py-4"
              >
                <span class="min-w-0">
                  <span class="block">{organization.name}</span>
                  <span class="mt-1 block"
                    >{t(organizationRoleLabelKey(organization.actorRole))}</span
                  >
                </span>
                <ArrowRight aria-hidden="true" size={19} class="shrink-0" />
              </a>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/snippet}
</DashboardPage>
