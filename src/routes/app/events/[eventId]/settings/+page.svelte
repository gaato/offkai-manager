<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import {
    discordPolicies,
    discordPolicyLabelKey,
    registrationModeLabelKey,
    registrationModes,
    venueRevealLabelKey,
    venueReveals
  } from '$lib/shared/event';
  import { Alert } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const settings = superForm(untrack(() => data.form));
  const { form, errors, message, enhance } = settings;
  const discordSettings = superForm(untrack(() => data.discordForm));
  const {
    form: discordForm,
    errors: discordErrors,
    message: discordMessage,
    enhance: enhanceDiscord
  } = discordSettings;
  const editable = $derived(data.capabilities.canManageEvent && !data.event.archivedAt);
</script>

<svelte:head
  ><title>{t('event.settings_title')} · {data.event.title} · {t('brand.name')}</title></svelte:head
>

<div class="grid gap-6">
  <Card class="shadow-none">
    <CardHeader>
      <CardTitle>{t('event.settings_title')}</CardTitle>
      <p class="text-muted-foreground mt-2 text-sm">
        {t('event.settings_intro', { zone: data.timeZone })}
      </p>
    </CardHeader>
    <CardContent>
      {#if $message}
        <Alert
          class={$message === t('event.settings_success')
            ? 'border-primary/35 bg-secondary/50 mb-6'
            : 'border-destructive text-destructive mb-6'}
          role={$message === t('event.settings_success') ? 'status' : 'alert'}>{$message}</Alert
        >
      {/if}
      <form method="POST" action="?/settings" use:enhance class="grid gap-6">
        <div class="grid gap-2">
          <Label for="title">{t('event.title')}</Label>
          <Input
            id="title"
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
          <Label for="description">{t('event.description')}</Label>
          <textarea
            id="description"
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
            <Label for="startsAt">{t('event.starts_at')}</Label>
            <Input
              id="startsAt"
              name="startsAt"
              type="datetime-local"
              bind:value={$form.startsAt}
              required
              disabled={!editable}
            />
            {#if $errors.startsAt}<p class="text-destructive text-sm" role="alert">
                {$errors.startsAt[0]}
              </p>{/if}
          </div>
          <div class="grid gap-2">
            <Label for="endsAt">{t('event.ends_at')}</Label>
            <Input
              id="endsAt"
              name="endsAt"
              type="datetime-local"
              bind:value={$form.endsAt}
              required
              disabled={!editable}
            />
            {#if $errors.endsAt}<p class="text-destructive text-sm" role="alert">
                {$errors.endsAt[0]}
              </p>{/if}
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="capacity">{t('event.capacity')}</Label>
          <Input
            id="capacity"
            name="capacity"
            type="number"
            min={1}
            step={1}
            bind:value={$form.capacity}
            disabled={!editable}
          />
          <p class="text-muted-foreground text-sm">{t('event.capacity_help')}</p>
          {#if $errors.capacity}<p class="text-destructive text-sm" role="alert">
              {$errors.capacity[0]}
            </p>{/if}
        </div>
        <div class="grid gap-5 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="registrationOpensAt">{t('event.registration_opens_at')}</Label>
            <Input
              id="registrationOpensAt"
              name="registrationOpensAt"
              type="datetime-local"
              bind:value={$form.registrationOpensAt}
              required
              disabled={!editable}
            />
          </div>
          <div class="grid gap-2">
            <Label for="registrationClosesAt">{t('event.registration_closes_at')}</Label>
            <Input
              id="registrationClosesAt"
              name="registrationClosesAt"
              type="datetime-local"
              bind:value={$form.registrationClosesAt}
              required
              disabled={!editable}
            />
          </div>
        </div>
        <div class="grid gap-5 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="venueName">{t('event.venue_name')}</Label>
            <Input
              id="venueName"
              name="venueName"
              bind:value={$form.venueName}
              maxlength={300}
              disabled={!editable}
            />
          </div>
          <div class="grid gap-2">
            <Label for="venueAddress">{t('event.venue_address')}</Label>
            <Input
              id="venueAddress"
              name="venueAddress"
              bind:value={$form.venueAddress}
              maxlength={500}
              autocomplete="street-address"
              disabled={!editable}
            />
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="venueReveal">{t('event.venue_reveal')}</Label>
          <select
            id="venueReveal"
            name="venueReveal"
            bind:value={$form.venueReveal}
            disabled={!editable}
            class="border-input bg-background min-h-12 rounded-md border px-3 text-base"
          >
            {#each venueReveals as reveal (reveal)}
              <option value={reveal}>{t(venueRevealLabelKey(reveal))}</option>
            {/each}
          </select>
        </div>
        <div class="grid gap-2">
          <Label for="contact">{t('event.contact')}</Label>
          <Input
            id="contact"
            name="contact"
            bind:value={$form.contact}
            maxlength={500}
            disabled={!editable}
          />
        </div>
        <div class="grid gap-2">
          <Label for="cancellationPolicy">{t('event.cancellation_policy')}</Label>
          <textarea
            id="cancellationPolicy"
            name="cancellationPolicy"
            bind:value={$form.cancellationPolicy}
            rows={4}
            maxlength={5000}
            disabled={!editable}
            class="border-input bg-background min-h-24 w-full resize-y rounded-md border px-3 py-2 text-base"
          ></textarea>
        </div>
        <fieldset class="grid gap-3" disabled={!editable}>
          <legend class="font-medium">{t('event.registration_mode_label')}</legend>
          <p class="text-muted-foreground text-sm">{t('event.registration_mode_help')}</p>
          {#each registrationModes as mode (mode)}
            <label class="border-input flex min-h-12 items-center gap-3 rounded-md border px-4">
              <input
                type="radio"
                name="registrationMode"
                value={mode}
                bind:group={$form.registrationMode}
              />
              <span>{t(registrationModeLabelKey(mode))}</span>
            </label>
          {/each}
        </fieldset>
        {#if editable}<Button type="submit" class="justify-self-start">{t('form.save')}</Button
          >{/if}
      </form>
    </CardContent>
  </Card>

  <Card class="shadow-none">
    <CardHeader>
      <CardTitle>{t('discord_settings.title')}</CardTitle>
      <p class="text-muted-foreground mt-2 text-sm">{t('discord_settings.intro')}</p>
    </CardHeader>
    <CardContent>
      {#if $discordMessage}
        <Alert
          class={$discordMessage === t('discord_settings.success')
            ? 'border-primary/35 bg-secondary/50 mb-6'
            : 'border-destructive text-destructive mb-6'}
          role={$discordMessage === t('discord_settings.success') ? 'status' : 'alert'}
          >{$discordMessage}</Alert
        >
      {/if}
      {#if !data.discordBotEnabled}
        <Alert class="mb-6">{t('discord_settings.bot_disabled')}</Alert>
      {/if}
      <form method="POST" action="?/discord" use:enhanceDiscord class="grid gap-6">
        <fieldset class="grid gap-3" disabled={!editable}>
          <legend class="font-medium">{t('event.discord_policy')}</legend>
          <p class="text-muted-foreground text-sm">{t('event.discord_policy_help')}</p>
          {#each discordPolicies as policy (policy)}
            <label class="border-input flex min-h-12 items-center gap-3 rounded-md border px-4">
              <input type="radio" name="policy" value={policy} bind:group={$discordForm.policy} />
              <span>{t(discordPolicyLabelKey(policy))}</span>
            </label>
          {/each}
        </fieldset>
        <div class="grid gap-2">
          <Label for="discordGuildId">{t('discord_settings.guild_id')}</Label>
          <Input
            id="discordGuildId"
            name="guildId"
            bind:value={$discordForm.guildId}
            inputmode="numeric"
            pattern={'[0-9]{17,20}'}
            maxlength={20}
            disabled={!editable}
            aria-describedby="discord-guild-help"
          />
          <p id="discord-guild-help" class="text-muted-foreground text-sm">
            {t('discord_settings.guild_id_help')}
          </p>
          {#if $discordErrors.guildId}<p class="text-destructive text-sm" role="alert">
              {$discordErrors.guildId[0]}
            </p>{/if}
        </div>
        <div class="grid gap-2">
          <p class="font-medium">{t('discord_settings.guild_name')}</p>
          <p class="text-muted-foreground">
            {data.guildNameSnapshot || t('discord_settings.guild_name_unverified')}
          </p>
        </div>
        <div class="grid gap-2">
          <Label for="discordInviteUrl">{t('discord_settings.invite_url')}</Label>
          <Input
            id="discordInviteUrl"
            name="inviteUrl"
            type="url"
            bind:value={$discordForm.inviteUrl}
            maxlength={500}
            disabled={!editable}
          />
          {#if $discordErrors.inviteUrl}<p class="text-destructive text-sm" role="alert">
              {$discordErrors.inviteUrl[0]}
            </p>{/if}
        </div>
        <div class="grid gap-2">
          <Label for="discordRoleId">{t('discord_settings.role_id')}</Label>
          <Input
            id="discordRoleId"
            name="roleId"
            bind:value={$discordForm.roleId}
            inputmode="numeric"
            pattern={'[0-9]{17,20}'}
            maxlength={20}
            disabled={!editable}
            aria-describedby="discord-role-help"
          />
          <p id="discord-role-help" class="text-muted-foreground text-sm">
            {t('discord_settings.role_id_help')}
          </p>
          {#if $discordErrors.roleId}<p class="text-destructive text-sm" role="alert">
              {$discordErrors.roleId[0]}
            </p>{/if}
        </div>
        {#if editable}
          <Button type="submit" class="justify-self-start">{t('discord_settings.save')}</Button>
        {/if}
      </form>
    </CardContent>
  </Card>
</div>
