<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    title,
    actions,
    filters,
    body,
    titleId
  }: {
    title: Snippet;
    actions?: Snippet;
    filters?: Snippet;
    body: Snippet;
    titleId?: string;
  } = $props();
</script>

<div class="card card-border bg-base-100">
  <header class="flex flex-wrap items-start justify-between gap-4 p-6">
    <h1 id={titleId} class="card-title">{@render title()}</h1>
    {#if actions}<div class="flex flex-wrap gap-3">{@render actions()}</div>{/if}
  </header>
  {#if filters}<div class="card card-border bg-base-100 p-4">{@render filters()}</div>{/if}
  <div class="card-body">{@render body()}</div>
</div>
