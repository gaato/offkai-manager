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
  <label for={id} class="text-sm font-semibold">{label}</label>
  <textarea
    bind:this={textarea}
    {id}
    readonly
    {rows}
    class="border-input bg-background w-full resize-y rounded-md border px-3 py-2 text-base"
    class:min-h-40={rows > 2}
    class:min-h-14={rows <= 2}
    {value}
  ></textarea>
  <div class="flex items-center gap-3">
    <button
      type="button"
      onclick={copy}
      class="hover:bg-accent focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md border px-4 font-semibold focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {copyLabel}
    </button>
    <span class="text-muted-foreground text-sm" aria-live="polite">
      {copied ? copiedLabel : ''}
    </span>
  </div>
</div>
