<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLLabelAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  let {
    children,
    class: className,
    ...rest
  }: HTMLLabelAttributes & { children?: Snippet } = $props();
</script>

<label class={cn('text-sm leading-none font-medium', className)} {...rest}>
  {@render children?.()}
</label>
