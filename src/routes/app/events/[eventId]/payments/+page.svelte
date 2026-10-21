<script lang="ts">
  import Confirmation from '$lib/components/confirmation.svelte';
  import SettingsPage from '$lib/components/page/settings-page.svelte';
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

<SettingsPage>
  {#snippet title()}{t('payments.title')}{/snippet}
  {#snippet body()}
    <div class="grid gap-6">
      <div>
        <p class="mt-2 max-w-2xl">{t('payments.intro')}</p>
      </div>

      {#if actionResult?.actionError}
        <div role="alert" class="alert alert-error">
          {actionResult.actionError}
        </div>
      {:else if actionResult?.actionMessage}
        <div role="status" class="alert alert-success">
          {actionResult.actionMessage}
        </div>
      {/if}
      {#if $collectionMessage}
        <div
          role={$collectionMessage === t('payments.success_create') ||
          $collectionMessage === t('payments.success_update')
            ? 'status'
            : 'alert'}
          class={($collectionMessage === t('payments.success_create') ||
          $collectionMessage === t('payments.success_update')
            ? 'status'
            : 'alert') === 'status'
            ? 'alert alert-success'
            : 'alert alert-error'}
        >
          {$collectionMessage}
        </div>
      {/if}
      {#if $methodMessage}
        <div
          role={$methodMessage === t('payments.success_method') ? 'status' : 'alert'}
          class={($methodMessage === t('payments.success_method') ? 'status' : 'alert') === 'status'
            ? 'alert alert-success'
            : 'alert alert-error'}
        >
          {$methodMessage}
        </div>
      {/if}

      {#if !collection}
        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <h2 class="card-title">{t('payments.create_title')}</h2>
            <p class="mt-2">{t('payments.create_intro')}</p>
          </div>
          <div class="card-body">
            <form method="POST" action="?/create" use:enhanceCollection class="grid gap-6">
              <div class="grid gap-2">
                <label for="collection-title" class="label">{t('payments.collection_title')}</label>
                <input
                  id="collection-title"
                  name="title"
                  bind:value={$collectionForm.title}
                  required
                  maxlength={200}
                  disabled={!editable}
                  class="input w-full"
                />
                {#if $collectionErrors.title}
                  <p role="alert">{$collectionErrors.title[0]}</p>
                {/if}
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <div class="grid gap-2">
                  <label for="collection-amount" class="label">{t('payments.amount_yen')}</label>
                  <input
                    id="collection-amount"
                    name="amountYen"
                    inputmode="numeric"
                    pattern="[0-9]+"
                    bind:value={$collectionForm.amountYen}
                    required
                    disabled={!editable}
                    class="input w-full"
                  />
                  {#if $collectionErrors.amountYen}
                    <p role="alert">
                      {$collectionErrors.amountYen[0]}
                    </p>
                  {/if}
                </div>
                <div class="grid gap-2">
                  <label for="collection-due" class="label">{t('payments.due_at')}</label>
                  <input
                    id="collection-due"
                    name="dueAt"
                    type="datetime-local"
                    bind:value={$collectionForm.dueAt}
                    disabled={!editable}
                    class="input w-full"
                  />
                </div>
              </div>
              <div class="grid gap-2">
                <label for="collection-instructions" class="label"
                  >{t('payments.instructions')}</label
                >
                <textarea
                  id="collection-instructions"
                  name="instructions"
                  bind:value={$collectionForm.instructions}
                  rows={4}
                  maxlength={10000}
                  disabled={!editable}
                  class="textarea bg-base-100 min-h-24 w-full px-3 py-2"
                ></textarea>
              </div>
              {#if editable}
                <button type="submit" class="btn btn-primary justify-self-start"
                  >{t('payments.create_submit')}</button
                >
              {/if}
            </form>
          </div>
        </div>
      {:else}
        <section aria-labelledby="payment-summary-title">
          <h2 id="payment-summary-title" class="card-title sr-only">
            {t('payments.metrics_title')}
          </h2>
          <div class="stats stats-vertical lg:stats-horizontal w-full">
            {#each data.dashboard.metrics as metric (metric.key)}
              <div class="stat" role="group" aria-labelledby={`payment-metric-${metric.key}`}>
                <p class="stat-title" id={`payment-metric-${metric.key}`}>
                  {metric.key === 'target'
                    ? t('payments.metric_target')
                    : metric.key === 'paid'
                      ? t('payments.metric_paid')
                      : metric.key === 'unpaid'
                        ? t('payments.metric_unpaid')
                        : t('payments.metric_waived')}
                </p>
                <p class="stat-value">{metric.amount}</p>
                <p class="stat-desc">
                  {t('payments.metric_count', { count: metric.count })}
                </p>
              </div>
            {/each}
          </div>
        </section>

        {#if data.dashboard.consentMissing}
          <div role="status" class="alert alert-warning">
            {t('payments.consent_missing')}
          </div>
        {/if}

        {#if data.dashboard.reminder}
          <div class="card card-border bg-base-100">
            <div class="card-body gap-2 pb-0">
              <h2 class="card-title">{t('payments.reminder_title')}</h2>
              <p class="mt-2">{t('payments.reminder_intro')}</p>
            </div>
            <div class="card-body">
              <CopyField
                id="payment-reminder"
                label={t('payments.reminder_label')}
                value={data.dashboard.reminder}
                copyLabel={t('payments.reminder_copy')}
                copiedLabel={t('payments.reminder_copied')}
              />
            </div>
          </div>
        {/if}

        {#if actionResult?.pendingAction && pendingRequest}
          <Confirmation
            label={actionResult.pendingAction.type === 'confirm'
              ? t('payments.confirm_title')
              : t('payments.waive_title')}
            cancelLabel={t('form.cancel')}
          >
            <p class="mt-2">
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
                    <label for="external-reference" class="label"
                      >{t('payments.external_reference')}</label
                    >
                    <input
                      id="external-reference"
                      name="externalReference"
                      maxlength={500}
                      class="input w-full"
                    />
                  </div>
                  <div class="grid gap-2">
                    <label for="payment-note" class="label">{t('payments.note')}</label>
                    <input id="payment-note" name="note" maxlength={2000} class="input w-full" />
                  </div>
                </div>
                <div class="flex flex-wrap gap-3">
                  <button type="submit" class="btn btn-primary"
                    >{t('payments.confirm_submit')}</button
                  >
                  <a href={paymentsHref} class="btn inline-flex min-h-12 items-center px-5">
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
                  <label for="waive-reason" class="label">{t('payments.waive_reason')}</label>
                  <input
                    id="waive-reason"
                    name="reason"
                    required
                    maxlength={2000}
                    class="input w-full"
                  />
                </div>
                <div class="flex flex-wrap gap-3">
                  <button type="submit" class="btn btn-primary">{t('payments.waive_submit')}</button
                  >
                  <a href={paymentsHref} class="btn inline-flex min-h-12 items-center px-5">
                    {t('form.cancel')}
                  </a>
                </div>
              </form>
            {/if}
          </Confirmation>
        {/if}

        {#if actionResult?.pendingAction?.type === 'refund' && pendingConflict}
          <Confirmation label={t('payments.refund_confirm_title')} cancelLabel={t('form.cancel')}>
            <p class="mt-2">
              {t('payments.refund_confirm_body', {
                name: pendingConflict.displayName,
                amount: pendingConflict.amount
              })}
            </p>
            <form method="POST" action="?/markRefunded" class="mt-5 grid gap-4">
              <input type="hidden" name="recordId" value={pendingConflict.recordId} />
              <div class="grid gap-2">
                <label for="refund-note" class="label">{t('payments.refund_note')}</label>
                <input id="refund-note" name="note" maxlength={2000} class="input w-full" />
              </div>
              <div class="flex flex-wrap gap-3">
                <button type="submit" class="btn btn-error">{t('payments.refund_confirm')}</button>
                <a href={paymentsHref} class="btn inline-flex min-h-12 items-center px-5">
                  {t('form.cancel')}
                </a>
              </div>
            </form>
          </Confirmation>
        {/if}

        {#if data.dashboard.conflicts.length > 0}
          <div class="card card-border bg-base-100">
            <div class="card-body gap-2 pb-0">
              <h2 class="card-title">{t('payments.conflict_title')}</h2>
              <p class="mt-2">{t('payments.conflict_intro')}</p>
            </div>
            <div class="card-body">
              <ul role="list" class="grid gap-3">
                {#each data.dashboard.conflicts as conflict (conflict.recordId)}
                  <li class="p-4">
                    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p>
                          {t('payments.conflict_row', {
                            name: conflict.displayName,
                            amount: conflict.amount
                          })}
                        </p>
                        <p class="mt-1">
                          {t('payments.conflict_detail', {
                            status: t(paymentRequestStatusLabelKey(conflict.requestStatus)),
                            occurredAt: conflict.occurredAt
                          })}
                        </p>
                      </div>
                      {#if data.capabilities.canWaivePayments}
                        <form method="POST" action="?/prepareRefund">
                          <input type="hidden" name="recordId" value={conflict.recordId} />
                          <button type="submit" class="btn btn-error">
                            {t('payments.prepare_refund')}
                          </button>
                        </form>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            </div>
          </div>
        {/if}

        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 class="card-title">{t('payments.settings_title')}</h2>
                <p class="mt-2">{t('payments.settings_intro')}</p>
              </div>
              <span class="badge badge-secondary">
                {t(collectionStatusLabelKey(collection.status))}
              </span>
            </div>
          </div>
          <div class="card-body">
            <form method="POST" action="?/update" use:enhanceCollection class="grid gap-6">
              <div class="grid gap-2">
                <label for="collection-title" class="label">{t('payments.collection_title')}</label>
                <input
                  id="collection-title"
                  name="title"
                  bind:value={$collectionForm.title}
                  required
                  maxlength={200}
                  disabled={!editable}
                  class="input w-full"
                />
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <div class="grid gap-2">
                  <label for="collection-amount" class="label">{t('payments.amount_yen')}</label>
                  <input
                    id="collection-amount"
                    name="amountYen"
                    inputmode="numeric"
                    pattern="[0-9]+"
                    bind:value={$collectionForm.amountYen}
                    required
                    disabled={!editable || data.dashboard.amountFrozen}
                    aria-describedby={data.dashboard.amountFrozen
                      ? 'amount-frozen-note'
                      : undefined}
                    class="input w-full"
                  />
                  {#if data.dashboard.amountFrozen}
                    <p id="amount-frozen-note">
                      {t('payments.amount_frozen')}
                    </p>
                  {/if}
                </div>
                <div class="grid gap-2">
                  <label for="collection-due" class="label">{t('payments.due_at')}</label>
                  <input
                    id="collection-due"
                    name="dueAt"
                    type="datetime-local"
                    bind:value={$collectionForm.dueAt}
                    disabled={!editable}
                    class="input w-full"
                  />
                </div>
              </div>
              <div class="grid gap-2">
                <label for="collection-instructions" class="label"
                  >{t('payments.instructions')}</label
                >
                <textarea
                  id="collection-instructions"
                  name="instructions"
                  bind:value={$collectionForm.instructions}
                  rows={4}
                  maxlength={10000}
                  disabled={!editable}
                  class="textarea bg-base-100 min-h-24 w-full px-3 py-2"
                ></textarea>
              </div>
              {#if editable}
                <button type="submit" class="btn btn-primary justify-self-start"
                  >{t('form.save')}</button
                >
              {/if}
            </form>
            {#if editable && collection.status !== 'archived'}
              <form method="POST" action="?/status" class="mt-3">
                {#if collection.status === 'draft'}
                  <button type="submit" name="target" value="open" class="btn btn-secondary">
                    {t('payments.open')}
                  </button>
                {:else if collection.status === 'open'}
                  <button type="submit" name="target" value="closed" class="btn btn-outline">
                    {t('payments.close')}
                  </button>
                {:else if collection.status === 'closed'}
                  <button type="submit" name="target" value="open" class="btn btn-secondary">
                    {t('payments.reopen')}
                  </button>
                {/if}
              </form>
            {/if}
          </div>
        </div>

        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <h2 class="card-title">{t('payments.methods_title')}</h2>
            <p class="mt-2">{t('payments.methods_intro')}</p>
          </div>
          <div class="card-body grid gap-6">
            {#if data.dashboard.methods.length === 0}
              <p>{t('payments.method_empty')}</p>
            {:else}
              <ul role="list" class="grid gap-3">
                {#each data.dashboard.methods as method (method.id)}
                  <li class="p-4">
                    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p>{method.label}</p>
                        {#if method.instructions}
                          <p class="mt-1">{method.instructions}</p>
                        {/if}
                        <div class="mt-3 flex flex-wrap gap-2">
                          <span class="badge badge-secondary">
                            {t(paymentTimingLabelKey(method.timing))}
                          </span>
                          <span class="badge badge-secondary">
                            {t(paymentConfirmationLabelKey(method.confirmation))}
                          </span>
                          <span class="badge badge-ghost">
                            {method.enabled
                              ? t('payments.method_enabled_label')
                              : t('payments.method_disabled_label')}
                          </span>
                        </div>
                      </div>
                      {#if editable}
                        <div class="flex flex-wrap gap-2">
                          <a
                            href={`${paymentsHref}?editMethod=${method.id}`}
                            class="btn btn-ghost inline-flex min-h-10 items-center px-3"
                          >
                            {t('payments.method_edit_link', { name: method.label })}
                          </a>
                          {#if method.enabled}
                            <form method="POST" action="?/archiveMethod">
                              <input type="hidden" name="methodId" value={method.id} />
                              <button type="submit" class="btn btn-ghost btn-sm">
                                {t('payments.method_archive')}
                              </button>
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
              <form method="POST" action="?/upsertMethod" use:enhanceMethod class="grid gap-5 pt-6">
                <h3 class="card-title">
                  {$methodForm.methodId ? t('payments.method_edit') : t('payments.method_add')}
                </h3>
                <input type="hidden" name="methodId" bind:value={$methodForm.methodId} />
                <div class="grid gap-2">
                  <label for="method-label" class="label">{t('payments.method_label')}</label>
                  <input
                    id="method-label"
                    name="label"
                    bind:value={$methodForm.label}
                    required
                    maxlength={100}
                    class="input w-full"
                  />
                  {#if $methodErrors.label}
                    <p role="alert">{$methodErrors.label[0]}</p>
                  {/if}
                </div>
                <div class="grid gap-5 sm:grid-cols-3">
                  <div class="grid gap-2">
                    <label for="method-timing" class="label">{t('payments.method_timing')}</label>
                    <select
                      id="method-timing"
                      name="timing"
                      bind:value={$methodForm.timing}
                      class="select bg-base-100 min-h-12 w-full px-3"
                    >
                      {#each paymentTimings as timing (timing)}
                        <option value={timing}>{t(paymentTimingLabelKey(timing))}</option>
                      {/each}
                    </select>
                  </div>
                  <div class="grid gap-2">
                    <label for="method-confirmation" class="label"
                      >{t('payments.method_confirmation')}</label
                    >
                    <select
                      id="method-confirmation"
                      name="confirmation"
                      bind:value={$methodForm.confirmation}
                      class="select bg-base-100 min-h-12 w-full px-3"
                    >
                      {#each paymentConfirmations as confirmation (confirmation)}
                        <option value={confirmation}
                          >{t(paymentConfirmationLabelKey(confirmation))}</option
                        >
                      {/each}
                    </select>
                  </div>
                  <div class="grid gap-2">
                    <label for="method-order" class="label">{t('payments.method_sort_order')}</label
                    >
                    <input
                      id="method-order"
                      name="sortOrder"
                      type="number"
                      step="1"
                      bind:value={$methodForm.sortOrder}
                      class="input w-full"
                    />
                  </div>
                </div>
                <div class="grid gap-2">
                  <label for="method-instructions" class="label"
                    >{t('payments.method_instructions')}</label
                  >
                  <textarea
                    id="method-instructions"
                    name="instructions"
                    bind:value={$methodForm.instructions}
                    rows={3}
                    maxlength={5000}
                    class="textarea bg-base-100 min-h-20 w-full px-3 py-2"
                  ></textarea>
                </div>
                <label for="field-enabled" class="label flex min-h-12 items-center gap-3">
                  <input
                    id="field-enabled"
                    type="checkbox"
                    name="enabled"
                    bind:checked={$methodForm.enabled}
                    class="checkbox"
                  />
                  <span>{t('payments.method_enabled')}</span>
                </label>
                <div class="flex flex-wrap gap-3">
                  <button type="submit" class="btn btn-primary">{t('form.save')}</button>
                  {#if $methodForm.methodId}
                    <a href={paymentsHref} class="btn inline-flex min-h-12 items-center px-5">
                      {t('payments.method_cancel_edit')}
                    </a>
                  {/if}
                </div>
              </form>
            {/if}
          </div>
        </div>

        <div class="card card-border bg-base-100">
          <div class="card-body gap-2 pb-0">
            <h2 class="card-title">{t('payments.requests_title')}</h2>
          </div>
          <div class="card-body">
            {#if data.dashboard.requests.length === 0}
              <p>{t('payments.request_empty')}</p>
            {:else}
              <div class="overflow-x-auto">
                <table class="table w-full min-w-[52rem]">
                  <caption class="sr-only">{t('payments.requests_caption')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" class="px-4 py-3">{t('payments.request_name')}</th>
                      <th scope="col" class="px-4 py-3">{t('payments.request_status')}</th>
                      <th scope="col" class="px-4 py-3">{t('payments.request_method')}</th>
                      <th scope="col" class="px-4 py-3">{t('payments.request_amount')}</th>
                      <th scope="col" class="px-4 py-3">{t('payments.request_actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each data.dashboard.requests as request (request.id)}
                      <tr>
                        <th scope="row" class="px-4 py-4">{request.displayName}</th>
                        <td class="px-4 py-4">
                          <span class="badge badge-secondary">
                            {t(paymentRequestStatusLabelKey(request.status))}
                          </span>
                        </td>
                        <td class="px-4 py-4">{request.methodLabel}</td>
                        <td class="px-4 py-4">{request.amount}</td>
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
                                    class="select bg-base-100 min-h-10 w-full px-2"
                                  >
                                    {#each manualMethods as method (method.id)}
                                      <option value={method.id}>{method.label}</option>
                                    {/each}
                                  </select>
                                  <button type="submit" class="btn btn-outline btn-sm">
                                    {t('payments.prepare_confirm')}
                                  </button>
                                </form>
                              {/if}
                              {#if data.capabilities.canWaivePayments && waiverEnabled}
                                <form method="POST" action="?/prepareWaive">
                                  <input type="hidden" name="requestId" value={request.id} />
                                  <button type="submit" class="btn btn-ghost btn-sm">
                                    {t('payments.prepare_waive')}
                                  </button>
                                </form>
                              {/if}
                              {#if request.methodLabel === t('payments.default_method.card.label')}
                                <p class="max-w-56">
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
          </div>
        </div>
      {/if}
    </div>
  {/snippet}
</SettingsPage>
