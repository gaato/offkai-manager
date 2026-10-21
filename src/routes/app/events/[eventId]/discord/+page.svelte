<script lang="ts">
  import SettingsPage from '$lib/components/page/settings-page.svelte';
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  let { data, form: actionResult } = $props();
  const t = $derived(translator(data.locale));
  const discordSettings = superForm(untrack(() => data.discordForm));
  const {
    form: discordForm,
    errors: discordErrors,
    message: discordMessage,
    enhance: enhanceDiscord
  } = discordSettings;
  const templates = superForm(untrack(() => data.templateForm));
  const {
    form: templateForm,
    errors: templateErrors,
    message: templateMessage,
    enhance: enhanceTemplates
  } = templates;
  const preview = $derived(actionResult?.layoutPreview);
  const editable = $derived(data.capabilities.canManageEvent && !data.event.archivedAt);
</script>

<svelte:head
  ><title>{t('event.discord_nav')} · {data.event.title} · {t('brand.name')}</title></svelte:head
>
<SettingsPage>
  {#snippet title()}{t('event.discord_nav')}{/snippet}
  {#snippet body()}
    <div class="grid gap-6">
      <section class="card card-border bg-base-100" aria-labelledby="scheduled-title">
        <div class="card-body">
          <h2 id="scheduled-title" class="card-title">{t('native.title')}</h2>
          <p>{t('native.help')}</p>
          {#if actionResult?.nativeMessage}<p role="status">{actionResult.nativeMessage}</p>{/if}
          {#if !data.scheduledPermissionsOk}<p>{t('native.permission')}</p>
            {#if data.scheduledPermissionsUrl}<a class="link" href={data.scheduledPermissionsUrl}
                >{t('discord_setup.add_permissions')}</a
              >{/if}{/if}
          {#if actionResult?.nativePending}<div class="alert">
              <p>{t('native.confirm_cancel')}</p>
              <form method="POST" action="?/scheduled">
                <input type="hidden" name="confirmed" value="true" /><button
                  type="submit"
                  class="btn btn-error">{t('participant.confirm_cancel')}</button
                >
              </form>
              <a class="btn" href={`/app/events/${data.event.id}/discord`}>{t('form.cancel')}</a>
            </div>{/if}
          <form method="POST" action="?/scheduled" class="grid gap-4">
            <label class="label"
              ><input
                class="toggle"
                type="checkbox"
                name="enabled"
                value="true"
                checked={data.scheduledEnabled}
                disabled={!editable}
              />{t('native.title')}</label
            ><button class="btn btn-primary" type="submit" disabled={!editable}
              >{t('native.save')}</button
            >
          </form>
        </div>
      </section>
      <div class="card card-border bg-base-100">
        <div class="card-body gap-2 pb-0">
          <h2 id="discord-settings" class="card-title">{t('discord_settings.title')}</h2>
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
          {#if data.setupError}<p role="alert" class="alert alert-warning">
              {t('discord_setup.failed')}
            </p>
          {:else if !data.setup.resources}<p class="alert alert-info">
              {t('discord_setup.manual')}
            </p>{/if}
          {#if data.setup.missing}
            {#each ['panel', 'roles', 'notifications'] as const as feature (feature)}
              {#if data.setup.missing[feature].length}
                <p role="alert" class="alert alert-warning">
                  {t('discord_setup.missing', {
                    feature: t(`discord_setup.feature.${feature}`),
                    permissions: data.setup.missing[feature]
                      .map((name) => t(`discord_setup.permission.${name}`))
                      .join(', ')
                  })}
                </p>
              {/if}
            {/each}
          {/if}
          {#if data.addPermissionsUrl}<a href={data.addPermissionsUrl} class="link"
              >{t('discord_setup.add_permissions')}</a
            >{/if}
          {#each data.excludedSavedRoles as role (role.id)}
            <p class="alert alert-warning" role="alert">
              {t('discord_setup.invalid_saved_role', { role: role.name })}
            </p>
          {/each}
          <form method="POST" action="?/discord" use:enhanceDiscord class="grid gap-6">
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
            {#each [{ name: 'announcementChannelId', key: 'discord_setup.announcement', role: false }, { name: 'roleId', key: 'discord_settings.role_id', role: true }, { name: 'staffRoleId', key: 'discord_settings.staff_role_id', role: true }, { name: 'logChannelId', key: 'discord_settings.log_channel_id', role: false }, { name: 'notificationChannelId', key: 'discord_settings.notification_channel_id', role: false }] as const as field (field.name)}
              {@const options = field.role
                ? data.roleOptions
                : (data.setup.resources?.channels ?? []).filter(
                    (channel) =>
                      channel.type === 0 ||
                      (field.name !== 'notificationChannelId' && channel.type === 5)
                  )}
              <div class="grid gap-2">
                <label for={`discord-${field.name}`} class="label">{t(field.key)}</label>
                {#if data.setup.resources && data.setup.resources.guildId === $discordForm.guildId}
                  <select
                    id={`discord-${field.name}`}
                    name={field.name}
                    bind:value={$discordForm[field.name]}
                    disabled={!editable}
                    class="select w-full"
                    aria-describedby={`discord-${field.name}-error`}
                    aria-invalid={$discordErrors[field.name] ? 'true' : undefined}
                  >
                    <option value="">{t('discord_setup.none')}</option>
                    {#if $discordForm[field.name] && !options.some((item) => item.id === $discordForm[field.name])}
                      <option value={$discordForm[field.name]}
                        >{t('discord_setup.unavailable_selection')}</option
                      >
                    {/if}
                    {#each options as option (option.id)}<option value={option.id}
                        >{option.name}</option
                      >{/each}
                  </select>
                {:else}
                  <input
                    id={`discord-${field.name}`}
                    name={field.name}
                    bind:value={$discordForm[field.name]}
                    inputmode="numeric"
                    pattern={'[0-9]{17,20}'}
                    maxlength={20}
                    disabled={!editable}
                    class="input w-full"
                    aria-describedby={`discord-${field.name}-error`}
                    aria-invalid={$discordErrors[field.name] ? 'true' : undefined}
                  />
                {/if}
                {#if field.role && data.unassignableRoleIds.includes($discordForm[field.name])}
                  <p role="alert" class="alert alert-warning">
                    {t('discord_setup.hierarchy', {
                      role:
                        options.find((item) => item.id === $discordForm[field.name])?.name ??
                        $discordForm[field.name]
                    })}
                  </p>
                {/if}
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
      <section id="panel-templates" class="card card-border bg-base-100">
        <div class="card-body gap-4">
          <h2 class="card-title">{t('panel_template.title')}</h2>
          <p>{t('panel_template.help')}</p>
          {#if $templateMessage}<p
              role={$templateMessage === t('panel_template.saved') ? 'status' : 'alert'}
              class={$templateMessage === t('panel_template.saved')
                ? 'alert alert-success'
                : 'alert alert-error'}
            >
              {$templateMessage}
            </p>{/if}
          <form method="POST" action="?/templates" use:enhanceTemplates class="grid gap-4">
            {#each [{ name: 'panelTemplateJa', key: 'panel_template.ja' }, { name: 'panelTemplateEn', key: 'panel_template.en' }] as const as field (field.name)}
              <label for={field.name} class="label">{t(field.key)}</label>
              <textarea
                id={field.name}
                name={field.name}
                bind:value={$templateForm[field.name]}
                rows={12}
                maxlength={10000}
                disabled={!editable}
                class="textarea w-full"
                aria-invalid={$templateErrors[field.name] ? 'true' : undefined}
                aria-describedby={`${field.name}-error`}
              ></textarea>
              <p id={`${field.name}-error`} role="alert">
                {$templateErrors[field.name]?.[0] ?? ''}
              </p>
            {/each}
            {#if editable}<button type="submit" class="btn btn-primary justify-self-start"
                >{t('panel_template.save')}</button
              >{/if}
          </form>
        </div>
      </section>
      <section id="panel-posting" class="card card-border bg-base-100">
        <div class="card-body">
          <h2 class="card-title">{t('event.setup_posted')}</h2>
          <p>{t('event.setup_post_help')}</p>
        </div>
      </section>
      <section id="discord-layout" class="card card-border bg-base-100">
        <div class="card-body gap-4">
          <h2 class="card-title">{t('discord_setup.layout_title')}</h2>
          <p>{t('discord_setup.layout_help')}</p>
          {#if actionResult?.layoutError}<p role="alert" class="alert alert-error">
              {actionResult.layoutError}
            </p>{/if}
          {#if actionResult?.layoutMessage}<p role="status" class="alert alert-success">
              {actionResult.layoutMessage}
            </p>{/if}
          {#if data.setup.missing?.layout.length}
            <p role="alert" class="alert alert-warning">
              {t('discord_setup.missing', {
                feature: t('discord_setup.feature.layout'),
                permissions: data.setup.missing.layout
                  .map((name) => t(`discord_setup.permission.${name}`))
                  .join(', ')
              })}
            </p>
            {#if data.layoutPermissionsUrl}<a class="link" href={data.layoutPermissionsUrl}
                >{t('discord_setup.add_permissions')}</a
              >{/if}
          {:else if editable && data.setup.resources}
            <form method="POST" action="?/previewLayout">
              <button type="submit" class="btn btn-outline">{t('discord_setup.preview')}</button>
            </form>
            {#if preview}
              <ul class="list">
                {#each preview.steps as step (step.kind)}<li class="list-row">
                    {t('discord_setup.create', { name: step.name })}
                  </li>{/each}
                {#each preview.existing as resource (resource.kind)}<li class="list-row">
                    {t('discord_setup.reuse', { name: resource.name })}
                  </li>{/each}
              </ul>
              {#if !preview.steps.length}<p>{t('discord_setup.empty')}</p>{/if}
              <form method="POST" action="?/applyLayout">
                <input type="hidden" name="fingerprint" value={preview.fingerprint} />
                <button type="submit" class="btn btn-primary">{t('discord_setup.apply')}</button>
              </form>
            {/if}
          {/if}
          {#if data.inviteBotUrl}
            <label for="admin-message" class="label">{t('discord_setup.admin_label')}</label>
            <textarea
              id="admin-message"
              readonly
              rows={8}
              class="textarea w-full"
              value={t('discord_setup.admin_message', { url: data.inviteBotUrl })}
            ></textarea>
          {/if}
        </div>
      </section>
    </div>
  {/snippet}
</SettingsPage>
