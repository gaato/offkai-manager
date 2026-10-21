<script lang="ts">
  import type { Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import { translator, type Locale } from '$lib/i18n';
  import WorkspaceShell from './workspace-shell.svelte';
  let {
    displayName,
    locale,
    children
  }: { displayName: string; locale: Locale; children: Snippet } = $props();
  const t = $derived(translator(locale));
  const links = $derived([
    { href: resolve('/ops'), label: t('ops.nav.dashboard') },
    { href: resolve('/ops/organizations'), label: t('ops.nav.organizations') },
    { href: resolve('/ops/users'), label: t('ops.nav.users') },
    { href: resolve('/ops/activity'), label: t('ops.nav.activity') },
    { href: resolve('/ops/payment-conflicts'), label: t('ops.nav.payment_conflicts') }
  ]);
</script>

<WorkspaceShell
  title={t('ops.shell_title')}
  home={resolve('/ops')}
  {displayName}
  {locale}
  {links}
  navigationLabel={t('ops.navigation')}
  accountLabel={t('ops.account_navigation')}
>
  {@render children()}
</WorkspaceShell>
