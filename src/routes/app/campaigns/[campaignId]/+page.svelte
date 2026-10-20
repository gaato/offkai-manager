<script lang="ts">
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import { Alert } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import CopyField from '$lib/components/copy-field.svelte';

  type ActionResult = { actionError?: string; actionMessage?: string } | null;

  let { data, form: rawActionResult } = $props();
  const t = $derived(translator(data.locale));
  const actionResult = $derived(rawActionResult as ActionResult);
  const settings = superForm(untrack(() => data.form));
  const { form, errors, message, enhance } = settings;
  const report = superForm(untrack(() => data.reportForm));
  const {
    form: reportForm,
    errors: reportErrors,
    message: reportMessage,
    enhance: enhanceReport
  } = report;
  const editable = $derived(data.canManageCampaign && !data.organizationSuspended);
  const slugFrozen = $derived(data.campaign.status !== 'draft');
  const campaignsHref = $derived(
    resolve('/app/organizations/[orgId]/campaigns', {
      orgId: data.campaign.organizationId
    })
  );
  const csvHref = $derived(
    resolve('/app/campaigns/[campaignId]/pledges.csv', {
      campaignId: data.campaign.id
    })
  );
</script>

<svelte:head>
  <title>{data.campaign.title} · {t('campaign_admin.workspace')} · {t('brand.name')}</title>
</svelte:head>

