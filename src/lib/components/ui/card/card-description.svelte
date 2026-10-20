<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  let {
    children,
    class: className,
    ...rest
  }: HTMLAttributes<HTMLParagraphElement> & {
    children?: Snippet;
  } = $props();
</script>

<p class={cn('text-muted-foreground text-sm', className)} {...rest}>{@render children?.()}</p>
