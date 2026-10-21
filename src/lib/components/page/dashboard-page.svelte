<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    title,
    actions,
    filters,
    body,
    titleId,
    stats,
    steps,
    recent
  }: {
    title: Snippet;
    actions?: Snippet;
    filters?: Snippet;
    body: Snippet;
    titleId?: string;
    stats?: Snippet;
    steps?: Snippet;
    recent?: Snippet;
  } = $props();
</script>

<div class="grid gap-8">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <h1 id={titleId} class="card-title">{@render title()}</h1>
    {#if actions}<div class="flex flex-wrap gap-3">{@render actions()}</div>{/if}
  </header>
  {#if filters}<div class="card card-border bg-base-100 p-4">{@render filters()}</div>{/if}
  {#if stats}<div class="stats stats-vertical lg:stats-horizontal">{@render stats()}</div>{/if}
  {#if steps}<ul class="steps steps-vertical lg:steps-horizontal">{@render steps()}</ul>{/if}
  <div class="grid gap-6">{@render body()}</div>
  {#if recent}{@render recent()}{/if}
</div>
