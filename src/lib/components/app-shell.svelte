<script lang="ts">
  import type { Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import { translator, type Locale } from '$lib/i18n';
  import WorkspaceShell from './workspace-shell.svelte';
  let {
    session,
    organizations,
    locale,
    children
  }: {
    session: { displayName: string };
    organizations: { id: string; name: string }[];
    locale: Locale;
    children: Snippet;
  } = $props();
  const t = $derived(translator(locale));
  const links = $derived([
    { href: resolve('/app'), label: t('app.dashboard') },
    ...organizations.map((org) => ({
      href: resolve('/app/organizations/[orgId]', { orgId: org.id }),
      label: org.name
    }))
  ]);
</script>

<WorkspaceShell
  title={t('brand.name')}
  home={resolve('/app')}
  displayName={session.displayName}
  {locale}
  {links}
  navigationLabel={t('app.workspace_navigation')}
  accountLabel={t('app.account_navigation')}
>
  {@render children()}
</WorkspaceShell>
