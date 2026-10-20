<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  type Props = HTMLButtonAttributes & {
    children?: Snippet;
    variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
    size?: 'default' | 'sm' | 'lg' | 'icon';
  };

  let {
    children,
    class: className,
    variant = 'default',
    size = 'default',
    type = 'button',
    ...rest
  }: Props = $props();

  const variants = {
    default: 'bg-primary text-primary-foreground hover:brightness-95',
    secondary: 'bg-secondary text-secondary-foreground hover:brightness-95',
    outline: 'border bg-background hover:bg-accent hover:text-accent-foreground',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    destructive: 'bg-destructive text-white hover:brightness-95'
  } as const;

  const sizes = {
    default: 'h-12 px-5 py-2',
    sm: 'h-10 rounded-md px-3',
    lg: 'h-13 rounded-lg px-7',
    icon: 'size-12'
  } as const;
</script>

<button
  {type}
  class={cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
    className
  )}
  {...rest}
>
  {@render children?.()}
</button>
