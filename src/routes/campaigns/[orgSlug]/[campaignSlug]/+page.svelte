<script lang="ts">
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import { Alert } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const pledgeForm = superForm(untrack(() => data.form));
  const { form, errors, message, enhance } = pledgeForm;
</script>

<svelte:head>
  <title>{data.title} · {t('brand.name')}</title>
  <meta name="description" content={data.meta.description} />
  <meta property="og:title" content={data.title} />
  <meta property="og:description" content={data.meta.description} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={data.meta.url} />
  <meta name="twitter:card" content="summary" />
</svelte:head>

<article class="mx-auto w-full max-w-5xl px-5 py-10 sm:py-14">
  <header class="max-w-3xl">
    <p class="text-primary text-sm font-semibold">{t('campaign.kind')}</p>
    <h1 class="mt-3 text-3xl leading-tight font-bold tracking-tight sm:text-5xl">{data.title}</h1>
    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <p class="text-muted-foreground">
        {t('campaign.organized_by', { organization: data.organizationName })}
      </p>
      {#if data.identityVerified}
        <span class="bg-muted inline-flex rounded-full px-3 py-1 text-xs font-semibold">
          {t('campaign.identity_verified')}
        </span>
      {/if}
    </div>
    {#if data.identityVerified}
      <p class="text-muted-foreground mt-2 max-w-2xl text-xs leading-5">
        {t('campaign.identity_verified_help')}
      </p>
    {/if}
  </header>

  {#if data.closed}
    <Alert class="border-primary/40 bg-muted mt-8" role="status">
      <p class="font-semibold">{t('campaign.closed_title')}</p>
      <p class="mt-1 text-sm">{t('campaign.closed_notice')}</p>
    </Alert>
  {/if}

  <section class="mt-8" aria-labelledby="campaign-progress-heading">
    <h2 id="campaign-progress-heading" class="sr-only">{t('campaign.progress_heading')}</h2>
    <dl class="grid gap-5 rounded-xl border p-5 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <dt class="text-muted-foreground text-sm font-medium">{t('campaign.raised')}</dt>
        <dd class="mt-1 text-2xl font-bold tabular-nums">{data.raised}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground text-sm font-medium">{t('campaign.goal_display')}</dt>
        <dd class="mt-1 text-xl font-semibold tabular-nums">{data.goal}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground text-sm font-medium">{t('campaign.unit_price')}</dt>
        <dd class="mt-1 text-xl font-semibold tabular-nums">{data.unitPrice}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground text-sm font-medium">{t('campaign.supporter_count')}</dt>
        <dd class="mt-1 text-xl font-semibold tabular-nums">
          {t('campaign.supporter_count_value', { count: data.supporterCount })}
        </dd>
      </div>
    </dl>
    {#if data.progress !== null}
      <div class="mt-5">
        <div class="mb-2 flex items-center justify-between gap-4 text-sm font-medium">
          <span>{t('campaign.progress_label', { raised: data.raised, goal: data.goal })}</span>
          <span class="tabular-nums">{data.progress}%</span>
        </div>
        <progress
          class="accent-primary h-3 w-full"
          value={data.progress}
          max="100"
          aria-label={t('campaign.progress_label', { raised: data.raised, goal: data.goal })}
        ></progress>
      </div>
    {/if}
    <p class="text-muted-foreground mt-3 text-sm">{t('campaign.goal_display_note')}</p>
  </section>

  <div class="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
    <div class="grid min-w-0 gap-12">
      {#if data.description}
        <section aria-labelledby="campaign-about-heading">
          <h2 id="campaign-about-heading" class="text-2xl font-semibold">
            {t('campaign.about')}
          </h2>
          <p class="mt-4 leading-8 whitespace-pre-line">{data.description}</p>
        </section>
      {/if}

      {#if data.completionReportText}
        <section
          class="border-primary/25 bg-muted/40 rounded-xl border p-6"
          aria-labelledby="campaign-completion-report-heading"
        >
          <p class="text-primary text-sm font-semibold">
            {t('campaign.completion_report_eyebrow')}
          </p>
          <h2 id="campaign-completion-report-heading" class="mt-2 text-2xl font-semibold">
            {t('campaign.completion_report_title')}
          </h2>
          {#if data.completionReportedAt}
            <p class="text-muted-foreground mt-2 text-sm">
              {t('campaign.completion_report_date', { date: data.completionReportedAt })}
            </p>
          {/if}
          <p class="mt-5 leading-8 whitespace-pre-line">{data.completionReportText}</p>
        </section>
      {/if}

      {#if data.fulfillmentDate || data.fulfillmentNote || data.contact}
        <section aria-labelledby="campaign-fulfillment-heading">
          <h2 id="campaign-fulfillment-heading" class="text-2xl font-semibold">
            {t('campaign.fulfillment')}
          </h2>
          <dl class="mt-5 grid gap-5 sm:grid-cols-2">
            {#if data.fulfillmentDate}
              <div>
                <dt class="text-muted-foreground text-sm font-medium">
                  {t('campaign.fulfillment_date')}
                </dt>
                <dd class="mt-1 font-semibold">{data.fulfillmentDate}</dd>
              </div>
            {/if}
            {#if data.contact}
              <div>
                <dt class="text-muted-foreground text-sm font-medium">{t('campaign.contact')}</dt>
                <dd class="mt-1 font-semibold break-words">
                  {#if data.contactHref}
                    <a class="underline underline-offset-4" href={data.contactHref}
                      >{data.contact}</a
                    >
                  {:else}
                    {data.contact}
                  {/if}
                </dd>
              </div>
            {/if}
          </dl>
          {#if data.fulfillmentNote}
            <p class="text-muted-foreground mt-5 leading-7 whitespace-pre-line">
              {data.fulfillmentNote}
            </p>
          {/if}
        </section>
      {/if}

      <section aria-labelledby="campaign-supporters-heading">
        <h2 id="campaign-supporters-heading" class="text-2xl font-semibold">
          {t('campaign.supporters')}
        </h2>
        {#if data.supporters.length === 0}
          <p class="text-muted-foreground mt-4">{t('campaign.no_supporters')}</p>
        {:else}
          <ul class="mt-5 grid list-none gap-3 sm:grid-cols-2" role="list">
            {#each data.supporters as supporter (supporter.displayName + supporter.unitCount)}
              <li class="bg-muted/60 rounded-lg px-4 py-3">
                <span class="font-semibold">{supporter.displayName}</span>
                <span class="text-muted-foreground ml-2 text-sm">
                  {t('campaign.supporter_units', { count: supporter.unitCount })}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if data.supporterOverflowCount > 0}
          <p class="text-muted-foreground mt-4 text-sm">
            {t('campaign.supporter_overflow', { count: data.supporterOverflowCount })}
          </p>
        {/if}
      </section>

      <details class="rounded-xl border px-5 py-4">
        <summary class="min-h-11 cursor-pointer py-2 font-semibold">
          {t('campaign.legal.title')}
        </summary>
        <dl class="mt-4 grid gap-5 text-sm leading-7">
          <div>
            <dt class="text-muted-foreground font-medium">{t('campaign.legal.seller')}</dt>
            <dd class="mt-1 font-semibold">{data.organizationName}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground font-medium">{t('campaign.legal.address_phone')}</dt>
            <dd class="mt-1">{t('campaign.legal.disclosure_statement')}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground font-medium">{t('campaign.legal.request_channel')}</dt>
            <dd class="mt-1">
              {#if data.contact}
                {#if data.contactHref}
                  <a class="font-medium underline underline-offset-4" href={data.contactHref}
                    >{data.contact}</a
                  >
                {:else}
                  {data.contact}
                {/if}
              {:else}
                {t('campaign.legal.request_channel_missing')}
              {/if}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground font-medium">{t('campaign.legal.returns')}</dt>
            <dd class="mt-1">{t('campaign.legal.returns_body')}</dd>
          </div>
        </dl>
      </details>
    </div>

    <aside class="lg:sticky lg:top-6" aria-labelledby="campaign-pledge-heading">
      {#if data.canPledge}
        <Card class="shadow-none">
          <CardHeader>
            <CardTitle id="campaign-pledge-heading">{t('campaign.pledge.heading')}</CardTitle>
            <p class="text-muted-foreground mt-2 text-sm leading-6">
              {t('campaign.pledge.lead')}
            </p>
          </CardHeader>
          <CardContent>
            {#if $message}
              <Alert class="border-destructive text-destructive mb-6" role="alert">
                {$message}
              </Alert>
            {/if}
            <form method="POST" action="?/pledge" use:enhance class="grid gap-6">
              <div class="grid gap-2">
                <Label for="campaign-supporter-name">{t('campaign.pledge.display_name')}</Label>
                <Input
                  id="campaign-supporter-name"
                  name="displayName"
                  bind:value={$form.displayName}
                  autocomplete="name"
                  required
                  maxlength={64}
                  aria-invalid={$errors.displayName ? 'true' : undefined}
                  aria-describedby={$errors.displayName
                    ? 'campaign-supporter-name-error'
                    : 'campaign-supporter-name-help'}
                />
                <p id="campaign-supporter-name-help" class="text-muted-foreground text-sm">
                  {t('campaign.pledge.display_name_help')}
                </p>
                {#if $errors.displayName}
                  <p
                    id="campaign-supporter-name-error"
                    class="text-destructive text-sm"
                    role="alert"
                  >
                    {$errors.displayName[0]}
                  </p>
                {/if}
              </div>

              <div class="grid gap-2">
                <Label for="campaign-unit-count">{t('campaign.pledge.unit_count')}</Label>
                <Input
                  id="campaign-unit-count"
                  name="unitCount"
                  type="number"
                  bind:value={$form.unitCount}
                  inputmode="numeric"
                  min={1}
                  max={data.maxUnitsPerPledge}
                  step={1}
                  required
                  aria-invalid={$errors.unitCount ? 'true' : undefined}
                  aria-describedby={$errors.unitCount
                    ? 'campaign-unit-count-error'
                    : 'campaign-unit-count-help'}
                />
                <p id="campaign-unit-count-help" class="text-muted-foreground text-sm">
                  {t('campaign.pledge.unit_count_help', { max: data.maxUnitsPerPledge })}
                </p>
                {#if $errors.unitCount}
                  <p id="campaign-unit-count-error" class="text-destructive text-sm" role="alert">
                    {$errors.unitCount[0]}
                  </p>
                {/if}
              </div>

              <label class="border-input flex min-h-12 items-start gap-3 rounded-lg border p-4">
                <input type="hidden" name="listPublicly" value="false" />
                <input
                  class="mt-1"
                  id="campaign-list-publicly"
                  name="listPublicly"
                  type="checkbox"
                  value="true"
                  bind:checked={$form.listPublicly}
                />
                <span>
                  <span class="font-semibold">{t('campaign.pledge.list_publicly')}</span>
                  <span class="text-muted-foreground mt-1 block text-sm">
                    {t('campaign.pledge.list_publicly_help')}
                  </span>
                </span>
              </label>

              <div class="bg-muted rounded-lg p-4 text-sm leading-6">
                <p class="font-semibold">{t('campaign.pledge.all_in_title')}</p>
                <p class="text-muted-foreground mt-1">{t('campaign.pledge.all_in_body')}</p>
              </div>
              <p class="text-muted-foreground text-sm leading-6">
                {t('campaign.pledge.consent_before')}
                <a class="font-medium underline underline-offset-4" href={resolve('/terms')}
                  >{t('campaign.pledge.terms')}</a
                >{t('campaign.pledge.consent_after')}
              </p>
              <Button type="submit" size="lg" class="w-full">
                {t('campaign.pledge.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>
      {:else}
        <Alert class="bg-muted" role="status">
          <h2 id="campaign-pledge-heading" class="font-semibold">
            {data.closed
              ? t('campaign.closed_title')
              : data.contactMissing
                ? t('campaign.contact_required_title')
                : t('campaign.checkout_unavailable_title')}
          </h2>
          <p class="mt-1 text-sm">
            {data.closed
              ? t('campaign.closed_form_notice')
              : data.contactMissing
                ? t('campaign.contact_required_notice')
                : t('campaign.checkout_unavailable')}
          </p>
        </Alert>
      {/if}
    </aside>
  </div>

  {#if data.abuseReportHref}
    <footer class="mt-14 border-t pt-6 text-sm">
      <a
        class="text-muted-foreground hover:text-foreground inline-flex min-h-10 items-center underline underline-offset-4"
        href={data.abuseReportHref}>{t('campaign.report_abuse')}</a
      >
    </footer>
  {/if}
</article>
