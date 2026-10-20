<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, Building2 } from '@lucide/svelte';
  import { translator } from '$lib/i18n';
  import { organizationRoleLabelKey } from '$lib/shared/organization';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('app.dashboard')} · {t('brand.name')}</title></svelte:head>

<div class="mx-auto max-w-5xl">
  <div class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">{t('app.dashboard')}</h1>
      <p class="text-muted-foreground mt-2 max-w-2xl">{t('app.dashboard_intro')}</p>
    </div>
    <a
      class="bg-primary text-primary-foreground inline-flex min-h-12 items-center rounded-md px-5 text-sm font-semibold hover:brightness-95"
      href={resolve('/app/organizations/new')}>{t('organization.create_cta')}</a
    >
  </div>

  <section class="mt-10" aria-labelledby="organizations-heading">
    <h2 id="organizations-heading" class="text-xl font-bold">{t('app.organizations')}</h2>
    {#if data.organizations.length === 0}
      <div class="bg-background mt-4 rounded-xl border p-7 sm:p-9">
        <Building2 aria-hidden="true" class="text-primary" size={28} />
        <h3 class="mt-4 text-lg font-bold">{t('app.empty_title')}</h3>
        <p class="text-muted-foreground mt-2 max-w-xl">{t('app.empty_body')}</p>
        <a
          class="text-primary mt-5 inline-flex min-h-12 items-center gap-2 font-semibold"
          href={resolve('/app/organizations/new')}
        >
          {t('organization.create_cta')}<ArrowRight aria-hidden="true" size={18} />
        </a>
      </div>
    {:else}
      <div class="bg-background mt-4 overflow-hidden rounded-xl border">
        {#each data.organizations as organization, index (organization.id)}
          <a
            class="hover:bg-accent/60 flex min-h-20 items-center justify-between gap-5 px-5 py-4"
            class:border-t={index > 0}
            href={resolve('/app/organizations/[orgId]', { orgId: organization.id })}
          >
            <span class="min-w-0">
              <span class="block truncate font-bold">{organization.name}</span>
              <span class="text-muted-foreground mt-1 block text-sm"
                >{t(organizationRoleLabelKey(organization.actorRole))}</span
              >
            </span>
            <ArrowRight aria-hidden="true" class="text-muted-foreground shrink-0" size={19} />
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>
