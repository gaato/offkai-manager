<script lang="ts">
  import { resolve } from '$app/paths';
  import { translator } from '$lib/i18n';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t('ops.users.title')} · {t('brand.name')}</title></svelte:head>

<div class="grid gap-6">
  <header>
    <h1 class="text-3xl font-bold tracking-tight">{t('ops.users.title')}</h1>
    <p class="mt-2 text-slate-600">{t('ops.users.intro')}</p>
  </header>
  <Card class="border-slate-200 shadow-none">
    <CardHeader><CardTitle>{t('ops.users.search_title')}</CardTitle></CardHeader>
    <CardContent>
      <form
        method="GET"
        action={resolve('/ops/users')}
        class="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div class="flex-1">
          <Label for="user-query">{t('ops.users.query')}</Label>
          <p id="user-query-help" class="mt-1 text-sm text-slate-600">
            {t('ops.users.query_help')}
          </p>
          <Input
            id="user-query"
            name="q"
            value={data.query}
            maxlength={128}
            aria-describedby="user-query-help"
            class="mt-2"
          />
        </div>
        <Button type="submit">{t('ops.users.search')}</Button>
      </form>
    </CardContent>
  </Card>

  {#if data.query}
    <Card class="border-slate-200 shadow-none">
      <CardHeader><CardTitle>{t('ops.users.results')}</CardTitle></CardHeader>
      <CardContent>
        {#if data.users.length === 0}
          <p class="text-slate-600">{t('ops.users.empty')}</p>
        {:else}
          <ul class="divide-y divide-slate-200">
            {#each data.users as user (user.id)}
              <li
                class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <a
                    class="font-semibold underline-offset-4 hover:underline"
                    href={resolve('/ops/users/[userId]', { userId: user.id })}>{user.displayName}</a
                  >
                  <p class="mt-1 text-sm text-slate-600">@{user.username} · {user.discordUserId}</p>
                  <p class="mt-1 text-sm text-slate-600">
                    {t('ops.user.registration_count', { count: user.registrationCount })} · {t(
                      'ops.created_value',
                      { date: user.createdAtLabel }
                    )}
                  </p>
                </div>
                <Badge
                  class={user.suspendedAt
                    ? 'bg-amber-100 text-amber-950'
                    : 'bg-emerald-100 text-emerald-950'}
                >
                  {t(user.suspendedAt ? 'ops.status.suspended' : 'ops.status.active')}
                </Badge>
              </li>
            {/each}
          </ul>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
