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
  const campaignForm = superForm(untrack(() => data.form));
  const { form, errors, message, enhance } = campaignForm;
</script>

<svelte:head>
  <title>{t('campaign_admin.list.title')} · {data.organization.name} · {t('brand.name')}</title>
</svelte:head>

<div class="grid gap-7">
  <section aria-labelledby="campaign-list-title">
    <div>
      <h2 id="campaign-list-title" class="text-xl font-bold">
        {t('campaign_admin.list.title')}
      </h2>
      <p class="text-muted-foreground mt-2 max-w-2xl">{t('campaign_admin.list.intro')}</p>
    </div>

    <Card class="mt-6 shadow-none">
      <CardContent class="pt-6">
        {#if data.campaigns.length === 0}
          <p class="text-muted-foreground">{t('campaign_admin.list.empty')}</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full min-w-[48rem] text-left text-sm">
              <thead>
                <tr class="border-b">
                  <th class="px-3 py-3 font-semibold">{t('campaign_admin.field.title')}</th>
                  <th class="px-3 py-3 font-semibold">{t('campaign_admin.field.status')}</th>
                  <th class="px-3 py-3 text-right font-semibold">
                    {t('campaign_admin.metric.unit_price')}
                  </th>
                  <th class="px-3 py-3 text-right font-semibold">
                    {t('campaign_admin.metric.raised')}
                  </th>
                  <th class="px-3 py-3 text-right font-semibold">
                    {t('campaign_admin.metric.completed')}
                  </th>
                  <th class="px-3 py-3 font-semibold">{t('campaign_admin.created_at')}</th>
                </tr>
              </thead>
              <tbody>
                {#each data.campaigns as campaign (campaign.id)}
                  <tr class="border-b last:border-b-0">
                    <td class="px-3 py-4 font-semibold">
                      <a
                        class="hover:text-primary"
                        href={resolve('/app/campaigns/[campaignId]', {
                          campaignId: campaign.id
                        })}>{campaign.title}</a
                      >
                    </td>
                    <td class="px-3 py-4">{campaign.statusLabel}</td>
                    <td class="px-3 py-4 text-right tabular-nums">{campaign.unitPrice}</td>
                    <td class="px-3 py-4 text-right tabular-nums">{campaign.raised}</td>
                    <td class="px-3 py-4 text-right tabular-nums">{campaign.paidOrderCount}</td>
                    <td class="text-muted-foreground px-3 py-4">{campaign.createdAt}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </CardContent>
    </Card>
  </section>

  {#if data.canManageCampaign}
    <Card class="shadow-none">
      <CardHeader>
        <CardTitle>{t('campaign_admin.create.title')}</CardTitle>
        <p class="text-muted-foreground mt-2 text-sm">{t('campaign_admin.create.intro')}</p>
      </CardHeader>
      <CardContent>
        {#if $message}
          <Alert class="border-destructive text-destructive mb-6" role="alert">{$message}</Alert>
        {/if}
        <form method="POST" action="?/create" use:enhance class="grid gap-6">
          <div class="grid gap-2">
            <Label for="campaign-title">{t('campaign_admin.field.title')}</Label>
            <Input
              id="campaign-title"
              name="title"
              bind:value={$form.title}
              required
              maxlength={200}
            />
            {#if $errors.title}<p class="text-destructive text-sm" role="alert">
                {$errors.title[0]}
              </p>{/if}
          </div>
          <div class="grid gap-2">
            <Label for="campaign-slug">{t('campaign_admin.field.slug')}</Label>
            <Input
              id="campaign-slug"
              name="slug"
              bind:value={$form.slug}
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              aria-describedby="campaign-slug-help"
            />
            <p id="campaign-slug-help" class="text-muted-foreground text-sm">
              {t('campaign_admin.field.slug_help')}
            </p>
            {#if $errors.slug}<p class="text-destructive text-sm" role="alert">
                {$errors.slug[0]}
              </p>{/if}
          </div>
          <div class="grid gap-2">
            <Label for="campaign-description">{t('campaign_admin.field.description')}</Label>
            <textarea
              id="campaign-description"
              name="description"
              bind:value={$form.description}
              rows={5}
              maxlength={10000}
              class="border-input bg-background min-h-28 w-full resize-y rounded-md border px-3 py-2 text-base"
            ></textarea>
          </div>
          <div class="grid gap-5 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="campaign-price">{t('campaign_admin.field.unit_price_minor')}</Label>
              <Input
                id="campaign-price"
                name="unitPriceMinor"
                bind:value={$form.unitPriceMinor}
                inputmode="numeric"
                pattern="[1-9][0-9]*"
                required
              />
              {#if $errors.unitPriceMinor}<p class="text-destructive text-sm" role="alert">
                  {$errors.unitPriceMinor[0]}
                </p>{/if}
            </div>
            <div class="grid gap-2">
              <Label for="campaign-currency">{t('campaign_admin.field.currency')}</Label>
              <Input
                id="campaign-currency"
                name="currency"
                bind:value={$form.currency}
                pattern={'[A-Za-z]{3}'}
                maxlength={3}
                required
              />
            </div>
          </div>
          <div class="grid gap-5 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="campaign-goal">{t('campaign_admin.field.goal_minor')}</Label>
              <Input
                id="campaign-goal"
                name="goalMinor"
                bind:value={$form.goalMinor}
                inputmode="numeric"
                pattern="[0-9]+"
                required
              />
            </div>
            <div class="grid gap-2">
              <Label for="campaign-max-units">{t('campaign_admin.field.max_units')}</Label>
              <Input
                id="campaign-max-units"
                name="maxUnitsPerPledge"
                type="number"
                min={1}
                max={100}
                step={1}
                bind:value={$form.maxUnitsPerPledge}
                required
              />
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="campaign-fulfillment-date">
              {t('campaign_admin.field.fulfillment_date')}
            </Label>
            <Input
              id="campaign-fulfillment-date"
              name="fulfillmentDate"
              type="date"
              bind:value={$form.fulfillmentDate}
            />
          </div>
          <div class="grid gap-2">
            <Label for="campaign-fulfillment-note">
              {t('campaign_admin.field.fulfillment_note')}
            </Label>
            <textarea
              id="campaign-fulfillment-note"
              name="fulfillmentNote"
              bind:value={$form.fulfillmentNote}
              rows={3}
              maxlength={5000}
              class="border-input bg-background min-h-24 w-full resize-y rounded-md border px-3 py-2 text-base"
            ></textarea>
          </div>
          <div class="grid gap-2">
            <Label for="campaign-contact">{t('campaign_admin.field.contact')}</Label>
            <Input
              id="campaign-contact"
              name="contact"
              bind:value={$form.contact}
              maxlength={500}
              aria-describedby="campaign-contact-help"
            />
            <p id="campaign-contact-help" class="text-muted-foreground text-sm">
              {t('campaign_admin.field.contact_help')}
            </p>
          </div>
          <Button type="submit" class="justify-self-start"
            >{t('campaign_admin.create.submit')}</Button
          >
        </form>
      </CardContent>
    </Card>
  {/if}
</div>
