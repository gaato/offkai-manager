<script lang="ts">
  import { translator } from '$lib/i18n';
  import { Alert } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const badgeClass = $derived(
    data.statusTone === 'success'
      ? 'border-primary/40 bg-primary/10 text-foreground'
      : data.statusTone === 'warning'
        ? 'border-destructive/40 bg-destructive/10 text-foreground'
        : data.statusTone === 'info'
          ? 'border-primary/30 bg-muted text-foreground'
          : 'bg-muted text-foreground'
  );
</script>

<svelte:head>
  <title>{t('pledge.page_title')} · {data.campaignTitle} · {t('brand.name')}</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<article class="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
  {#if data.paymentNotice === 'success'}
    <Alert class="border-primary/40 bg-muted mb-7" role="status">
      {t('pledge.payment.success')}
    </Alert>
  {:else if data.paymentNotice === 'cancelled'}
    <Alert class="border-destructive/40 bg-muted mb-7" role="status">
      {t('pledge.payment.cancelled')}
    </Alert>
  {/if}

  <header>
    <p class="text-primary text-sm font-semibold">{t('pledge.kind')}</p>
    <h1 class="mt-2 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
      {t('pledge.heading')}
    </h1>
    <p class="text-muted-foreground mt-3">
      {t('pledge.organized_by', { organization: data.organizationName })}
    </p>
  </header>

  <Card class="mt-8 shadow-none">
    <CardHeader>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>{t('pledge.status')}</CardTitle>
        <Badge class={badgeClass}>{data.statusLabel}</Badge>
      </div>
      <p class="mt-3 leading-7">{data.statusDetail}</p>
    </CardHeader>
    <CardContent>
      {#if data.resumeUnavailable}
        <Alert class="bg-muted mb-6" role="note">{t('pledge.resume_unavailable')}</Alert>
      {/if}
      <dl class="grid gap-5 border-t pt-6 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <dt class="text-muted-foreground text-sm font-medium">{t('pledge.amount')}</dt>
          <dd class="mt-1 text-lg font-semibold tabular-nums">
            {t('pledge.amount_equation', {
              count: data.unitCount,
              unitPrice: data.unitPrice,
              total: data.total
            })}
          </dd>
        </div>
        {#if data.paidAt}
          <div>
            <dt class="text-muted-foreground text-sm font-medium">{t('pledge.paid_at')}</dt>
            <dd class="mt-1 font-semibold">{data.paidAt}</dd>
          </div>
        {/if}
        <div>
          <dt class="text-muted-foreground text-sm font-medium">{t('pledge.campaign')}</dt>
          <dd class="mt-1 font-semibold">
            <a class="underline underline-offset-4" href={data.campaignHref}>{data.campaignTitle}</a
            >
          </dd>
        </div>
      </dl>
    </CardContent>
  </Card>
  {#if data.abuseReportHref}
    <footer class="mt-10 border-t pt-5 text-sm">
      <a
        class="text-muted-foreground hover:text-foreground inline-flex min-h-10 items-center underline underline-offset-4"
        href={data.abuseReportHref}>{t('campaign.report_abuse')}</a
      >
    </footer>
  {/if}
</article>
