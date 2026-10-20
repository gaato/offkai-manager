<script lang="ts">
  import { translator } from '$lib/i18n';
  import { Alert } from '$lib/components/ui/alert';
  import { Card, CardContent } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const venueLine = $derived([data.venue.name, data.venue.address].filter(Boolean).join(' / '));
</script>

<svelte:head>
  <title>{data.title} · {t('brand.name')}</title>
  <meta name="description" content={data.meta.description} />
  <meta property="og:title" content={data.title} />
  <meta property="og:description" content={data.meta.description} />
  <meta property="og:type" content="event" />
  {#if data.meta.noindex}
    <meta name="robots" content="noindex" />
  {/if}
</svelte:head>

<article class="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
  <header>
    <p class="text-primary text-sm font-semibold tracking-wide">
      {t('public_event.organized_by', { organizer: data.organizationName })}
    </p>
    <h1 class="mt-3 text-3xl leading-tight font-bold tracking-tight sm:text-5xl">{data.title}</h1>
    <p class="text-muted-foreground mt-4 text-base font-medium">{data.registrationState}</p>
  </header>

  {#if data.cancelled}
    <Alert class="border-destructive text-destructive mt-8 text-base font-semibold" role="alert">
      {t('public_event.cancelled_notice')}
    </Alert>
  {/if}

  <Card class="mt-8 shadow-none">
    <CardContent class="grid gap-6 pt-6 sm:grid-cols-2">
      <section aria-labelledby="schedule-heading">
        <h2 id="schedule-heading" class="text-muted-foreground text-sm font-semibold">
          {t('public_event.schedule')}
        </h2>
        <p class="mt-1 font-medium">{data.schedule}</p>
      </section>

      <section aria-labelledby="venue-heading">
        <h2 id="venue-heading" class="text-muted-foreground text-sm font-semibold">
          {t('public_event.venue')}
        </h2>
        {#if venueLine}
          <p class="mt-1 font-medium">{venueLine}</p>
        {/if}
        {#if data.venue.revealAfterConfirmation}
          <p class="text-muted-foreground mt-1 text-sm">
            {t('public_event.venue_after_confirmation')}
          </p>
        {:else if !venueLine}
          <p class="text-muted-foreground mt-1">{t('public_event.venue_not_set')}</p>
        {/if}
      </section>

      {#if data.capacityRemaining !== null}
        <section aria-labelledby="capacity-heading">
          <h2 id="capacity-heading" class="text-muted-foreground text-sm font-semibold">
            {t('public_event.capacity')}
          </h2>
          <p class="mt-1 font-medium">
            {t('public_event.capacity_remaining', { count: data.capacityRemaining })}
          </p>
        </section>
      {/if}

      <section aria-labelledby="fee-heading">
        <h2 id="fee-heading" class="text-muted-foreground text-sm font-semibold">
          {t('public_event.fee')}
        </h2>
        <p class="text-muted-foreground mt-1">{t('public_event.fee_placeholder')}</p>
      </section>

      {#if data.contact}
        <section aria-labelledby="contact-heading" class="sm:col-span-2">
          <h2 id="contact-heading" class="text-muted-foreground text-sm font-semibold">
            {t('public_event.contact')}
          </h2>
          <p class="mt-1 whitespace-pre-line">{data.contact}</p>
        </section>
      {/if}
    </CardContent>
  </Card>

  {#if data.description}
    <section class="mt-10" aria-labelledby="about-heading">
      <h2 id="about-heading" class="text-xl font-semibold">{t('public_event.about')}</h2>
      <p class="mt-3 leading-7 whitespace-pre-line">{data.description}</p>
    </section>
  {/if}

  {#if data.cancellationPolicy}
    <section class="border-border mt-10 border-t pt-7" aria-labelledby="policy-heading">
      <h2 id="policy-heading" class="text-xl font-semibold">
        {t('public_event.cancellation_policy')}
      </h2>
      <p class="text-muted-foreground mt-3 leading-7 whitespace-pre-line">
        {data.cancellationPolicy}
      </p>
    </section>
  {/if}

  {#if data.canRegister && !data.cancelled}
    <div
      class="border-border bg-background/95 sticky bottom-0 mt-10 border-t py-5 backdrop-blur-sm"
    >
      <a
        href={data.registerHref}
        class="bg-primary text-primary-foreground inline-flex min-h-12 w-full items-center justify-center rounded-lg px-7 py-2 text-sm font-semibold hover:brightness-95 sm:w-auto"
      >
        {t('public_event.register_cta')}
      </a>
    </div>
  {/if}
</article>
