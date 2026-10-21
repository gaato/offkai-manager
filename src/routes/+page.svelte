<script lang="ts">
  import DetailPage from '$lib/components/page/detail-page.svelte';
  import { ArrowRight, CheckCircle2, ClipboardList, CreditCard, ScanLine } from '@lucide/svelte';
  import { translator } from '$lib/i18n';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const features = $derived([
    {
      title: t('landing.feature.registration.title'),
      body: t('landing.feature.registration.body'),
      icon: ClipboardList
    },
    {
      title: t('landing.feature.payments.title'),
      body: t('landing.feature.payments.body'),
      icon: CreditCard
    },
    {
      title: t('landing.feature.checkin.title'),
      body: t('landing.feature.checkin.body'),
      icon: ScanLine
    }
  ]);
</script>

<svelte:head><title>{t('landing.title')} · {t('brand.name')}</title></svelte:head>

<DetailPage>
  {#snippet title()}{t('landing.title')}{/snippet}
  {#snippet body()}
    <section class="overflow-hidden">
      <div
        class="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-28"
      >
        <div class="max-w-3xl">
          <span class="badge badge-primary mb-6">{t('landing.eyebrow')}</span>

          <p class="mt-7 max-w-2xl">
            {t('landing.lead')}
          </p>
          <a
            href="#features"
            class="btn btn-primary mt-9 inline-flex min-h-12 items-center gap-2 px-6"
          >
            {t('landing.cta')}
            <ArrowRight aria-hidden="true" size={18} />
          </a>
        </div>
        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <CheckCircle2 aria-hidden="true" size={36} />
            <h2 class="card-title pt-3">{t('landing.empty_domain')}</h2>
          </div>
        </div>
      </div>
    </section>

    <section id="features" class="mx-auto max-w-6xl px-5 py-20">
      <h2 class="card-title max-w-2xl">
        {t('landing.features.title')}
      </h2>
      <div class="mt-10 grid gap-5 md:grid-cols-3">
        {#each features as feature (feature.title)}
          {@const Icon = feature.icon}
          <div class="card card-border bg-base-100 h-full">
            <div class="card-body gap-2 pb-0">
              <Icon aria-hidden="true" size={28} />
              <h2 class="card-title pt-3">{feature.title}</h2>
            </div>
            <div class="card-body"><p>{feature.body}</p></div>
          </div>
        {/each}
      </div>
    </section>
  {/snippet}
</DetailPage>
