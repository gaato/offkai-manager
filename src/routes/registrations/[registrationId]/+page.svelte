<script lang="ts">
  import { translator } from '$lib/i18n';
  import { Alert } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head>
  <title>{t('registration.page_title')} · {data.eventTitle} · {t('brand.name')}</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
  <header>
    <p class="text-primary text-sm font-semibold">{t('registration.page_title')}</p>
    <h1 class="mt-2 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
      {data.eventTitle}
    </h1>
    <p class="text-muted-foreground mt-3">{data.schedule}</p>
    <p class="text-muted-foreground mt-1">
      {t('registration.organized_by', { organizer: data.organizationName })}
    </p>
  </header>

  {#if data.withdrawn}
    <Alert class="border-primary/35 bg-secondary/50 mt-8" role="status">
      {t('withdraw.success')}
    </Alert>
  {/if}
  {#if data.eventCancelled}
    <Alert class="border-destructive text-destructive mt-8 font-semibold" role="alert">
      {t('public_event.cancelled_notice')}
    </Alert>
  {/if}
  {#if data.paymentFlash}
    <Alert class="border-primary/35 bg-secondary/50 mt-8" role="status">
      {data.paymentFlash}
    </Alert>
  {/if}
  {#if form?.checkoutError}
    <Alert class="border-destructive text-destructive mt-8" role="alert">
      {form.checkoutError}
    </Alert>
  {/if}

  <Card class="mt-8 shadow-none">
    <CardHeader class="flex-row items-center justify-between gap-4">
      <CardTitle>{t('registration.status_heading')}</CardTitle>
      <Badge class="bg-secondary text-secondary-foreground">{data.statusLabel}</Badge>
    </CardHeader>
    <CardContent>
      <p class="leading-7">{data.next}</p>
      <dl class="border-border mt-6 grid gap-5 border-t pt-6 sm:grid-cols-2">
        <div>
          <dt class="text-muted-foreground text-sm font-semibold">{t('registration.venue')}</dt>
          {#if data.venueLine}
            <dd class="mt-1 font-medium">{data.venueLine}</dd>
          {/if}
          {#if data.venueHidden}
            <dd class="text-muted-foreground mt-1 text-sm">
              {t('public_event.venue_after_confirmation')}
            </dd>
          {:else if !data.venueLine}
            <dd class="text-muted-foreground mt-1">{t('public_event.venue_not_set')}</dd>
          {/if}
        </div>
        {#if data.contact}
          <div>
            <dt class="text-muted-foreground text-sm font-semibold">
              {t('registration.contact')}
            </dt>
            <dd class="mt-1 whitespace-pre-line">{data.contact}</dd>
          </div>
        {/if}
      </dl>
    </CardContent>
  </Card>

  <Card class="mt-8 shadow-none">
    <CardHeader><CardTitle>{t('registration.answers_heading')}</CardTitle></CardHeader>
    <CardContent>
      {#if data.answers.length === 0}
        <p class="text-muted-foreground">{t('registration.answers_empty')}</p>
      {:else}
        <dl class="grid gap-5">
          {#each data.answers as answer, index (index)}
            <div>
              <dt class="text-muted-foreground text-sm font-semibold">{answer.label}</dt>
              <dd class="mt-1 whitespace-pre-line">{answer.value}</dd>
            </div>
          {/each}
        </dl>
      {/if}
    </CardContent>
  </Card>

  <Card class="mt-8 shadow-none">
    <CardHeader><CardTitle>{t('registration.payment_heading')}</CardTitle></CardHeader>
    <CardContent>
      {#if data.payment}
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="font-semibold">{data.payment.title}</p>
          <Badge class="bg-secondary text-secondary-foreground">{data.payment.statusLabel}</Badge>
        </div>
        {#if data.payment.paid}
          <Alert class="border-primary/35 bg-secondary/50 mt-5" role="status">
            <p class="font-semibold">{t('registration.payment_paid')}</p>
            {#if data.payment.paidAt}
              <p class="mt-1 text-sm">
                {t('registration.payment_paid_at', { paidAt: data.payment.paidAt })}
              </p>
            {/if}
          </Alert>
        {/if}
        <dl class="mt-5 grid gap-5 sm:grid-cols-3">
          <div>
            <dt class="text-muted-foreground text-sm font-semibold">
              {t('registration.payment_fee')}
            </dt>
            <dd class="mt-1 text-lg font-bold tabular-nums">{data.payment.amount}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-sm font-semibold">
              {t('registration.payment_due')}
            </dt>
            <dd class="mt-1 font-medium">{data.payment.dueAt}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-sm font-semibold">
              {t('registration.payment_method')}
            </dt>
            <dd class="mt-1 font-medium">{data.payment.method}</dd>
          </div>
        </dl>
        {#if data.payment.online && data.payment.canCheckout}
          <form method="POST" action="?/checkout" class="mt-5">
            <button
              type="submit"
              class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex min-h-12 items-center justify-center rounded-md px-5 font-semibold shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {t('registration.payment_checkout', { amount: data.payment.amount })}
            </button>
          </form>
        {:else if data.payment.onlineUnavailable}
          <Alert class="border-primary/35 bg-secondary/50 mt-5" role="status">
            {t('registration.payment_online_unavailable')}
          </Alert>
        {:else if data.payment.methodInstructions}
          <p class="mt-5 whitespace-pre-line">{data.payment.methodInstructions}</p>
        {/if}
        {#if data.payment.collectionInstructions}
          <div class="mt-5 border-t pt-5">
            <h3 class="text-sm font-semibold">
              {t('registration.payment_collection_instructions')}
            </h3>
            <p class="mt-2 whitespace-pre-line">{data.payment.collectionInstructions}</p>
          </div>
        {/if}
      {:else}
        <p class="text-muted-foreground">{data.paymentPlaceholder}</p>
      {/if}
    </CardContent>
  </Card>

  {#if data.canWithdraw}
    <p class="mt-8">
      <a
        class="text-destructive font-semibold underline underline-offset-4"
        href={data.withdrawHref}
      >
        {t('withdraw.link')}
      </a>
    </p>
  {/if}
</div>
