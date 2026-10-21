<script lang="ts">
  import Confirmation from '$lib/components/confirmation.svelte';
  import ListPage from '$lib/components/page/list-page.svelte';
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import {
    membershipStatusLabelKey,
    organizationRoleLabelKey,
    type OrganizationRole
  } from '$lib/shared/organization';

  type PendingAction =
    | { type: 'role'; membershipId: string; role: OrganizationRole }
    | { type: 'disable' | 'enable'; membershipId: string };
  type ActionResult = {
    pendingAction?: PendingAction;
    actionError?: string;
    actionMessage?: string;
  } | null;

  let { data, form: rawActionResult } = $props();
  const actionResult = $derived(rawActionResult as ActionResult);
  const t = $derived(translator(data.locale));
  const invite = superForm(untrack(() => data.inviteForm));
  const {
    form: inviteData,
    errors: inviteErrors,
    message: inviteMessage,
    enhance: enhanceInvite
  } = invite;
  const roleOptions: readonly OrganizationRole[] = ['owner', 'organizer', 'staff', 'viewer'];
  const inviteRoleOptions: readonly OrganizationRole[] = ['viewer', 'staff', 'organizer'];
  const pendingMember = $derived(
    actionResult?.pendingAction
      ? data.members.find((member) => member.id === actionResult.pendingAction?.membershipId)
      : undefined
  );
  const teamHref = $derived(
    resolve('/app/organizations/[orgId]/team', { orgId: data.organization.id })
  );

  function memberName(member: (typeof data.members)[number]): string {
    return member.displayName || member.username || t('team.unknown_member');
  }
</script>

<svelte:head
  ><title>{t('team.title')} · {data.organization.name} · {t('brand.name')}</title></svelte:head
>

