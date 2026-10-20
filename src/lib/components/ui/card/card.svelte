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

<div class={cn('bg-card text-card-foreground rounded-xl border shadow-sm', className)} {...rest}>
  {@render children?.()}
</div>
