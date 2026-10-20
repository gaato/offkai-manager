<script lang="ts">
  import {
    ArrowRight,
    CheckCircle2,
    ClipboardList,
    CreditCard,
    HandHeart,
    ScanLine
  } from '@lucide/svelte';
  import { translator } from '$lib/i18n';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

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

<section class="relative overflow-hidden border-b">
  <div
    class="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,var(--accent),transparent_48%)]"
  ></div>
  <div
    class="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-28"
  >
    <div class="max-w-3xl">
      <Badge class="border-primary/25 bg-background/70 text-primary mb-6"
        >{t('landing.eyebrow')}</Badge
      >
      <h1
        class="max-w-3xl text-5xl leading-[1.06] font-bold tracking-tight text-balance sm:text-6xl"
      >
        {t('landing.title')}
      </h1>
      <p class="text-muted-foreground mt-7 max-w-2xl text-lg leading-8 sm:text-xl">
        {t('landing.lead')}
      </p>
      <a
        class="bg-primary text-primary-foreground mt-9 inline-flex min-h-12 items-center gap-2 rounded-md px-6 font-semibold transition hover:brightness-95"
        href="#features"
      >
        {t('landing.cta')}
        <ArrowRight aria-hidden="true" size={18} />
      </a>
    </div>
    <Card class="border-primary/15 bg-card/90 shadow-primary/10 rotate-1 shadow-xl">
      <CardHeader>
        <CheckCircle2 class="text-primary" aria-hidden="true" size={36} />
        <CardTitle class="pt-3">{t('landing.empty_domain')}</CardTitle>
      </CardHeader>
    </Card>
  </div>
</section>

{#if data.campaignsEnabled}
  <section class="bg-muted/30 border-t">
    <div class="mx-auto max-w-6xl px-5 py-20">
      <Card class="border-primary/20 shadow-none">
        <div class="grid gap-8 p-6 sm:p-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
          <div>
            <HandHeart aria-hidden="true" class="text-primary" size={34} />
            <p class="text-primary mt-5 text-sm font-semibold">{t('landing.campaign.eyebrow')}</p>
            <h2 class="mt-2 text-3xl font-bold tracking-tight">
              {t('landing.campaign.title')}
            </h2>
          </div>
          <div>
            <p class="text-xl font-semibold">{t('landing.campaign.rhythm')}</p>
            <p class="text-muted-foreground mt-4 max-w-2xl leading-7">
              {t('landing.campaign.body')}
            </p>
          </div>
        </div>
      </Card>
    </div>
  </section>
{/if}

<section id="features" class="mx-auto max-w-6xl scroll-mt-6 px-5 py-20">
  <h2 class="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
    {t('landing.features.title')}
  </h2>
  <div class="mt-10 grid gap-5 md:grid-cols-3">
    {#each features as feature (feature.title)}
      {@const Icon = feature.icon}
      <Card class="h-full">
        <CardHeader>
          <Icon aria-hidden="true" class="text-primary" size={28} />
          <CardTitle class="pt-3">{feature.title}</CardTitle>
        </CardHeader>
        <CardContent><p class="text-muted-foreground">{feature.body}</p></CardContent>
      </Card>
    {/each}
  </div>
</section>
