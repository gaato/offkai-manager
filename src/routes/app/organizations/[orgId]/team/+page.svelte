<script lang="ts">
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import {
    membershipStatusLabelKey,
    organizationRoleLabelKey,
    type OrganizationRole
  } from '$lib/shared/organization';
  import { Alert } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

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

<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
  <div>
    <h2 class="text-xl font-bold">{t('team.title')}</h2>
    <p class="text-muted-foreground mt-2 max-w-2xl">{t('team.intro')}</p>
  </div>
  {#if !data.capabilities.canManageTeam}
    <Badge class="bg-muted text-muted-foreground">{t('team.read_only')}</Badge>
  {/if}
</div>

{#if actionResult?.actionError}
  <Alert class="border-destructive text-destructive mt-6" role="alert"
    >{actionResult.actionError}</Alert
  >
{:else if actionResult?.actionMessage}
  <Alert class="border-primary/35 bg-secondary/50 mt-6" role="status"
    >{actionResult.actionMessage}</Alert
  >
{/if}

{#if actionResult?.pendingAction && pendingMember}
  <Alert
    class="border-primary/45 bg-background mt-6 p-5"
    role="region"
    aria-labelledby="confirm-title"
  >
    <h3 id="confirm-title" class="font-bold">{t('team.confirm_title')}</h3>
    <p class="text-muted-foreground mt-2">
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
        <input type="hidden" name="membershipId" value={actionResult.pendingAction.membershipId} />
        {#if actionResult.pendingAction.type === 'role'}
          <input type="hidden" name="role" value={actionResult.pendingAction.role} />
        {/if}
        <Button
          type="submit"
          variant={actionResult.pendingAction.type === 'disable' ? 'destructive' : 'default'}
          >{t('team.confirm_submit')}</Button
        >
      </form>
      <a
        class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
        href={teamHref}>{t('form.cancel')}</a
      >
    </div>
  </Alert>
{/if}

{#if data.capabilities.canManageTeam}
  <Card class="mt-7 shadow-none">
    <CardHeader>
      <CardTitle>{t('team.invite_title')}</CardTitle>
      <p class="text-muted-foreground mt-2 text-sm">{t('team.invite_intro')}</p>
    </CardHeader>
    <CardContent>
      {#if $inviteMessage}
        <Alert
          class={$inviteMessage !== t('team.invite_success')
            ? 'border-destructive mb-5'
            : 'border-primary/35 bg-secondary/50 mb-5'}
          role={$inviteMessage !== t('team.invite_success') ? 'alert' : 'status'}
          >{$inviteMessage}</Alert
        >
      {/if}
      <form
        method="POST"
        action="?/invite"
        use:enhanceInvite
        class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
      >
        <div class="grid gap-2">
          <Label for="discordUserId">{t('team.discord_user_id')}</Label>
          <Input
            id="discordUserId"
            name="discordUserId"
            bind:value={$inviteData.discordUserId}
            inputmode="numeric"
            autocomplete="off"
            required
            pattern={'[0-9]{17,20}'}
            aria-invalid={$inviteErrors.discordUserId ? 'true' : undefined}
            aria-describedby={$inviteErrors.discordUserId ? 'discord-id-error' : 'discord-id-help'}
          />
          <p id="discord-id-help" class="text-muted-foreground text-sm">
            {t('team.discord_user_id_help')}
          </p>
          {#if $inviteErrors.discordUserId}<p
              id="discord-id-error"
              class="text-destructive text-sm"
              role="alert"
            >
              {$inviteErrors.discordUserId[0]}
            </p>{/if}
        </div>
        <div class="grid gap-2">
          <Label for="inviteRole">{t('team.role')}</Label>
          <select
            id="inviteRole"
            name="role"
            bind:value={$inviteData.role}
            class="border-input bg-background min-h-12 rounded-md border px-3 text-base"
            required
            aria-invalid={$inviteErrors.role ? 'true' : undefined}
            aria-describedby={$inviteErrors.role ? 'invite-role-error' : undefined}
          >
            {#each inviteRoleOptions as role (role)}
              <option value={role}>{t(organizationRoleLabelKey(role))}</option>
            {/each}
          </select>
          {#if $inviteErrors.role}
            <p id="invite-role-error" class="text-destructive text-sm" role="alert">
              {$inviteErrors.role[0]}
            </p>
          {/if}
        </div>
        <Button type="submit">{t('team.invite_submit')}</Button>
      </form>
    </CardContent>
  </Card>
{/if}

<section class="mt-8" aria-labelledby="member-list-title">
  <h3 id="member-list-title" class="text-lg font-bold">{t('team.members_title')}</h3>
  <div class="bg-background mt-4 overflow-x-auto rounded-xl border">
    <table class="w-full min-w-[48rem] border-collapse text-left">
      <caption class="sr-only">{t('team.members_caption')}</caption>
      <thead class="bg-muted/65 text-sm">
        <tr>
          <th class="px-5 py-3 font-semibold" scope="col">{t('team.member')}</th>
          <th class="px-5 py-3 font-semibold" scope="col">{t('team.role')}</th>
          <th class="px-5 py-3 font-semibold" scope="col">{t('team.status')}</th>
          {#if data.capabilities.canManageTeam}<th class="px-5 py-3 font-semibold" scope="col"
              >{t('team.actions')}</th
            >{/if}
        </tr>
      </thead>
      <tbody>
        {#each data.members as member (member.id)}
          <tr class="border-t align-top">
            <td class="px-5 py-4">
              <span class="block font-semibold">{memberName(member)}</span>
              {#if member.username}<span class="text-muted-foreground mt-1 block text-sm"
                  >{member.username}</span
                >{/if}
            </td>
            <td class="px-5 py-4">{t(organizationRoleLabelKey(member.role))}</td>
            <td class="px-5 py-4">
              <Badge
                class={member.status === 'active'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-muted text-muted-foreground'}
                >{t(membershipStatusLabelKey(member.status))}</Badge
              >
            </td>
            {#if data.capabilities.canManageTeam}
              <td class="px-5 py-3">
                <div class="flex flex-wrap items-end gap-2">
                  {#if member.status === 'active'}
                    <form method="POST" action="?/prepareRole" class="flex items-end gap-2">
                      <input type="hidden" name="membershipId" value={member.id} />
                      <div class="grid gap-1">
                        <Label class="sr-only" for={`role-${member.id}`}
                          >{t('team.change_role_for', { name: memberName(member) })}</Label
                        >
                        <select
                          id={`role-${member.id}`}
                          name="role"
                          class="border-input bg-background min-h-10 rounded-md border px-2 text-sm"
                        >
                          {#each roleOptions as role (role)}
                            <option value={role} selected={role === member.role}
                              >{t(organizationRoleLabelKey(role))}</option
                            >
                          {/each}
                        </select>
                      </div>
                      <Button type="submit" variant="outline" size="sm"
                        >{t('team.review_role')}</Button
                      >
                    </form>
                    <form method="POST" action="?/prepareDisable">
                      <input type="hidden" name="membershipId" value={member.id} />
                      <Button type="submit" variant="ghost" size="sm">{t('team.disable')}</Button>
                    </form>
                  {:else}
                    <form method="POST" action="?/prepareEnable">
                      <input type="hidden" name="membershipId" value={member.id} />
                      <Button type="submit" variant="outline" size="sm">{t('team.enable')}</Button>
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
