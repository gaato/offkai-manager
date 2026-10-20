<script lang="ts">
  import AppShell from '$lib/components/app-shell.svelte';

  let { data, children } = $props();
</script>

<AppShell session={data.appSession} organizations={data.organizations} locale={data.locale}>
  {@render children()}
</AppShell>
