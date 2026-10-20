<script lang="ts">
  import OpsShell from '$lib/components/ops-shell.svelte';

  let { data, children } = $props();
</script>

<OpsShell displayName={data.opsSession.displayName} locale={data.locale}>
  {@render children()}
</OpsShell>
