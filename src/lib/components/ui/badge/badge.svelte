<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  let {
    children,
    class: className,
    ...rest
  }: HTMLAttributes<HTMLSpanElement> & {
    children?: Snippet;
  } = $props();
</script>

<span
  class={cn(
    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
    className
  )}
  {...rest}
>
  {@render children?.()}
</span>
