<script lang="ts">
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import { Alert } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const form = superForm(untrack(() => data.form));
  const { form: formData, errors, message, enhance } = form;
</script>

<svelte:head><title>{t('organization.new_title')} · {t('brand.name')}</title></svelte:head>

<div class="mx-auto max-w-2xl">
  <a
    class="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center font-semibold"
    href={resolve('/app')}>{t('app.back_dashboard')}</a
  >
  <Card class="mt-4 shadow-none">
    <CardHeader>
      <CardTitle class="text-2xl">{t('organization.new_title')}</CardTitle>
      <p class="text-muted-foreground mt-2">{t('organization.new_intro')}</p>
    </CardHeader>
    <CardContent>
      {#if $message}
        <Alert class="border-destructive text-destructive mb-6" role="alert">{$message}</Alert>
      {/if}
      <form method="POST" action="?/create" use:enhance class="grid gap-6">
        <div class="grid gap-2">
          <Label for="name">{t('organization.name')}</Label>
          <Input
            id="name"
            name="name"
            bind:value={$formData.name}
            autocomplete="organization-title"
            required
            maxlength={120}
            aria-invalid={$errors.name ? 'true' : undefined}
            aria-describedby={$errors.name ? 'name-error' : 'name-help'}
          />
          <p id="name-help" class="text-muted-foreground text-sm">{t('organization.name_help')}</p>
          {#if $errors.name}
            <p id="name-error" class="text-destructive text-sm" role="alert">{$errors.name[0]}</p>
          {/if}
        </div>
        <div class="flex flex-wrap gap-3">
          <Button type="submit">{t('organization.create_submit')}</Button>
          <a
            class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
            href={resolve('/app')}>{t('form.cancel')}</a
          >
        </div>
      </form>
    </CardContent>
  </Card>
</div>
