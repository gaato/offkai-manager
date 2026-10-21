<script lang="ts">
  import { onMount } from 'svelte';
  import SettingsPage from '$lib/components/page/settings-page.svelte';
  import { translator } from '$lib/i18n';
  import { stripeOnboardingStatusLabelKey } from '$lib/shared/payment';
  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  let host = $state<HTMLDivElement>();
  let failed = $state(false);
  const stubComponents = [
    'notification_banner',
    'account_management',
    'balances',
    'payouts',
    'payments'
  ] as const;
  const stub = $derived(data.publishableKey === 'pk_test_stub');
  onMount(() => {
    if (!data.account || !data.publishableKey) return;
    if (stub) {
      void fetch(data.sessionEndpoint, { method: 'POST' })
        .then((response) => {
          if (!response.ok) failed = true;
        })
        .catch(() => {
          failed = true;
        });
      return;
    }
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      try {
        // /pure keeps script injection inside this mounted, authenticated screen only.
        const { loadConnectAndInitialize } = await import('@stripe/connect-js/pure');
        if (disposed) return;
        const connect = loadConnectAndInitialize({
          publishableKey: data.publishableKey,
          locale: data.locale,
          fetchClientSecret: async () => {
            const response = await fetch(data.sessionEndpoint, { method: 'POST' });
            if (!response.ok) throw new Error('Account Session unavailable');
            const session: { clientSecret: string } = await response.json();
            return session.clientSecret;
          }
        });
        // Stripe owns this empty mount node; Svelte never renders children into it.
        cleanup = () => {
          void connect.logout();
          // eslint-disable-next-line svelte/no-dom-manipulating -- This host has no Svelte-rendered children.
          host?.replaceChildren();
        };
        const names = [
          ...(data.account?.onboardingStatus !== 'ready' ? ['account-onboarding' as const] : []),
          'notification-banner',
          'account-management',
          'balances',
          'payouts',
          'payments'
        ] as const;
        for (const name of names) {
          const element = connect.create(name);
          element.setOnLoadError(() => {
            failed = true;
          });
          // eslint-disable-next-line svelte/no-dom-manipulating -- Stripe custom elements require imperative mounting into their dedicated host.
          host?.appendChild(element);
        }
      } catch {
        if (!disposed) failed = true;
      }
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  });
</script>

<svelte:head><title>{t('payouts.title')} · {t('brand.name')}</title></svelte:head>
<SettingsPage>
  {#snippet title()}{t('payouts.title')}{/snippet}
  {#snippet body()}
    <p>{t('payouts.intro')}</p>
    {#if form?.problem}<p role="alert" class="alert alert-error">{form.problem}</p>{/if}
    {#if data.refreshFailed}<p role="alert" class="alert alert-warning">
        {t('payouts.refresh_failed')}
      </p>{/if}
    {#if !data.account}
      <form method="POST" action="?/create">
        <button type="submit" class="btn btn-primary">{t('payouts.create')}</button>
      </form>
    {:else}
      <p role="status">{t(stripeOnboardingStatusLabelKey(data.account.onboardingStatus))}</p>
      {#if failed}<p role="alert" class="alert alert-warning">{t('payouts.embed_failed')}</p>{/if}
      {#if stub}
        <div class="grid gap-4" data-testid="stripe-placeholder">
          <p>{t('payouts.test_placeholder')}</p>
          {#if data.account?.onboardingStatus !== 'ready'}<h2 class="card-title">
              {t('payouts.onboarding')}
            </h2>{/if}
          {#each stubComponents as name (name)}
            <section class="card card-border bg-base-100 p-4">
              <h2 class="card-title">{t(`payouts.${name}`)}</h2>
            </section>
          {/each}
        </div>
      {/if}
      <div bind:this={host} class="grid gap-6"></div>
      <form method="POST" action="?/hosted">
        <button type="submit" class="btn">{t('payouts.hosted')}</button>
      </form>
    {/if}
  {/snippet}
</SettingsPage>
