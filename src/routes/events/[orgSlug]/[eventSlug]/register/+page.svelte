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
  import { registrationTextLimit, registrationTextareaLimit } from '$lib/shared/registration-form';

  type ActionResult = { guildGate?: { allowed: boolean; inviteUrl: string } } | null;

  let { data, form: rawActionResult } = $props();
  const t = $derived(translator(data.locale));
  const actionResult = $derived(rawActionResult as ActionResult);
  const guildGate = $derived(actionResult?.guildGate ?? data.guildGate);
  const registrationForm = superForm(untrack(() => data.form));
  const { form, errors, message, enhance } = registrationForm;

  function errorFor(key: string): string | undefined {
    const value: unknown = $errors[key];
    return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
  }

  function selectedOptions(key: string): unknown[] {
    const value = $form[key];
    return Array.isArray(value) ? value : [];
  }
</script>

<svelte:head>
  <title>{t('register.page_title')} · {data.title} · {t('brand.name')}</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
  <header>
    <p class="text-primary text-sm font-semibold">{t('register.page_title')}</p>
    <h1 class="mt-2 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">{data.title}</h1>
    <p class="text-muted-foreground mt-3">{data.schedule}</p>
    <p class="text-muted-foreground mt-1">
      {t('register.organized_by', { organizer: data.organizationName })}
    </p>
  </header>

  {#if !guildGate.allowed}
    <Card class="mt-8 shadow-none">
      <CardHeader>
        <CardTitle>{t('register.guild_join_title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="leading-7">{t('register.guild_join_guidance')}</p>
        {#if guildGate.inviteUrl}
          <a
            class="bg-primary text-primary-foreground mt-6 inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
            href={guildGate.inviteUrl}
            rel="external noreferrer">{t('register.guild_join_cta')}</a
          >
        {/if}
        <p class="text-muted-foreground mt-5 text-sm">{t('register.guild_join_retry')}</p>
      </CardContent>
    </Card>
  {:else}
    <Card class="mt-8 shadow-none">
      <CardHeader>
        <CardTitle>{t('register.details_title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {#if data.description}
          <p class="mb-6 leading-7 whitespace-pre-line">{data.description}</p>
        {/if}
        <p class="text-muted-foreground mb-7 text-sm">{t('register.fee_placeholder')}</p>

        {#if $message}
          <Alert class="border-destructive text-destructive mb-6" role="alert">{$message}</Alert>
        {/if}

        <form method="POST" action="?/register" use:enhance class="grid gap-6" novalidate={false}>
          {#each data.fields as field (field.key)}
            {@const fieldError = errorFor(field.key)}
            {@const controlId = `registration-${field.key}`}
            <div class="grid gap-2">
              {#if field.type === 'multiselect'}
                <fieldset
                  class="grid gap-3"
                  aria-describedby={[
                    field.helpText ? `${controlId}-help` : '',
                    fieldError ? `${controlId}-error` : ''
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined}
                >
                  <legend class="font-semibold">
                    {field.label}
                    <span class="text-muted-foreground ml-1 text-xs font-normal">
                      {field.required ? t('register.required') : t('register.optional')}
                    </span>
                  </legend>
                  {#if field.helpText}
                    <p id={`${controlId}-help`} class="text-muted-foreground text-sm">
                      {field.helpText}
                    </p>
                  {/if}
                  <div class="grid gap-2">
                    {#each field.options as option, index (option.id)}
                      <label
                        class="border-input flex min-h-12 items-center gap-3 rounded-md border px-4"
                      >
                        <input
                          type="checkbox"
                          id={`${controlId}-${index}`}
                          name={field.key}
                          value={option.id}
                          checked={selectedOptions(field.key).includes(option.id)}
                        />
                        <span>{option.label}</span>
                      </label>
                    {/each}
                  </div>
                </fieldset>
              {:else if field.type === 'checkbox' || field.type === 'consent'}
                <label class="border-input flex min-h-12 items-start gap-3 rounded-md border p-4">
                  <input
                    class="mt-1"
                    type="checkbox"
                    id={controlId}
                    name={field.key}
                    value="true"
                    checked={Boolean($form[field.key])}
                    required={field.type === 'consent' || field.required}
                    aria-describedby={[
                      field.helpText ? `${controlId}-help` : '',
                      fieldError ? `${controlId}-error` : ''
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined}
                    aria-invalid={fieldError ? 'true' : undefined}
                  />
                  <span>
                    <span class="font-semibold">{field.label}</span>
                    <span class="text-muted-foreground ml-1 text-xs font-normal">
                      {field.type === 'consent' || field.required
                        ? t('register.required')
                        : t('register.optional')}
                    </span>
                    {#if field.helpText}
                      <span
                        id={`${controlId}-help`}
                        class="text-muted-foreground mt-1 block text-sm"
                      >
                        {field.helpText}
                      </span>
                    {/if}
                  </span>
                </label>
              {:else}
                <Label for={controlId}>
                  {field.label}
                  <span class="text-muted-foreground ml-1 text-xs font-normal">
                    {field.required ? t('register.required') : t('register.optional')}
                  </span>
                </Label>
                {#if field.helpText}
                  <p id={`${controlId}-help`} class="text-muted-foreground text-sm">
                    {field.helpText}
                  </p>
                {/if}
                {#if field.type === 'textarea'}
                  <textarea
                    id={controlId}
                    name={field.key}
                    rows="5"
                    maxlength={registrationTextareaLimit}
                    required={field.required}
                    aria-describedby={[
                      field.helpText ? `${controlId}-help` : '',
                      fieldError ? `${controlId}-error` : ''
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined}
                    aria-invalid={fieldError ? 'true' : undefined}
                    class="border-input bg-background min-h-32 w-full resize-y rounded-md border px-3 py-2 text-base"
                    >{String($form[field.key] ?? '')}</textarea
                  >
                {:else if field.type === 'select'}
                  <select
                    id={controlId}
                    name={field.key}
                    required={field.required}
                    aria-describedby={[
                      field.helpText ? `${controlId}-help` : '',
                      fieldError ? `${controlId}-error` : ''
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined}
                    aria-invalid={fieldError ? 'true' : undefined}
                    class="border-input bg-background min-h-12 rounded-md border px-3 text-base"
                  >
                    <option value="" selected={!$form[field.key]}
                      >{t('register.select_prompt')}</option
                    >
                    {#each field.options as option (option.id)}
                      <option value={option.id} selected={$form[field.key] === option.id}>
                        {option.label}
                      </option>
                    {/each}
                  </select>
                {:else}
                  <Input
                    id={controlId}
                    name={field.key}
                    value={String($form[field.key] ?? '')}
                    maxlength={registrationTextLimit}
                    required={field.required}
                    aria-describedby={[
                      field.helpText ? `${controlId}-help` : '',
                      fieldError ? `${controlId}-error` : ''
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined}
                    aria-invalid={fieldError ? 'true' : undefined}
                  />
                {/if}
              {/if}
              {#if fieldError}
                <p id={`${controlId}-error`} class="text-destructive text-sm" role="alert">
                  {fieldError}
                </p>
              {/if}
            </div>
          {/each}

          <div class="border-border mt-2 border-t pt-6">
            <p class="text-muted-foreground mb-4 text-sm leading-6">
              {t('register.assent_before')}
              <a class="font-medium underline" href={resolve('/terms')}
                >{t('register.terms_link')}</a
              >
              {t('register.assent_after')}
            </p>
            <Button type="submit" size="lg">{t('register.submit')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  {/if}
</div>
