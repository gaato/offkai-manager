<script lang="ts">
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import { registrationModeLabelKey, registrationModes } from '$lib/shared/event';
  import { Alert } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const eventForm = superForm(untrack(() => data.form));
  const { form, errors, message, enhance } = eventForm;
  const backHref = $derived(resolve('/app/organizations/[orgId]', { orgId: data.organization.id }));
</script>

<svelte:head><title>{t('event.new_title')} · {t('brand.name')}</title></svelte:head>

<div class="mx-auto max-w-2xl">
  <a
    class="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center font-semibold"
    href={backHref}>{t('organization.home_nav')}</a
  >
  <Card class="mt-4 shadow-none">
    <CardHeader>
      <CardTitle class="text-2xl">{t('event.new_title')}</CardTitle>
      <p class="text-muted-foreground mt-2">{t('event.new_intro')}</p>
    </CardHeader>
    <CardContent>
      {#if $message}
        <Alert class="border-destructive text-destructive mb-6" role="alert">{$message}</Alert>
      {/if}
      <form method="POST" action="?/create" use:enhance class="grid gap-6">
        <div class="grid gap-2">
          <Label for="title">{t('event.title')}</Label>
          <Input
            id="title"
            name="title"
            bind:value={$form.title}
            required
            maxlength={200}
            aria-invalid={$errors.title ? 'true' : undefined}
            aria-describedby={$errors.title ? 'title-error' : 'title-help'}
          />
          <p id="title-help" class="text-muted-foreground text-sm">{t('event.title_help')}</p>
          {#if $errors.title}<p id="title-error" class="text-destructive text-sm" role="alert">
              {$errors.title[0]}
            </p>{/if}
        </div>
        <div class="grid gap-2">
          <Label for="startsAt">{t('event.starts_at')}</Label>
          <Input
            id="startsAt"
            name="startsAt"
            type="datetime-local"
            bind:value={$form.startsAt}
            required
            aria-invalid={$errors.startsAt ? 'true' : undefined}
          />
          {#if $errors.startsAt}<p class="text-destructive text-sm" role="alert">
              {$errors.startsAt[0]}
            </p>{/if}
        </div>
        <div class="grid gap-2">
          <Label for="capacity">{t('event.capacity')}</Label>
          <Input
            id="capacity"
            name="capacity"
            type="number"
            min={1}
            step={1}
            bind:value={$form.capacity}
            aria-invalid={$errors.capacity ? 'true' : undefined}
            aria-describedby={$errors.capacity ? 'capacity-error' : 'capacity-help'}
          />
          <p id="capacity-help" class="text-muted-foreground text-sm">
            {t('event.capacity_help')}
          </p>
          {#if $errors.capacity}<p
              id="capacity-error"
              class="text-destructive text-sm"
              role="alert"
            >
              {$errors.capacity[0]}
            </p>{/if}
        </div>
        <fieldset class="grid gap-3">
          <legend class="font-medium">{t('event.registration_mode_label')}</legend>
          <p class="text-muted-foreground text-sm">{t('event.registration_mode_help')}</p>
          {#each registrationModes as mode (mode)}
            <label class="border-input flex min-h-12 items-center gap-3 rounded-md border px-4">
              <input
                type="radio"
                name="registrationMode"
                value={mode}
                bind:group={$form.registrationMode}
              />
              <span>{t(registrationModeLabelKey(mode))}</span>
            </label>
          {/each}
        </fieldset>
        <div class="flex flex-wrap gap-3">
          <Button type="submit">{t('event.create_submit')}</Button>
          <a
            class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
            href={backHref}>{t('form.cancel')}</a
          >
        </div>
      </form>
    </CardContent>
  </Card>
</div>
