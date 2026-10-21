<script lang="ts">
  let {
    id,
    label,
    value,
    copyLabel,
    copiedLabel,
    rows = 8
  } = $props<{
    id: string;
    label: string;
    value: string;
    copyLabel: string;
    copiedLabel: string;
    rows?: number;
  }>();

  let textarea: HTMLTextAreaElement | undefined;
  let copied = $state(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      window.setTimeout(() => (copied = false), 2_000);
    } catch {
      textarea?.focus();
      textarea?.select();
    }
  }
</script>

<div class="grid gap-2">
  <label for={id} class="label">{label}</label>
  <textarea bind:this={textarea} {id} readonly {rows} {value} class="textarea w-full"></textarea>
  <div class="flex items-center gap-3">
    <button
      type="button"
      onclick={copy}
      class="btn btn-ghost inline-flex min-h-11 items-center px-4"
    >
      {copyLabel}
    </button>
    {#if copied}<div class="toast toast-end">
        <div class="alert alert-success" role="status">{copiedLabel}</div>
      </div>{/if}
  </div>
</div>
