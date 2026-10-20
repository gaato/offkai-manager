<script lang="ts">
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { superForm } from 'sveltekit-superforms';
  import { translator } from '$lib/i18n';
  import {
    collectionStatusLabelKey,
    paymentConfirmationLabelKey,
    paymentConfirmations,
    paymentRequestStatusLabelKey,
    paymentTimingLabelKey,
    paymentTimings
  } from '$lib/shared/payment';
  import { Alert } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import CopyField from '$lib/components/copy-field.svelte';

  type PendingAction =
    | { type: 'confirm'; requestId: string; methodId: string }
    | { type: 'waive'; requestId: string }
    | { type: 'refund'; recordId: string };
  type ActionResult = {
    pendingAction?: PendingAction;
    actionError?: string;
    actionMessage?: string;
  } | null;

  let { data, form: rawActionResult } = $props();
  const actionResult = $derived(rawActionResult as ActionResult);
  const t = $derived(translator(data.locale));
  const collectionSuperForm = superForm(untrack(() => data.collectionForm));
  const {
    form: collectionForm,
    errors: collectionErrors,
    message: collectionMessage,
    enhance: enhanceCollection
  } = collectionSuperForm;
  const methodSuperForm = superForm(untrack(() => data.methodForm));
  const {
    form: methodForm,
    errors: methodErrors,
    message: methodMessage,
    enhance: enhanceMethod
  } = methodSuperForm;
  const collection = $derived(data.dashboard.collection);
  const editable = $derived(data.capabilities.canManageCollection && !data.event.archivedAt);
  const manualMethods = $derived(
    data.dashboard.methods.filter((method) => method.enabled && method.confirmation === 'manual')
  );
  const waiverEnabled = $derived(
    data.dashboard.methods.some(
      (method) => method.enabled && method.timing === 'none' && method.confirmation === 'none'
    )
  );
  const pendingRequest = $derived(
    actionResult?.pendingAction && actionResult.pendingAction.type !== 'refund'
      ? data.dashboard.requests.find(
          (request) =>
            request.id ===
            (actionResult.pendingAction?.type !== 'refund'
              ? actionResult.pendingAction?.requestId
              : '')
        )
      : undefined
  );
  const pendingConflict = $derived(
    actionResult?.pendingAction?.type === 'refund'
      ? data.dashboard.conflicts.find(
          (conflict) =>
            conflict.recordId ===
            (actionResult.pendingAction?.type === 'refund'
              ? actionResult.pendingAction.recordId
              : '')
        )
      : undefined
  );
  const pendingMethod = $derived(
    actionResult?.pendingAction?.type === 'confirm'
      ? data.dashboard.methods.find(
          (method) =>
            method.id ===
            (actionResult.pendingAction?.type === 'confirm'
              ? actionResult.pendingAction.methodId
              : '')
        )
      : undefined
  );
  const paymentsHref = $derived(
    resolve('/app/events/[eventId]/payments', { eventId: data.event.id })
  );
</script>

<svelte:head>
  <title>{t('payments.title')} · {data.event.title} · {t('brand.name')}</title>
</svelte:head>

