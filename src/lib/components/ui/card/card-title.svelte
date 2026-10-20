<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  let {
    children,
    class: className,
    ...rest
  }: HTMLAttributes<HTMLHeadingElement> & {
    children?: Snippet;
  } = $props();
</script>

<h2 class={cn('text-xl leading-none font-semibold tracking-tight', className)} {...rest}>
  {@render children?.()}
</h2>
