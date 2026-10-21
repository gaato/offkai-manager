<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  let {
    label,
    cancelLabel,
    trigger,
    children
  }: {
    label: string;
    cancelLabel: string;
    trigger?: Snippet;
    children: Snippet;
  } = $props();
  let enhanced = $state(false);
  let dialog = $state<HTMLDialogElement>();
  onMount(() => {
    enhanced = true;
  });
</script>

{#if enhanced && trigger}
  <button type="button" class="btn" onclick={() => dialog?.showModal()}>{@render trigger()}</button>
  <dialog bind:this={dialog} class="modal" aria-label={label}>
    <div class="modal-box grid gap-4">
      <h2 class="card-title">{label}</h2>
      {@render children()}
      <div class="modal-action">
        <button type="button" class="btn" onclick={() => dialog?.close()}>{cancelLabel}</button>
      </div>
    </div>
  </dialog>
{:else if trigger}
  <details>
    <summary class="btn">{@render trigger()}</summary>
    <div class="card card-border bg-base-100 p-4">{@render children()}</div>
  </details>
{:else}
  <div class="card card-border bg-base-100 grid gap-4 p-4">
    <h2 class="card-title">{label}</h2>
    {@render children()}
  </div>
{/if}