<ListPage>
  {#snippet title()}{t('team.title')}{/snippet}
  {#snippet body()}
    <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="mt-2 max-w-2xl">{t('team.intro')}</p>
      </div>
      {#if !data.capabilities.canManageTeam}
        <span class="badge badge-ghost">{t('team.read_only')}</span>
      {/if}
    </div>

    {#if actionResult?.actionError}
      <div role="alert" class="alert alert-error mt-6">{actionResult.actionError}</div>
    {:else if actionResult?.actionMessage}
      <div role="status" class="alert alert-success mt-6">{actionResult.actionMessage}</div>
    {/if}

    {#if actionResult?.pendingAction && pendingMember}
      <Confirmation label={t('team.confirm_title')} cancelLabel={t('form.cancel')}>
        <p class="mt-2">
          {#if actionResult.pendingAction.type === 'role'}
            {t('team.confirm_role', {
              name: memberName(pendingMember),
              role: t(organizationRoleLabelKey(actionResult.pendingAction.role))
            })}
          {:else if actionResult.pendingAction.type === 'disable'}
            {t('team.confirm_disable', { name: memberName(pendingMember) })}
          {:else}
            {t('team.confirm_enable', { name: memberName(pendingMember) })}
          {/if}
        </p>
        <div class="mt-5 flex flex-wrap gap-3">
          <form
            method="POST"
            action={actionResult.pendingAction.type === 'role'
              ? '?/changeRole'
              : actionResult.pendingAction.type === 'disable'
                ? '?/disable'
                : '?/enable'}
          >
            <input
              type="hidden"
              name="membershipId"
              value={actionResult.pendingAction.membershipId}
            />
            {#if actionResult.pendingAction.type === 'role'}
              <input type="hidden" name="role" value={actionResult.pendingAction.role} />
            {/if}
            <button type="submit" class="btn btn-primary">{t('team.confirm_submit')}</button>
          </form>
          <a href={teamHref} class="btn inline-flex min-h-12 items-center px-5"
            >{t('form.cancel')}</a
          >
        </div>
      </Confirmation>
    {/if}

    {#if data.capabilities.canManageTeam}
      <div class="card card-border bg-base-100 mt-7">
        <div class="card-body gap-2 pb-0">
          <h2 class="card-title">{t('team.invite_title')}</h2>
          <p class="mt-2">{t('team.invite_intro')}</p>
        </div>
        <div class="card-body">
          {#if $inviteMessage}
            <div
              role={$inviteMessage !== t('team.invite_success') ? 'alert' : 'status'}
              class={($inviteMessage !== t('team.invite_success') ? 'alert' : 'status') === 'status'
                ? 'alert alert-success'
                : 'alert alert-error'}
            >
              {$inviteMessage}
            </div>
          {/if}
          <form
            method="POST"
            action="?/invite"
            use:enhanceInvite
            class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
          >
            <div class="grid gap-2">
              <label for="discordUserId" class="label">{t('team.discord_user_id')}</label>
              <input
                id="discordUserId"
                name="discordUserId"
                bind:value={$inviteData.discordUserId}
                inputmode="numeric"
                autocomplete="off"
                required
                pattern={'[0-9]{17,20}'}
                aria-invalid={$inviteErrors.discordUserId ? 'true' : undefined}
                aria-describedby={$inviteErrors.discordUserId
                  ? 'discord-id-error'
                  : 'discord-id-help'}
                class="input w-full"
              />
              <p id="discord-id-help">
                {t('team.discord_user_id_help')}
              </p>
              {#if $inviteErrors.discordUserId}<p id="discord-id-error" role="alert">
                  {$inviteErrors.discordUserId[0]}
                </p>{/if}
            </div>
            <div class="grid gap-2">
              <label for="inviteRole" class="label">{t('team.role')}</label>
              <select
                id="inviteRole"
                name="role"
                bind:value={$inviteData.role}
                required
                aria-invalid={$inviteErrors.role ? 'true' : undefined}
                aria-describedby={$inviteErrors.role ? 'invite-role-error' : undefined}
                class="select bg-base-100 min-h-12 w-full px-3"
              >
                {#each inviteRoleOptions as role (role)}
                  <option value={role}>{t(organizationRoleLabelKey(role))}</option>
                {/each}
              </select>
              {#if $inviteErrors.role}
                <p id="invite-role-error" role="alert">
                  {$inviteErrors.role[0]}
                </p>
              {/if}
            </div>
            <button type="submit" class="btn btn-primary">{t('team.invite_submit')}</button>
          </form>
        </div>
      </div>
    {/if}

    <section aria-labelledby="member-list-title" class="mt-8">
      <h3 id="member-list-title" class="card-title">{t('team.members_title')}</h3>
      <div class="bg-base-100 mt-4 overflow-x-auto">
        <table class="table w-full min-w-[48rem]">
          <caption class="sr-only">{t('team.members_caption')}</caption>
          <thead>
            <tr>
              <th scope="col" class="px-5 py-3">{t('team.member')}</th>
              <th scope="col" class="px-5 py-3">{t('team.role')}</th>
              <th scope="col" class="px-5 py-3">{t('team.status')}</th>
              {#if data.capabilities.canManageTeam}<th scope="col" class="px-5 py-3"
                  >{t('team.actions')}</th
                >{/if}
            </tr>
          </thead>
          <tbody>
            {#each data.members as member (member.id)}
              <tr>
                <td class="px-5 py-4">
                  <span class="block">{memberName(member)}</span>
                  {#if member.username}<span class="mt-1 block">{member.username}</span>{/if}
                </td>
                <td class="px-5 py-4">{t(organizationRoleLabelKey(member.role))}</td>
                <td class="px-5 py-4">
                  <span
                    class={member.status === 'active'
                      ? 'badge badge-secondary'
                      : 'badge badge-ghost'}>{t(membershipStatusLabelKey(member.status))}</span
                  >
                </td>
                {#if data.capabilities.canManageTeam}
                  <td class="px-5 py-3">
                    <div class="flex flex-wrap items-end gap-2">
                      {#if member.status === 'active'}
                        <form method="POST" action="?/prepareRole" class="flex items-end gap-2">
                          <input type="hidden" name="membershipId" value={member.id} />
                          <div class="grid gap-1">
                            <label for={`role-${member.id}`} class="label sr-only"
                              >{t('team.change_role_for', { name: memberName(member) })}</label
                            >
                            <select
                              id={`role-${member.id}`}
                              name="role"
                              class="select bg-base-100 min-h-10 w-full px-2"
                            >
                              {#each roleOptions as role (role)}
                                <option value={role} selected={role === member.role}
                                  >{t(organizationRoleLabelKey(role))}</option
                                >
                              {/each}
                            </select>
                          </div>
                          <button type="submit" class="btn btn-outline btn-sm"
                            >{t('team.review_role')}</button
                          >
                        </form>
                        <form method="POST" action="?/prepareDisable">
                          <input type="hidden" name="membershipId" value={member.id} />
                          <button type="submit" class="btn btn-ghost btn-sm"
                            >{t('team.disable')}</button
                          >
                        </form>
                      {:else}
                        <form method="POST" action="?/prepareEnable">
                          <input type="hidden" name="membershipId" value={member.id} />
                          <button type="submit" class="btn btn-outline btn-sm"
                            >{t('team.enable')}</button
                          >
                        </form>
                      {/if}
                    </div>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/snippet}
</ListPage>
