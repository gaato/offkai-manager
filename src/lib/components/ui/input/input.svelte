<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLInputAttributes } from 'svelte/elements';

  let { class: className, value = $bindable(), ...rest }: HTMLInputAttributes = $props();
</script>

<input
  bind:value
  class={cn(
    'border-input bg-background placeholder:text-muted-foreground flex min-h-12 w-full rounded-md border px-3 py-2 text-base shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    className
  )}
  {...rest}
/>
