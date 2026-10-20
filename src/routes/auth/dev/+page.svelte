<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { untrack } from 'svelte';
  import { translator } from '$lib/i18n';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const form = superForm(untrack(() => data.form));
  const { form: formData, errors, enhance } = form;
</script>

<svelte:head><title>{t('dev.title')} · {t('brand.name')}</title></svelte:head>
<section class="mx-auto max-w-xl px-5 py-16">
  <Card>
    <CardHeader><CardTitle>{t('dev.title')}</CardTitle></CardHeader>
    <CardContent>
      <p class="text-muted-foreground mb-6 text-sm">{t('dev.warning')}</p>
      <form method="POST" action="?/signIn" use:enhance class="grid gap-6">
        <input name="returnTo" type="hidden" bind:value={$formData.returnTo} />
        <div class="grid gap-2">
          <Label for="discordUserId">{t('dev.discord_user_id')}</Label>
          <Input
            id="discordUserId"
            name="discordUserId"
            bind:value={$formData.discordUserId}
            autocomplete="off"
            inputmode="numeric"
            pattern={'[0-9]{17,20}'}
            required
            aria-describedby={$errors.discordUserId ? 'discordUserId-error' : undefined}
          />
          {#if $errors.discordUserId}<p id="discordUserId-error" class="text-destructive text-sm">
              {$errors.discordUserId[0]}
            </p>{/if}
        </div>
        <div class="grid gap-2">
          <Label for="username">{t('dev.username')}</Label>
          <Input
            id="username"
            name="username"
            bind:value={$formData.username}
            autocomplete="username"
            required
            aria-describedby={$errors.username ? 'username-error' : undefined}
          />
          {#if $errors.username}<p id="username-error" class="text-destructive text-sm">
              {$errors.username[0]}
            </p>{/if}
        </div>
        <div class="grid gap-2">
          <Label for="displayName">{t('dev.display_name')}</Label>
          <Input
            id="displayName"
            name="displayName"
            bind:value={$formData.displayName}
            autocomplete="name"
            required
            aria-describedby={$errors.displayName ? 'displayName-error' : undefined}
          />
          {#if $errors.displayName}<p id="displayName-error" class="text-destructive text-sm">
              {$errors.displayName[0]}
            </p>{/if}
        </div>
        <div class="flex min-h-12 items-center gap-3">
          <input
            id="platformAdmin"
            name="platformAdmin"
            type="checkbox"
            bind:checked={$formData.platformAdmin}
            class="accent-primary size-5"
          />
          <Label for="platformAdmin">{t('dev.platform_admin')}</Label>
        </div>
        <Button type="submit">{t('dev.submit')}</Button>
      </form>
    </CardContent>
  </Card>
</section>