<div class="grid gap-6">
  <div>
    <h2 class="text-xl font-bold">{t('payments.title')}</h2>
    <p class="text-muted-foreground mt-2 max-w-2xl">{t('payments.intro')}</p>
  </div>

  {#if actionResult?.actionError}
    <Alert class="border-destructive text-destructive" role="alert">
      {actionResult.actionError}
    </Alert>
  {:else if actionResult?.actionMessage}
    <Alert class="border-primary/35 bg-secondary/50" role="status">
      {actionResult.actionMessage}
    </Alert>
  {/if}
  {#if $collectionMessage}
    <Alert
      class={$collectionMessage === t('payments.success_create') ||
      $collectionMessage === t('payments.success_update')
        ? 'border-primary/35 bg-secondary/50'
        : 'border-destructive text-destructive'}
      role={$collectionMessage === t('payments.success_create') ||
      $collectionMessage === t('payments.success_update')
        ? 'status'
        : 'alert'}
    >
      {$collectionMessage}
    </Alert>
  {/if}
  {#if $methodMessage}
    <Alert
      class={$methodMessage === t('payments.success_method')
        ? 'border-primary/35 bg-secondary/50'
        : 'border-destructive text-destructive'}
      role={$methodMessage === t('payments.success_method') ? 'status' : 'alert'}
    >
      {$methodMessage}
    </Alert>
  {/if}

  {#if !collection}
    <Card class="shadow-none">
      <CardHeader>
        <CardTitle>{t('payments.create_title')}</CardTitle>
        <p class="text-muted-foreground mt-2 text-sm">{t('payments.create_intro')}</p>
      </CardHeader>
      <CardContent>
        <form method="POST" action="?/create" use:enhanceCollection class="grid gap-6">
          <div class="grid gap-2">
            <Label for="collection-title">{t('payments.collection_title')}</Label>
            <Input
              id="collection-title"
              name="title"
              bind:value={$collectionForm.title}
              required
              maxlength={200}
              disabled={!editable}
            />
            {#if $collectionErrors.title}
              <p class="text-destructive text-sm" role="alert">{$collectionErrors.title[0]}</p>
            {/if}
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="collection-amount">{t('payments.amount_yen')}</Label>
              <Input
                id="collection-amount"
                name="amountYen"
                inputmode="numeric"
                pattern="[0-9]+"
                bind:value={$collectionForm.amountYen}
                required
                disabled={!editable}
              />
              {#if $collectionErrors.amountYen}
                <p class="text-destructive text-sm" role="alert">
                  {$collectionErrors.amountYen[0]}
                </p>
              {/if}
            </div>
            <div class="grid gap-2">
              <Label for="collection-due">{t('payments.due_at')}</Label>
              <Input
                id="collection-due"
                name="dueAt"
                type="datetime-local"
                bind:value={$collectionForm.dueAt}
                disabled={!editable}
              />
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="collection-instructions">{t('payments.instructions')}</Label>
            <textarea
              id="collection-instructions"
              name="instructions"
              bind:value={$collectionForm.instructions}
              rows={4}
              maxlength={10000}
              disabled={!editable}
              class="border-input bg-background min-h-24 w-full resize-y rounded-md border px-3 py-2 text-base"
            ></textarea>
          </div>
          {#if editable}
            <Button type="submit" class="justify-self-start">{t('payments.create_submit')}</Button>
          {/if}
        </form>
      </CardContent>
    </Card>
  {:else}
    <section aria-labelledby="payment-summary-title">
      <h2 id="payment-summary-title" class="sr-only">{t('payments.metrics_title')}</h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {#each data.dashboard.metrics as metric (metric.key)}
          <Card class="shadow-none">
            <CardContent class="pt-6">
              <p class="text-muted-foreground text-sm font-semibold">
                {metric.key === 'target'
                  ? t('payments.metric_target')
                  : metric.key === 'paid'
                    ? t('payments.metric_paid')
                    : metric.key === 'unpaid'
                      ? t('payments.metric_unpaid')
                      : t('payments.metric_waived')}
              </p>
              <p class="mt-2 text-2xl font-bold tabular-nums">{metric.amount}</p>
              <p class="text-muted-foreground mt-1 text-sm">
                {t('payments.metric_count', { count: metric.count })}
              </p>
            </CardContent>
          </Card>
        {/each}
      </div>
    </section>

    {#if data.dashboard.consentMissing}
      <Alert class="border-amber-600/50 bg-amber-50 text-amber-950" role="status">
        {t('payments.consent_missing')}
      </Alert>
    {/if}

    {#if data.dashboard.reminder}
      <Card class="shadow-none">
        <CardHeader>
          <CardTitle>{t('payments.reminder_title')}</CardTitle>
          <p class="text-muted-foreground mt-2 text-sm">{t('payments.reminder_intro')}</p>
        </CardHeader>
        <CardContent>
          <CopyField
            id="payment-reminder"
            label={t('payments.reminder_label')}
            value={data.dashboard.reminder}
            copyLabel={t('payments.reminder_copy')}
            copiedLabel={t('payments.reminder_copied')}
          />
        </CardContent>
      </Card>
    {/if}

    {#if actionResult?.pendingAction && pendingRequest}
      <Alert
        class="border-primary/45 bg-background p-5"
        role="region"
        aria-labelledby="payment-confirm-title"
      >
        <h2 id="payment-confirm-title" class="font-bold">
          {actionResult.pendingAction.type === 'confirm'
            ? t('payments.confirm_title')
            : t('payments.waive_title')}
        </h2>
        <p class="text-muted-foreground mt-2">
          {#if actionResult.pendingAction.type === 'confirm' && pendingMethod}
            {t('payments.confirm_body', {
              name: pendingRequest.displayName,
              method: pendingMethod.label
            })}
          {:else}
            {t('payments.waive_body', { name: pendingRequest.displayName })}
          {/if}
        </p>
        {#if actionResult.pendingAction.type === 'confirm' && pendingMethod}
          <form method="POST" action="?/confirmManual" class="mt-5 grid gap-4">
            <input type="hidden" name="requestId" value={pendingRequest.id} />
            <input type="hidden" name="methodId" value={pendingMethod.id} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={`payment-confirm:${pendingRequest.id}`}
            />
            <div class="grid gap-2 sm:grid-cols-2">
              <div class="grid gap-2">
                <Label for="external-reference">{t('payments.external_reference')}</Label>
                <Input id="external-reference" name="externalReference" maxlength={500} />
              </div>
              <div class="grid gap-2">
                <Label for="payment-note">{t('payments.note')}</Label>
                <Input id="payment-note" name="note" maxlength={2000} />
              </div>
            </div>
            <div class="flex flex-wrap gap-3">
              <Button type="submit">{t('payments.confirm_submit')}</Button>
              <a
                class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
                href={paymentsHref}
              >
                {t('form.cancel')}
              </a>
            </div>
          </form>
        {:else}
          <form method="POST" action="?/waive" class="mt-5 grid gap-4">
            <input type="hidden" name="requestId" value={pendingRequest.id} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={`payment-waive:${pendingRequest.id}`}
            />
            <div class="grid gap-2">
              <Label for="waive-reason">{t('payments.waive_reason')}</Label>
              <Input id="waive-reason" name="reason" required maxlength={2000} />
            </div>
            <div class="flex flex-wrap gap-3">
              <Button type="submit">{t('payments.waive_submit')}</Button>
              <a
                class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
                href={paymentsHref}
              >
                {t('form.cancel')}
              </a>
            </div>
          </form>
        {/if}
      </Alert>
    {/if}

    {#if actionResult?.pendingAction?.type === 'refund' && pendingConflict}
      <Alert
        class="border-destructive/50 bg-background p-5"
        role="region"
        aria-labelledby="refund-confirm-title"
      >
        <h2 id="refund-confirm-title" class="font-bold">{t('payments.refund_confirm_title')}</h2>
        <p class="text-muted-foreground mt-2">
          {t('payments.refund_confirm_body', {
            name: pendingConflict.displayName,
            amount: pendingConflict.amount
          })}
        </p>
        <form method="POST" action="?/markRefunded" class="mt-5 grid gap-4">
          <input type="hidden" name="recordId" value={pendingConflict.recordId} />
          <div class="grid gap-2">
            <Label for="refund-note">{t('payments.refund_note')}</Label>
            <Input id="refund-note" name="note" maxlength={2000} />
          </div>
          <div class="flex flex-wrap gap-3">
            <Button type="submit" variant="destructive">{t('payments.refund_confirm')}</Button>
            <a
              class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
              href={paymentsHref}
            >
              {t('form.cancel')}
            </a>
          </div>
        </form>
      </Alert>
    {/if}

    {#if data.dashboard.conflicts.length > 0}
      <Card class="border-destructive/50 shadow-none">
        <CardHeader>
          <CardTitle>{t('payments.conflict_title')}</CardTitle>
          <p class="text-muted-foreground mt-2 text-sm">{t('payments.conflict_intro')}</p>
        </CardHeader>
        <CardContent>
          <ul class="grid list-none gap-3" role="list">
            {#each data.dashboard.conflicts as conflict (conflict.recordId)}
              <li class="rounded-lg border p-4">
                <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p class="font-semibold">
                      {t('payments.conflict_row', {
                        name: conflict.displayName,
                        amount: conflict.amount
                      })}
                    </p>
                    <p class="text-muted-foreground mt-1 text-sm">
                      {t('payments.conflict_detail', {
                        status: t(paymentRequestStatusLabelKey(conflict.requestStatus)),
                        occurredAt: conflict.occurredAt
                      })}
                    </p>
                  </div>
                  {#if data.capabilities.canWaivePayments}
                    <form method="POST" action="?/prepareRefund">
                      <input type="hidden" name="recordId" value={conflict.recordId} />
                      <Button type="submit" variant="destructive">
                        {t('payments.prepare_refund')}
                      </Button>
                    </form>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        </CardContent>
      </Card>
    {/if}

    <Card class="shadow-none">
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>{t('payments.settings_title')}</CardTitle>
            <p class="text-muted-foreground mt-2 text-sm">{t('payments.settings_intro')}</p>
          </div>
          <Badge class="bg-secondary text-secondary-foreground">
            {t(collectionStatusLabelKey(collection.status))}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form method="POST" action="?/update" use:enhanceCollection class="grid gap-6">
          <div class="grid gap-2">
            <Label for="collection-title">{t('payments.collection_title')}</Label>
            <Input
              id="collection-title"
              name="title"
              bind:value={$collectionForm.title}
              required
              maxlength={200}
              disabled={!editable}
            />
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="collection-amount">{t('payments.amount_yen')}</Label>
              <Input
                id="collection-amount"
                name="amountYen"
                inputmode="numeric"
                pattern="[0-9]+"
                bind:value={$collectionForm.amountYen}
                required
                disabled={!editable || data.dashboard.amountFrozen}
                aria-describedby={data.dashboard.amountFrozen ? 'amount-frozen-note' : undefined}
              />
              {#if data.dashboard.amountFrozen}
                <p id="amount-frozen-note" class="text-muted-foreground text-sm">
                  {t('payments.amount_frozen')}
                </p>
              {/if}
            </div>
            <div class="grid gap-2">
              <Label for="collection-due">{t('payments.due_at')}</Label>
              <Input
                id="collection-due"
                name="dueAt"
                type="datetime-local"
                bind:value={$collectionForm.dueAt}
                disabled={!editable}
              />
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="collection-instructions">{t('payments.instructions')}</Label>
            <textarea
              id="collection-instructions"
              name="instructions"
              bind:value={$collectionForm.instructions}
              rows={4}
              maxlength={10000}
              disabled={!editable}
              class="border-input bg-background min-h-24 w-full resize-y rounded-md border px-3 py-2 text-base"
            ></textarea>
          </div>
          {#if editable}
            <Button type="submit" class="justify-self-start">{t('form.save')}</Button>
          {/if}
        </form>
        {#if editable && collection.status !== 'archived'}
          <form method="POST" action="?/status" class="mt-3">
            {#if collection.status === 'draft'}
              <Button type="submit" name="target" value="open" variant="secondary">
                {t('payments.open')}
              </Button>
            {:else if collection.status === 'open'}
              <Button type="submit" name="target" value="closed" variant="outline">
                {t('payments.close')}
              </Button>
            {:else if collection.status === 'closed'}
              <Button type="submit" name="target" value="open" variant="secondary">
                {t('payments.reopen')}
              </Button>
            {/if}
          </form>
        {/if}
      </CardContent>
    </Card>

    <Card class="shadow-none">
      <CardHeader>
        <CardTitle>{t('payments.methods_title')}</CardTitle>
        <p class="text-muted-foreground mt-2 text-sm">{t('payments.methods_intro')}</p>
      </CardHeader>
      <CardContent class="grid gap-6">
        {#if data.dashboard.methods.length === 0}
          <p class="text-muted-foreground">{t('payments.method_empty')}</p>
        {:else}
          <ul class="grid list-none gap-3" role="list">
            {#each data.dashboard.methods as method (method.id)}
              <li class="rounded-lg border p-4">
                <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p class="font-semibold">{method.label}</p>
                    {#if method.instructions}
                      <p class="text-muted-foreground mt-1 text-sm">{method.instructions}</p>
                    {/if}
                    <div class="mt-3 flex flex-wrap gap-2">
                      <Badge class="bg-secondary text-secondary-foreground">
                        {t(paymentTimingLabelKey(method.timing))}
                      </Badge>
                      <Badge class="bg-secondary text-secondary-foreground">
                        {t(paymentConfirmationLabelKey(method.confirmation))}
                      </Badge>
                      <Badge class="bg-muted text-muted-foreground">
                        {method.enabled
                          ? t('payments.method_enabled_label')
                          : t('payments.method_disabled_label')}
                      </Badge>
                    </div>
                  </div>
                  {#if editable}
                    <div class="flex flex-wrap gap-2">
                      <a
                        class="hover:bg-accent inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-semibold"
                        href={`${paymentsHref}?editMethod=${method.id}`}
                      >
                        {t('payments.method_edit_link', { name: method.label })}
                      </a>
                      {#if method.enabled}
                        <form method="POST" action="?/archiveMethod">
                          <input type="hidden" name="methodId" value={method.id} />
                          <Button type="submit" size="sm" variant="ghost">
                            {t('payments.method_archive')}
                          </Button>
                        </form>
                      {/if}
                    </div>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        {#if editable}
          <form
            method="POST"
            action="?/upsertMethod"
            use:enhanceMethod
            class="grid gap-5 border-t pt-6"
          >
            <h3 class="font-semibold">
              {$methodForm.methodId ? t('payments.method_edit') : t('payments.method_add')}
            </h3>
            <input type="hidden" name="methodId" bind:value={$methodForm.methodId} />
            <div class="grid gap-2">
              <Label for="method-label">{t('payments.method_label')}</Label>
              <Input
                id="method-label"
                name="label"
                bind:value={$methodForm.label}
                required
                maxlength={100}
              />
              {#if $methodErrors.label}
                <p class="text-destructive text-sm" role="alert">{$methodErrors.label[0]}</p>
              {/if}
            </div>
            <div class="grid gap-5 sm:grid-cols-3">
              <div class="grid gap-2">
                <Label for="method-timing">{t('payments.method_timing')}</Label>
                <select
                  id="method-timing"
                  name="timing"
                  bind:value={$methodForm.timing}
                  class="border-input bg-background min-h-12 rounded-md border px-3 text-base"
                >
                  {#each paymentTimings as timing (timing)}
                    <option value={timing}>{t(paymentTimingLabelKey(timing))}</option>
                  {/each}
                </select>
              </div>
              <div class="grid gap-2">
                <Label for="method-confirmation">{t('payments.method_confirmation')}</Label>
                <select
                  id="method-confirmation"
                  name="confirmation"
                  bind:value={$methodForm.confirmation}
                  class="border-input bg-background min-h-12 rounded-md border px-3 text-base"
                >
                  {#each paymentConfirmations as confirmation (confirmation)}
                    <option value={confirmation}
                      >{t(paymentConfirmationLabelKey(confirmation))}</option
                    >
                  {/each}
                </select>
              </div>
              <div class="grid gap-2">
                <Label for="method-order">{t('payments.method_sort_order')}</Label>
                <Input
                  id="method-order"
                  name="sortOrder"
                  type="number"
                  step="1"
                  bind:value={$methodForm.sortOrder}
                />
              </div>
            </div>
            <div class="grid gap-2">
              <Label for="method-instructions">{t('payments.method_instructions')}</Label>
              <textarea
                id="method-instructions"
                name="instructions"
                bind:value={$methodForm.instructions}
                rows={3}
                maxlength={5000}
                class="border-input bg-background min-h-20 w-full resize-y rounded-md border px-3 py-2 text-base"
              ></textarea>
            </div>
            <label class="flex min-h-12 items-center gap-3">
              <input type="checkbox" name="enabled" bind:checked={$methodForm.enabled} />
              <span class="font-medium">{t('payments.method_enabled')}</span>
            </label>
            <div class="flex flex-wrap gap-3">
              <Button type="submit">{t('form.save')}</Button>
              {#if $methodForm.methodId}
                <a
                  class="hover:bg-accent inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
                  href={paymentsHref}
                >
                  {t('payments.method_cancel_edit')}
                </a>
              {/if}
            </div>
          </form>
        {/if}
      </CardContent>
    </Card>

    <Card class="shadow-none">
      <CardHeader><CardTitle>{t('payments.requests_title')}</CardTitle></CardHeader>
      <CardContent>
        {#if data.dashboard.requests.length === 0}
          <p class="text-muted-foreground">{t('payments.request_empty')}</p>
        {:else}
          <div class="overflow-x-auto rounded-xl border">
            <table class="w-full min-w-[52rem] border-collapse text-left">
              <caption class="sr-only">{t('payments.requests_caption')}</caption>
              <thead class="bg-muted/65 text-sm">
                <tr>
                  <th class="px-4 py-3 font-semibold" scope="col">{t('payments.request_name')}</th>
                  <th class="px-4 py-3 font-semibold" scope="col">{t('payments.request_status')}</th
                  >
                  <th class="px-4 py-3 font-semibold" scope="col">{t('payments.request_method')}</th
                  >
                  <th class="px-4 py-3 font-semibold" scope="col">{t('payments.request_amount')}</th
                  >
                  <th class="px-4 py-3 font-semibold" scope="col"
                    >{t('payments.request_actions')}</th
                  >
                </tr>
              </thead>
              <tbody>
                {#each data.dashboard.requests as request (request.id)}
                  <tr class="border-t">
                    <th class="px-4 py-4 font-semibold" scope="row">{request.displayName}</th>
                    <td class="px-4 py-4">
                      <Badge class="bg-secondary text-secondary-foreground">
                        {t(paymentRequestStatusLabelKey(request.status))}
                      </Badge>
                    </td>
                    <td class="px-4 py-4">{request.methodLabel}</td>
                    <td class="px-4 py-4 font-medium tabular-nums">{request.amount}</td>
                    <td class="px-4 py-4">
                      {#if request.status === 'pending' || request.status === 'payment_pending'}
                        <div class="grid gap-2">
                          {#if data.capabilities.canRecordPayments && manualMethods.length > 0}
                            <form
                              method="POST"
                              action="?/prepareConfirm"
                              class="flex flex-wrap gap-2"
                            >
                              <input type="hidden" name="requestId" value={request.id} />
                              <select
                                name="methodId"
                                aria-label={t('payments.request_method')}
                                class="border-input bg-background min-h-10 rounded-md border px-2 text-sm"
                              >
                                {#each manualMethods as method (method.id)}
                                  <option value={method.id}>{method.label}</option>
                                {/each}
                              </select>
                              <Button type="submit" size="sm" variant="outline">
                                {t('payments.prepare_confirm')}
                              </Button>
                            </form>
                          {/if}
                          {#if data.capabilities.canWaivePayments && waiverEnabled}
                            <form method="POST" action="?/prepareWaive">
                              <input type="hidden" name="requestId" value={request.id} />
                              <Button type="submit" size="sm" variant="ghost">
                                {t('payments.prepare_waive')}
                              </Button>
                            </form>
                          {/if}
                          {#if request.methodLabel === t('payments.default_method.card.label')}
                            <p class="text-muted-foreground max-w-56 text-xs">
                              {t('payments.coming_with_settlement')}
                            </p>
                          {/if}
                        </div>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
