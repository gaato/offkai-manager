<script lang="ts">
  import SettingsPage from '$lib/components/page/settings-page.svelte';
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

<SettingsPage>
  {#snippet title()}{t('event.settings_title')}{/snippet}
  {#snippet body()}
    <div class="grid gap-6">
      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <p class="mt-2">
            {t('event.settings_intro', { zone: data.timeZone })}
          </p>
        </div>
        <div class="card-body">
          {#if $message}
            <div
              role={$message === t('event.settings_success') ? 'status' : 'alert'}
              class={($message === t('event.settings_success') ? 'status' : 'alert') === 'status'
                ? 'alert alert-success'
                : 'alert alert-error'}
            >
              {$message}
            </div>
          {/if}
          <form method="POST" action="?/settings" use:enhance class="grid gap-6">
            <div class="grid gap-2">
              <label for="title" class="label">{t('event.title')}</label>
              <input
                id="title"
                name="title"
                bind:value={$form.title}
                required
                maxlength={200}
                disabled={!editable}
                class="input w-full"
              />
              {#if $errors.title}<p role="alert">
                  {$errors.title[0]}
                </p>{/if}
            </div>
            <div class="grid gap-2">
              <label for="description" class="label">{t('event.description')}</label>
              <textarea
                id="description"
                name="description"
                bind:value={$form.description}
                rows={5}
                maxlength={10000}
                disabled={!editable}
                class="textarea bg-base-100 min-h-28 w-full px-3 py-2"
              ></textarea>
            </div>
            <div class="grid gap-5 sm:grid-cols-2">
              <div class="grid gap-2">
                <label for="startsAt" class="label">{t('event.starts_at')}</label>
                <input
                  id="startsAt"
                  name="startsAt"
                  type="datetime-local"
                  bind:value={$form.startsAt}
                  required
                  disabled={!editable}
                  class="input w-full"
                />
                {#if $errors.startsAt}<p role="alert">
                    {$errors.startsAt[0]}
                  </p>{/if}
              </div>
              <div class="grid gap-2">
                <label for="endsAt" class="label">{t('event.ends_at')}</label>
                <input
                  id="endsAt"
                  name="endsAt"
                  type="datetime-local"
                  bind:value={$form.endsAt}
                  required
                  disabled={!editable}
                  class="input w-full"
                />
                {#if $errors.endsAt}<p role="alert">
                    {$errors.endsAt[0]}
                  </p>{/if}
              </div>
            </div>
            <div class="grid gap-2">
              <label for="capacity" class="label">{t('event.capacity')}</label>
              <input
                id="capacity"
                name="capacity"
                type="number"
                min={1}
                step={1}
                bind:value={$form.capacity}
                disabled={!editable}
                class="input w-full"
              />
              <p>{t('event.capacity_help')}</p>
              {#if $errors.capacity}<p role="alert">
                  {$errors.capacity[0]}
                </p>{/if}
            </div>
            <div class="grid gap-5 sm:grid-cols-2">
              <div class="grid gap-2">
                <label for="registrationOpensAt" class="label"
                  >{t('event.registration_opens_at')}</label
                >
                <input
                  id="registrationOpensAt"
                  name="registrationOpensAt"
                  type="datetime-local"
                  bind:value={$form.registrationOpensAt}
                  required
                  disabled={!editable}
                  class="input w-full"
                />
              </div>
              <div class="grid gap-2">
                <label for="registrationClosesAt" class="label"
                  >{t('event.registration_closes_at')}</label
                >
                <input
                  id="registrationClosesAt"
                  name="registrationClosesAt"
                  type="datetime-local"
                  bind:value={$form.registrationClosesAt}
                  required
                  disabled={!editable}
                  class="input w-full"
                />
              </div>
            </div>
            <div class="grid gap-5 sm:grid-cols-2">
              <div class="grid gap-2">
                <label for="venueName" class="label">{t('event.venue_name')}</label>
                <input
                  id="venueName"
                  name="venueName"
                  bind:value={$form.venueName}
                  maxlength={300}
                  disabled={!editable}
                  class="input w-full"
                />
              </div>
              <div class="grid gap-2">
                <label for="venueAddress" class="label">{t('event.venue_address')}</label>
                <input
                  id="venueAddress"
                  name="venueAddress"
                  bind:value={$form.venueAddress}
                  maxlength={500}
                  autocomplete="street-address"
                  disabled={!editable}
                  class="input w-full"
                />
              </div>
            </div>
            <div class="grid gap-2">
              <label for="venueReveal" class="label">{t('event.venue_reveal')}</label>
              <select
                id="venueReveal"
                name="venueReveal"
                bind:value={$form.venueReveal}
                disabled={!editable}
                class="select bg-base-100 min-h-12 w-full px-3"
              >
                {#each venueReveals as reveal (reveal)}
                  <option value={reveal}>{t(venueRevealLabelKey(reveal))}</option>
                {/each}
              </select>
            </div>
            <div class="grid gap-2">
              <label for="contact" class="label">{t('event.contact')}</label>
              <input
                id="contact"
                name="contact"
                bind:value={$form.contact}
                maxlength={500}
                disabled={!editable}
                class="input w-full"
              />
            </div>
            <div class="grid gap-2">
              <label for="cancellationPolicy" class="label">{t('event.cancellation_policy')}</label>
              <textarea
                id="cancellationPolicy"
                name="cancellationPolicy"
                bind:value={$form.cancellationPolicy}
                rows={4}
                maxlength={5000}
                disabled={!editable}
                class="textarea bg-base-100 min-h-24 w-full px-3 py-2"
              ></textarea>
            </div>
            <fieldset disabled={!editable} class="fieldset grid gap-3">
              <legend class="fieldset-legend">{t('event.registration_mode_label')}</legend>
              <p>{t('event.registration_mode_help')}</p>
              {#each registrationModes as mode (mode)}
                <label
                  for={`field-registrationMode-${mode}`}
                  class="label flex min-h-12 items-center gap-3 px-4"
                >
                  <input
                    id={`field-registrationMode-${mode}`}
                    type="radio"
                    name="registrationMode"
                    value={mode}
                    bind:group={$form.registrationMode}
                    class="radio"
                  />
                  <span>{t(registrationModeLabelKey(mode))}</span>
                </label>
              {/each}
            </fieldset>
            {#if editable}<button type="submit" class="btn btn-primary justify-self-start"
                >{t('form.save')}</button
              >{/if}
          </form>
        </div>
      </div>

      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <h2 class="card-title">{t('discord_settings.title')}</h2>
          <p class="mt-2">{t('discord_settings.intro')}</p>
        </div>
        <div class="card-body">
          {#if $discordMessage}
            <div
              role={$discordMessage === t('discord_settings.success') ? 'status' : 'alert'}
              class={($discordMessage === t('discord_settings.success') ? 'status' : 'alert') ===
              'status'
                ? 'alert alert-success'
                : 'alert alert-error'}
            >
              {$discordMessage}
            </div>
          {/if}
          {#if !data.discordBotEnabled}
            <div class="alert alert-info mb-6">{t('discord_settings.bot_disabled')}</div>
          {/if}
          <form method="POST" action="?/discord" use:enhanceDiscord class="grid gap-6">
            <fieldset disabled={!editable} class="fieldset grid gap-3">
              <legend class="fieldset-legend">{t('event.discord_policy')}</legend>
              <p>{t('event.discord_policy_help')}</p>
              {#each discordPolicies as policy (policy)}
                <label
                  for={`field-policy-${policy}`}
                  class="label flex min-h-12 items-center gap-3 px-4"
                >
                  <input
                    id={`field-policy-${policy}`}
                    type="radio"
                    name="policy"
                    value={policy}
                    bind:group={$discordForm.policy}
                    class="radio"
                  />
                  <span>{t(discordPolicyLabelKey(policy))}</span>
                </label>
              {/each}
            </fieldset>
            <div class="grid gap-2">
              <label for="discordGuildId" class="label">{t('discord_settings.guild_id')}</label>
              <input
                id="discordGuildId"
                name="guildId"
                bind:value={$discordForm.guildId}
                inputmode="numeric"
                pattern={'[0-9]{17,20}'}
                maxlength={20}
                disabled={!editable}
                aria-describedby="discord-guild-help"
                class="input w-full"
              />
              <p id="discord-guild-help">
                {t('discord_settings.guild_id_help')}
              </p>
              {#if $discordErrors.guildId}<p role="alert">
                  {$discordErrors.guildId[0]}
                </p>{/if}
            </div>
            <div class="grid gap-2">
              <p>{t('discord_settings.guild_name')}</p>
              <p>
                {data.guildNameSnapshot || t('discord_settings.guild_name_unverified')}
              </p>
            </div>
            <div class="grid gap-2">
              <label for="discordInviteUrl" class="label">{t('discord_settings.invite_url')}</label>
              <input
                id="discordInviteUrl"
                name="inviteUrl"
                type="url"
                bind:value={$discordForm.inviteUrl}
                maxlength={500}
                disabled={!editable}
                class="input w-full"
              />
              {#if $discordErrors.inviteUrl}<p role="alert">
                  {$discordErrors.inviteUrl[0]}
                </p>{/if}
            </div>
            <div class="grid gap-2">
              <label for="discordRoleId" class="label">{t('discord_settings.role_id')}</label>
              <input
                id="discordRoleId"
                name="roleId"
                bind:value={$discordForm.roleId}
                inputmode="numeric"
                pattern={'[0-9]{17,20}'}
                maxlength={20}
                disabled={!editable}
                aria-describedby="discord-role-help"
                class="input w-full"
              />
              <p id="discord-role-help">
                {t('discord_settings.role_id_help')}
              </p>
              {#if $discordErrors.roleId}<p role="alert">
                  {$discordErrors.roleId[0]}
                </p>{/if}
            </div>
            {#each [{ name: 'staffRoleId', key: 'discord_settings.staff_role_id' }, { name: 'logChannelId', key: 'discord_settings.log_channel_id' }, { name: 'notificationChannelId', key: 'discord_settings.notification_channel_id' }] as const as field (field.name)}
              <div class="grid gap-2">
                <label for={`discord-${field.name}`} class="label">{t(field.key)}</label>
                <input
                  id={`discord-${field.name}`}
                  name={field.name}
                  bind:value={$discordForm[field.name]}
                  inputmode="numeric"
                  pattern={'[0-9]{17,20}'}
                  maxlength={20}
                  disabled={!editable}
                  aria-describedby={`discord-${field.name}-help discord-${field.name}-error`}
                  aria-invalid={$discordErrors[field.name] ? 'true' : undefined}
                  class="input w-full"
                />
                <p id={`discord-${field.name}-help`}>{t('discord_settings.ids_help')}</p>
                <p id={`discord-${field.name}-error`} role="alert">
                  {$discordErrors[field.name]?.[0] ?? ''}
                </p>
              </div>
            {/each}
            {#if editable}
              <button type="submit" class="btn btn-primary justify-self-start"
                >{t('discord_settings.save')}</button
              >
            {/if}
          </form>
        </div>
      </div>
    </div>
  {/snippet}
</SettingsPage>
