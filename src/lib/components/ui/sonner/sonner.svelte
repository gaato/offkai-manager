<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  let {
    children,
    class: className,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    children?: Snippet;
  } = $props();
</script>

<div class={cn('fixed end-4 bottom-4 z-50 grid max-w-sm gap-2', className)} {...rest}>
  {@render children?.()}
</div>
