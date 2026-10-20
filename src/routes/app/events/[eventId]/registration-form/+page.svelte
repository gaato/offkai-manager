<script lang="ts">
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import { formFieldTypeLabelKey, formFieldTypes } from '$lib/shared/registration-form';
  import { Alert } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  let { data, form: actionResult } = $props();
  const t = $derived(translator(data.locale));
  const fieldForm = superForm(untrack(() => data.form));
  const { form, errors, message, enhance } = fieldForm;
  let enhanced = $state(false);
  const editable = $derived(
    data.capabilities.canManageRegistrationForm && !data.event.cancelledAt && !data.event.archivedAt
  );
  const activeFields = $derived(data.fields.filter((field) => !field.archivedAt));
  const archivedFields = $derived(data.fields.filter((field) => field.archivedAt));
  const formHref = $derived(
    resolve('/app/events/[eventId]/registration-form', { eventId: data.event.id })
  );
  const editing = $derived(Boolean($form.fieldId));
  const optionField = $derived($form.fieldType === 'select' || $form.fieldType === 'multiselect');

  $effect(() => {
    enhanced = true;
    if ($form.fieldType === 'consent') $form.required = true;
  });
</script>

<svelte:head
  ><title>{t('registration_form.title')} · {data.event.title} · {t('brand.name')}</title
  ></svelte:head
>

