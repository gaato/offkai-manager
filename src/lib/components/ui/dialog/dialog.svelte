<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLDialogAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  type Props = HTMLDialogAttributes & {
    children?: Snippet;
    open?: boolean;
  };

  let { children, class: className, open = false, ...rest }: Props = $props();
</script>

<dialog
  {open}
  class={cn(
    'bg-card text-card-foreground m-auto max-w-[calc(100%-2rem)] rounded-xl border p-6 shadow-xl backdrop:bg-black/50 open:grid open:gap-4',
    className
  )}
  {...rest}
>
  {@render children?.()}
</dialog>
