<script lang="ts">
  import { translator } from '$lib/i18n';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head>
  <title>{t('register.guild_join_title')} · {data.title} · {t('brand.name')}</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
  <header>
    <p class="text-primary text-sm font-semibold">{t('register.page_title')}</p>
    <h1 class="mt-2 text-3xl leading-tight font-bold tracking-tight">{data.title}</h1>
    <p class="text-muted-foreground mt-2">
      {t('register.organized_by', { organizer: data.organizationName })}
    </p>
  </header>
  <Card class="mt-8 shadow-none">
    <CardHeader><CardTitle>{t('register.guild_join_title')}</CardTitle></CardHeader>
    <CardContent>
      <p class="leading-7">{t('register.guild_join_guidance')}</p>
      {#if data.inviteUrl}
        <a
          class="bg-primary text-primary-foreground mt-6 inline-flex min-h-12 items-center rounded-md px-5 font-semibold"
          href={data.inviteUrl}
          rel="external noreferrer">{t('register.guild_join_cta')}</a
        >
      {/if}
      <p class="text-muted-foreground mt-5 text-sm">{t('register.guild_join_retry')}</p>
    </CardContent>
  </Card>
</div>