<div class="mx-auto grid max-w-5xl gap-7">
  <header class="border-b pb-5">
    <a
      class="text-muted-foreground hover:text-foreground inline-flex min-h-10 items-center text-sm font-semibold"
      href={campaignsHref}>{t('campaign_admin.back_to_list')}</a
    >
    <div class="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-muted-foreground text-sm font-semibold">{t('campaign_admin.workspace')}</p>
        <h1 class="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{data.campaign.title}</h1>
        <p class="text-muted-foreground mt-2 text-sm">
          {t('campaign_admin.organized_by', { organization: data.organizationName })}
        </p>
      </div>
      <Badge class="bg-secondary text-secondary-foreground self-start sm:self-auto">
        {data.statusLabel}
      </Badge>
    </div>
  </header>

  {#if data.organizationSuspended}
    <Alert class="border-amber-700 bg-amber-50 text-amber-950" role="status">
      {t('organization.suspended_read_only')}
    </Alert>
  {/if}
  {#if actionResult?.actionError}
    <Alert class="border-destructive text-destructive" role="alert">
      {actionResult.actionError}
    </Alert>
  {:else if actionResult?.actionMessage}
    <Alert class="border-primary/35 bg-secondary/50" role="status">
      {actionResult.actionMessage}
    </Alert>
  {/if}

  <section aria-labelledby="campaign-metrics-title">
    <h2 id="campaign-metrics-title" class="sr-only">{t('campaign_admin.metrics.title')}</h2>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {#each [{ label: t('campaign_admin.metric.raised'), value: data.metrics.raised }, { label: t('campaign_admin.metric.completed'), value: String(data.metrics.completed) }, { label: t('campaign_admin.metric.goal'), value: data.metrics.goal }, { label: t('campaign_admin.metric.unit_price'), value: data.metrics.unitPrice }] as metric (metric.label)}
        <Card class="shadow-none">
          <CardContent class="pt-6">
            <p class="text-muted-foreground text-sm font-semibold">{metric.label}</p>
            <p class="mt-2 text-2xl font-bold tabular-nums">{metric.value}</p>
          </CardContent>
        </Card>
      {/each}
    </div>
  </section>

  <Card class="shadow-none">
    <CardHeader>
      <CardTitle>{t('campaign_admin.share.title')}</CardTitle>
      <p class="text-muted-foreground mt-2 text-sm">{t('campaign_admin.share.intro')}</p>
    </CardHeader>
    <CardContent>
      <CopyField
        id="campaign-share-url"
        label={t('campaign_admin.share.label')}
        value={data.shareUrl}
        copyLabel={t('campaign_admin.share.copy')}
        copiedLabel={t('campaign_admin.share.copied')}
        rows={2}
      />
      <a
        class="text-primary mt-4 inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        href={data.publicPath}
        target="_blank"
        rel="noreferrer">{t('campaign_admin.share.open')}</a
      >
    </CardContent>
  </Card>

  {#if editable}
    <Card class="shadow-none">
      <CardHeader>
        <CardTitle>{t('campaign_admin.lifecycle.title')}</CardTitle>
        <p class="text-muted-foreground mt-2 text-sm">{t('campaign_admin.lifecycle.intro')}</p>
      </CardHeader>
      <CardContent>
        <div class="flex flex-wrap items-start gap-3">
          {#if data.campaign.status === 'draft'}
            <form method="POST" action="?/status">
              <input type="hidden" name="target" value="open" />
              <Button type="submit">{t('campaign_admin.action.open')}</Button>
            </form>
          {:else if data.campaign.status === 'open'}
            <form method="POST" action="?/status">
              <input type="hidden" name="target" value="closed" />
              <Button type="submit" variant="outline">{t('campaign_admin.action.close')}</Button>
            </form>
          {:else if data.campaign.status === 'closed'}
            <form method="POST" action="?/status">
              <input type="hidden" name="target" value="open" />
              <Button type="submit">{t('campaign_admin.action.reopen')}</Button>
            </form>
          {/if}

          {#if data.campaign.status === 'open' || data.campaign.status === 'closed'}
            <details class="rounded-md border px-4 py-2">
              <summary class="min-h-8 cursor-pointer py-1 font-semibold">
                {t('campaign_admin.action.archive')}
              </summary>
              <p class="text-muted-foreground mt-3 max-w-md text-sm">
                {t('campaign_admin.action.archive_help')}
              </p>
              <form method="POST" action="?/status" class="mt-4">
                <input type="hidden" name="target" value="archived" />
                <Button type="submit" variant="destructive">
                  {t('campaign_admin.action.archive_confirm')}
                </Button>
              </form>
            </details>
          {/if}
        </div>
        {#if data.campaign.status === 'draft' && !data.campaign.contact}
          <p class="text-destructive mt-4 text-sm">
            {t('campaign_admin.lifecycle.contact_needed')}
          </p>
        {/if}
      </CardContent>
    </Card>
  {/if}

  {#if data.campaign.status === 'closed' || data.campaign.status === 'archived'}
    <Card class="shadow-none">
      <CardHeader>
        <CardTitle>{t('campaign_admin.report.title')}</CardTitle>
        <p class="text-muted-foreground mt-2 max-w-3xl text-sm leading-6">
          {t('campaign_admin.report.intro')}
        </p>
      </CardHeader>
      <CardContent>
        {#if $reportMessage}
          <Alert
            class={$reportMessage === t('campaign_admin.report.success')
              ? 'border-primary/35 bg-secondary/50 mb-6'
              : 'border-destructive text-destructive mb-6'}
            role={$reportMessage === t('campaign_admin.report.success') ? 'status' : 'alert'}
          >
            {$reportMessage}
          </Alert>
        {/if}
        <form method="POST" action="?/report" use:enhanceReport class="grid gap-3">
          <Label for="campaign-completion-report">{t('campaign_admin.report.field')}</Label>
          <textarea
            id="campaign-completion-report"
            name="text"
            bind:value={$reportForm.text}
            rows={10}
            minlength={1}
            maxlength={20000}
            required
            disabled={!editable}
            aria-invalid={$reportErrors.text ? 'true' : undefined}
            aria-describedby={$reportErrors.text
              ? 'campaign-completion-report-error'
              : 'campaign-completion-report-help'}
            class="border-input bg-background min-h-56 w-full resize-y rounded-md border px-3 py-2 text-base leading-7"
          ></textarea>
          <p id="campaign-completion-report-help" class="text-muted-foreground text-sm">
            {t('campaign_admin.report.help')}
          </p>
          {#if $reportErrors.text}
            <p id="campaign-completion-report-error" class="text-destructive text-sm" role="alert">
              {$reportErrors.text[0]}
            </p>
          {/if}
          {#if editable}
            <Button type="submit" class="mt-2 justify-self-start">
              {data.campaign.completionReportText
                ? t('campaign_admin.report.republish')
                : t('campaign_admin.report.publish')}
            </Button>
          {/if}
        </form>
      </CardContent>
    </Card>
  {/if}

  <Card class="shadow-none">
    <CardHeader>
      <CardTitle>{t('campaign_admin.settings.title')}</CardTitle>
      <p class="text-muted-foreground mt-2 text-sm">{t('campaign_admin.settings.intro')}</p>
    </CardHeader>
    <CardContent>
      {#if $message}
        <Alert
          class={$message === t('campaign_admin.settings.success')
            ? 'border-primary/35 bg-secondary/50 mb-6'
            : 'border-destructive text-destructive mb-6'}
          role={$message === t('campaign_admin.settings.success') ? 'status' : 'alert'}
          >{$message}</Alert
        >
      {/if}
      <form method="POST" action="?/settings" use:enhance class="grid gap-6">
        <div class="grid gap-2">
          <Label for="settings-title">{t('campaign_admin.field.title')}</Label>
          <Input
            id="settings-title"
            name="title"
            bind:value={$form.title}
            required
            maxlength={200}
            disabled={!editable}
          />
          {#if $errors.title}<p class="text-destructive text-sm" role="alert">
              {$errors.title[0]}
            </p>{/if}
        </div>
        <div class="grid gap-2">
          <Label for="settings-slug">{t('campaign_admin.field.slug')}</Label>
          {#if slugFrozen || !editable}
            <input type="hidden" name="slug" value={$form.slug} />
          {/if}
          <Input
            id="settings-slug"
            name="slug"
            bind:value={$form.slug}
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            disabled={slugFrozen || !editable}
          />
          <p class="text-muted-foreground text-sm">
            {slugFrozen
              ? t('campaign_admin.freeze.slug_frozen')
              : t('campaign_admin.field.slug_help')}
          </p>
        </div>
        <div class="grid gap-2">
          <Label for="settings-description">{t('campaign_admin.field.description')}</Label>
          <textarea
            id="settings-description"
            name="description"
            bind:value={$form.description}
            rows={5}
            maxlength={10000}
            disabled={!editable}
            class="border-input bg-background min-h-28 w-full resize-y rounded-md border px-3 py-2 text-base"
          ></textarea>
        </div>
        <div class="grid gap-5 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="settings-price">{t('campaign_admin.field.unit_price_minor')}</Label>
            {#if data.priceFrozen || !editable}
              <input type="hidden" name="unitPriceMinor" value={$form.unitPriceMinor} />
            {/if}
            <Input
              id="settings-price"
              name="unitPriceMinor"
              bind:value={$form.unitPriceMinor}
              inputmode="numeric"
              pattern="[1-9][0-9]*"
              required
              disabled={data.priceFrozen || !editable}
            />
            <p class="text-muted-foreground text-sm">
              {data.priceFrozen
                ? t('campaign_admin.freeze.price_frozen')
                : t('campaign_admin.freeze.price_rule')}
            </p>
          </div>
          <div class="grid gap-2">
            <Label for="settings-currency">{t('campaign_admin.field.currency')}</Label>
            {#if data.currencyFrozen || !editable}
              <input type="hidden" name="currency" value={$form.currency} />
            {/if}
            <Input
              id="settings-currency"
              name="currency"
              bind:value={$form.currency}
              pattern={'[A-Za-z]{3}'}
              maxlength={3}
              required
              disabled={data.currencyFrozen || !editable}
            />
            <p class="text-muted-foreground text-sm">
              {data.currencyFrozen
                ? t('campaign_admin.freeze.currency_frozen')
                : t('campaign_admin.freeze.currency_rule')}
            </p>
          </div>
        </div>
        <div class="grid gap-5 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="settings-goal">{t('campaign_admin.field.goal_minor')}</Label>
            <Input
              id="settings-goal"
              name="goalMinor"
              bind:value={$form.goalMinor}
              inputmode="numeric"
              pattern="[0-9]+"
              required
              disabled={!editable}
            />
          </div>
          <div class="grid gap-2">
            <Label for="settings-max-units">{t('campaign_admin.field.max_units')}</Label>
            <Input
              id="settings-max-units"
              name="maxUnitsPerPledge"
              type="number"
              min={1}
              max={100}
              step={1}
              bind:value={$form.maxUnitsPerPledge}
              required
              disabled={!editable}
            />
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="settings-fulfillment-date">
            {t('campaign_admin.field.fulfillment_date')}
          </Label>
          <Input
            id="settings-fulfillment-date"
            name="fulfillmentDate"
            type="date"
            bind:value={$form.fulfillmentDate}
            disabled={!editable}
          />
        </div>
        <div class="grid gap-2">
          <Label for="settings-fulfillment-note">
            {t('campaign_admin.field.fulfillment_note')}
          </Label>
          <textarea
            id="settings-fulfillment-note"
            name="fulfillmentNote"
            bind:value={$form.fulfillmentNote}
            rows={3}
            maxlength={5000}
            disabled={!editable}
            class="border-input bg-background min-h-24 w-full resize-y rounded-md border px-3 py-2 text-base"
          ></textarea>
        </div>
        <div class="grid gap-2">
          <Label for="settings-contact">{t('campaign_admin.field.contact')}</Label>
          <Input
            id="settings-contact"
            name="contact"
            bind:value={$form.contact}
            maxlength={500}
            disabled={!editable}
          />
          <p class="text-muted-foreground text-sm">{t('campaign_admin.field.contact_help')}</p>
        </div>
        {#if editable}
          <Button type="submit" class="justify-self-start">{t('form.save')}</Button>
        {/if}
      </form>
    </CardContent>
  </Card>

  {#if data.canViewCampaignLedger}
    <Card class="shadow-none">
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>{t('campaign_admin.ledger.title')}</CardTitle>
            <p class="text-muted-foreground mt-2 text-sm">{t('campaign_admin.ledger.intro')}</p>
          </div>
          <a
            class="hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 font-semibold"
            href={csvHref}>{t('campaign_admin.csv.download')}</a
          >
        </div>
      </CardHeader>
      <CardContent>
        {#if data.pledges.length === 0}
          <p class="text-muted-foreground">{t('campaign_admin.ledger.empty')}</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full min-w-[60rem] text-left text-sm">
              <thead>
                <tr class="border-b">
                  <th class="px-3 py-3 font-semibold">{t('campaign_admin.field.display_name')}</th>
                  <th class="px-3 py-3 text-right font-semibold"
                    >{t('campaign_admin.field.units')}</th
                  >
                  <th class="px-3 py-3 text-right font-semibold"
                    >{t('campaign_admin.field.amount')}</th
                  >
                  <th class="px-3 py-3 font-semibold">{t('campaign_admin.field.status')}</th>
                  <th class="px-3 py-3 font-semibold">{t('campaign_admin.field.paid_at')}</th>
                  <th class="px-3 py-3 font-semibold">{t('campaign_admin.field.account')}</th>
                  <th class="px-3 py-3 font-semibold">{t('campaign_admin.field.listing')}</th>
                </tr>
              </thead>
              <tbody>
                {#each data.pledges as pledge (pledge.id)}
                  <tr class="border-b align-top last:border-b-0">
                    <td class="px-3 py-4 font-semibold">
                      {pledge.displayName}
                      {#if pledge.conflict}
                        <Badge class="bg-destructive mt-2 block w-fit text-white">
                          {t('campaign_admin.conflict.badge')}
                        </Badge>
                        <p class="text-destructive mt-1 text-xs">
                          {t('campaign_admin.conflict.help')}
                        </p>
                      {/if}
                    </td>
                    <td class="px-3 py-4 text-right tabular-nums">{pledge.unitCount}</td>
                    <td class="px-3 py-4 text-right tabular-nums">{pledge.amount}</td>
                    <td class="px-3 py-4">{pledge.statusLabel}</td>
                    <td class="text-muted-foreground px-3 py-4">{pledge.paidAt}</td>
                    <td class="px-3 py-4">{pledge.accountLabel}</td>
                    <td class="px-3 py-4">{pledge.listingLabel}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