<div class="grid gap-6">
  <Card class="shadow-none">
    <CardHeader>
      <CardTitle>{t('registration_form.title')}</CardTitle>
      <p class="text-muted-foreground mt-2 text-sm">{t('registration_form.intro')}</p>
    </CardHeader>
    <CardContent>
      {#if data.event.cancelledAt || data.event.archivedAt}
        <Alert class="mb-5" role="status">{t('registration_form.frozen')}</Alert>
      {:else if !data.capabilities.canManageRegistrationForm}
        <Alert class="mb-5" role="status">{t('registration_form.read_only')}</Alert>
      {/if}
      {#if actionResult?.actionMessage}
        <Alert class="border-primary/35 bg-secondary/50 mb-5" role="status"
          >{actionResult.actionMessage}</Alert
        >
      {/if}
      {#if actionResult?.actionError}
        <Alert class="border-destructive text-destructive mb-5" role="alert"
          >{actionResult.actionError}</Alert
        >
      {/if}
      {#if $message}
        <Alert
          class={$message === t('registration_form.success_upsert')
            ? 'border-primary/35 bg-secondary/50 mb-5'
            : 'border-destructive text-destructive mb-5'}
          role={$message === t('registration_form.success_upsert') ? 'status' : 'alert'}
          >{$message}</Alert
        >
      {/if}

      <section aria-labelledby="current-fields-title">
        <h2 id="current-fields-title" class="text-lg font-semibold">
          {t('registration_form.fields_title')}
        </h2>
        {#if activeFields.length === 0}
          <p class="text-muted-foreground mt-3 text-sm">{t('registration_form.empty')}</p>
        {:else}
          <ol class="mt-4 grid list-none gap-3">
            {#each activeFields as field, index (field.id)}
              <li>
                <article class="border-border rounded-lg border p-4">
                  <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0">
                      <h3 class="font-semibold break-words">{field.label}</h3>
                      {#if field.helpText}
                        <p class="text-muted-foreground mt-1 text-sm">{field.helpText}</p>
                      {/if}
                      <div class="mt-3 flex flex-wrap gap-2">
                        <Badge class="bg-secondary text-secondary-foreground">
                          {t(formFieldTypeLabelKey(field.type))}
                        </Badge>
                        <Badge class="bg-muted text-muted-foreground">
                          {field.required
                            ? t('registration_form.required')
                            : t('registration_form.optional')}
                        </Badge>
                      </div>
                      {#if field.options.length > 0}
                        <div class="mt-3">
                          <p class="text-muted-foreground text-xs font-semibold">
                            {t('registration_form.options')}
                          </p>
                          <ul class="mt-2 flex list-none flex-wrap gap-2">
                            {#each field.options as option (option.id)}
                              <li class="bg-muted rounded-full px-3 py-1 text-sm">
                                {option.label}
                              </li>
                            {/each}
                          </ul>
                        </div>
                      {/if}
                    </div>
                    {#if editable}
                      <div class="flex flex-wrap items-center gap-2">
                        <form method="POST" action="?/reorder">
                          <input type="hidden" name="fieldId" value={field.id} />
                          <input type="hidden" name="direction" value="up" />
                          <Button type="submit" variant="outline" size="sm" disabled={index === 0}>
                            {t('registration_form.move_up')}
                          </Button>
                        </form>
                        <form method="POST" action="?/reorder">
                          <input type="hidden" name="fieldId" value={field.id} />
                          <input type="hidden" name="direction" value="down" />
                          <Button
                            type="submit"
                            variant="outline"
                            size="sm"
                            disabled={index === activeFields.length - 1}
                          >
                            {t('registration_form.move_down')}
                          </Button>
                        </form>
                        <a
                          class="border-input hover:bg-accent inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium"
                          href={`${formHref}?edit=${field.id}`}>{t('registration_form.edit')}</a
                        >
                        <details class="relative">
                          <summary
                            class="border-input hover:bg-accent inline-flex min-h-9 cursor-pointer list-none items-center rounded-md border px-3 text-sm font-medium"
                            >{t('registration_form.archive')}</summary
                          >
                          <div
                            class="bg-background border-border absolute right-0 z-10 mt-2 w-72 rounded-lg border p-4 shadow-lg"
                          >
                            <p class="text-sm">{t('registration_form.archive_question')}</p>
                            <form method="POST" action="?/archive" class="mt-3">
                              <input type="hidden" name="fieldId" value={field.id} />
                              <Button type="submit" variant="destructive" size="sm">
                                {t('registration_form.archive_confirm')}
                              </Button>
                            </form>
                          </div>
                        </details>
                      </div>
                    {/if}
                  </div>
                </article>
              </li>
            {/each}
          </ol>
        {/if}
      </section>

      <details class="border-border mt-6 rounded-lg border p-4">
        <summary class="min-h-8 cursor-pointer font-semibold">
          {t('registration_form.archived_title')} ({archivedFields.length})
        </summary>
        {#if archivedFields.length === 0}
          <p class="text-muted-foreground mt-3 text-sm">
            {t('registration_form.archived_empty')}
          </p>
        {:else}
          <ul class="mt-4 grid list-none gap-3">
            {#each archivedFields as field (field.id)}
              <li class="bg-muted/50 rounded-md p-3">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium">{field.label}</span>
                  <Badge class="bg-muted text-muted-foreground">
                    {t(formFieldTypeLabelKey(field.type))}
                  </Badge>
                  <Badge class="bg-muted text-muted-foreground">
                    {t('registration_form.archived_badge')}
                  </Badge>
                </div>
                {#if field.options.length > 0}
                  <ul class="mt-2 flex list-none flex-wrap gap-2">
                    {#each field.options as option (option.id)}
                      <li class="bg-background rounded-full px-3 py-1 text-sm">{option.label}</li>
                    {/each}
                  </ul>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </details>
    </CardContent>
  </Card>

  {#if editable}
    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
      <Card class="shadow-none">
        <CardHeader>
          <CardTitle>
            {editing ? t('registration_form.edit_title') : t('registration_form.add_title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="POST" action="?/upsert" use:enhance class="grid gap-5">
            <input type="hidden" name="fieldId" bind:value={$form.fieldId} />
            <div class="grid gap-2">
              <Label for="registration-field-label">{t('registration_form.label')}</Label>
              <Input
                id="registration-field-label"
                name="label"
                bind:value={$form.label}
                required
                maxlength={200}
                aria-describedby={$errors.label ? 'registration-field-label-error' : undefined}
              />
              {#if $errors.label}
                <p
                  id="registration-field-label-error"
                  class="text-destructive text-sm"
                  role="alert"
                >
                  {$errors.label[0]}
                </p>
              {/if}
            </div>
            <div class="grid gap-2">
              <Label for="registration-field-type">{t('registration_form.field_type')}</Label>
              <select
                id="registration-field-type"
                name="fieldType"
                bind:value={$form.fieldType}
                class="border-input bg-background min-h-12 rounded-md border px-3 text-base"
              >
                {#each formFieldTypes as type (type)}
                  <option value={type}>{t(formFieldTypeLabelKey(type))}</option>
                {/each}
              </select>
            </div>
            <label class="border-input flex min-h-12 items-center gap-3 rounded-md border px-4">
              <input
                type="checkbox"
                name="required"
                bind:checked={$form.required}
                disabled={$form.fieldType === 'consent'}
              />
              <span>{t('registration_form.required_answer')}</span>
            </label>
            <div class="grid gap-2">
              <Label for="registration-field-help">{t('registration_form.help_text')}</Label>
              <Input
                id="registration-field-help"
                name="helpText"
                bind:value={$form.helpText}
                maxlength={2000}
              />
            </div>
            {#if !enhanced || optionField}
              <div class="grid gap-2">
                <Label for="registration-field-options">
                  {t('registration_form.option_labels')}
                </Label>
                <textarea
                  id="registration-field-options"
                  name="options"
                  bind:value={$form.options}
                  rows={6}
                  maxlength={20000}
                  aria-describedby="registration-field-options-help registration-field-options-error"
                  class="border-input bg-background min-h-32 w-full resize-y rounded-md border px-3 py-2 text-base"
                ></textarea>
                <p id="registration-field-options-help" class="text-muted-foreground text-sm">
                  {t('registration_form.options_help')}
                </p>
                {#if $errors.options}
                  <p
                    id="registration-field-options-error"
                    class="text-destructive text-sm"
                    role="alert"
                  >
                    {$errors.options[0]}
                  </p>
                {/if}
              </div>
            {/if}
            <div class="flex flex-wrap gap-3">
              <Button type="submit">
                {editing ? t('registration_form.edit_submit') : t('registration_form.add_submit')}
              </Button>
              {#if editing}
                <a
                  class="border-input hover:bg-accent inline-flex min-h-10 items-center rounded-md border px-4 font-medium"
                  href={formHref}>{t('registration_form.cancel_edit')}</a
                >
              {/if}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card class="shadow-none">
        <CardHeader>
          <CardTitle>{t('registration_form.presets_title')}</CardTitle>
          <p class="text-muted-foreground mt-2 text-sm">
            {t('registration_form.presets_intro')}
          </p>
        </CardHeader>
        <CardContent class="grid gap-3">
          {#each data.presets as preset (preset.key)}
            <form method="POST" action="?/preset">
              <input type="hidden" name="presetKey" value={preset.key} />
              <Button
                type="submit"
                variant="outline"
                class="h-auto min-h-11 w-full justify-start text-left"
              >
                {t('registration_form.preset_add', { label: t(preset.labelKey) })}
              </Button>
            </form>
          {/each}
        </CardContent>
      </Card>
    </div>
  {/if}
</div>
