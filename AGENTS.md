# AGENTS.md — offkai-manager (TypeScript / SvelteKit)

This branch (`ts-rewrite`) is a full TypeScript rewrite of the Go app. Product direction:
`docs/design/platform-roadmap.md` (authoritative). Milestone plan and constraints are
specified per delegation prompt. Legacy Go code lives in git history (`git show main:...`).

## Stack

SvelteKit 2 + Svelte 5 (**runes mode enforced**, `compilerOptions.runes: true`) ·
adapter-node · Tailwind CSS 4 + shadcn-svelte (vendored into `src/lib/components/ui/`) ·
Drizzle ORM + better-sqlite3 (SQLite) · Zod 4 + sveltekit-superforms 2 · stripe (server SDK only,
hosted Checkout — never render card inputs) · vitest + in-memory SQLite ·
Playwright + axe · dependency-cruiser · pnpm · node 24 via mise.

## Svelte 5 — runes only (legacy syntax is a build error)

```svelte
<script lang="ts">
  let { title, onconfirm } = $props(); // NOT `export let`
  let count = $state(0); // NOT top-level `let` reactivity
  const doubled = $derived(count * 2); // NOT `$:`
  $effect(() => {
    /* side effects only */
  });
</script>

<button onclick={() => count++}>{title}</button> <!-- NOT on:click -->
```

- Events: plain attributes (`onclick`, `onsubmit`); component callbacks are props
  (`onconfirm`), **not** `createEventDispatcher`.
- Composition: snippets + `{@render ...}`, **not** slots.
- No svelte/store for new code; use runes. `$app/stores` → use `$app/state`.

## Architecture layers (enforced by dependency-cruiser — CI fails on violation)

```
src/lib/shared/    client-safe: zod schemas, money, enums+label-key mappers. Imports nothing server-side.
src/lib/i18n/      typed catalog. No server imports.
src/lib/server/domain/**   framework-free business logic. May import db/, shared/, other domain
                           modules, gateway *interfaces*. MUST NOT import $app/*, @sveltejs/kit,
                           routes, components, or gateway implementations.
src/lib/server/gateways/   external effects (stripe real/dev, discord). Implement domain ports.
src/routes/**      thin: parse (zod) → call domain service → render/redirect. Never imports
                   `stripe` or `better-sqlite3` directly.
```

Every domain mutation runs inside one synchronous `write` transaction and appends its audit
row in the same tx. `write` uses BEGIN IMMEDIATE; `read` supplies multi-statement snapshots.
Callbacks cannot return promises, because better-sqlite3 commits at the first await.
SQLite partial unique indexes and composite FKs preserve concurrency and money invariants.

## Forms & progressive enhancement

- Real forms (multiple fields): sveltekit-superforms 2 + zod4 adapter, `use:enhance`.
- One-button state transitions (publish, confirm, check-in, …): plain named form actions.
- Every mutation is a `<form method="POST">` that works **without JS**. JS only enhances.
- Destructive/irreversible actions get a confirm step (page or dialog with no-JS fallback).

## i18n (EN + JA, both mandatory)

- Catalog: `src/lib/i18n/messages/en.ts` + `ja.ts`, `ja satisfies Record<keyof typeof en, ...>`
  — a missing key is a **compile error**. No hardcoded user-facing strings in components,
  routes, CSV headers, or emails. `t(locale, key, params)` from `event.locals`.
- Locale resolution (hooks): `?lang=` query (persist cookie) → `offkai_lang` cookie →
  `Accept-Language` → `en`. Every page emits `<html lang>`.
- Participant-facing web pages have been removed because participant interactions are moving to
  Discord; registration and payment services remain for the bot. Statuses use label-key mappers.
- The brand name appears only via the single brand token in the catalog (rename must stay
  a one-line change).

## Money & payments

- Amounts: `bigint` minor units + 3-letter lowercase-insensitive currency; snapshot
  semantics (payment request rows copy amount+currency; composite FK pins currency).
- Direct charges on the organizer's connected account. The platform never holds funds.
- Settlement happens ONLY in the unified settle service (webhook / dev-pay / manual
  confirm / waive). **Never mark anything paid from a Stripe return URL.**
- Webhook parsing tolerates Stripe API-version mismatch (read only long-stable fields);
  idempotency via the `stripe_webhook_events` ledger + record idempotency keys.

## Time & environment

- Wall-clock parse/format only through `src/lib/server/time/` using `OFFKAI_TIMEZONE`
  (default Asia/Tokyo). Never system TZ; never ad-hoc `toLocaleString`/`Intl` outside the
  util (dependency-cruiser enforces).
- All config via `OFFKAI_*` env vars parsed in `src/lib/server/config.ts`; fail fast on
  invalid/missing prod config. No silent fallbacks. Dev bypass (`OFFKAI_AUTH_DEV_BYPASS`)
  is the only mode that relaxes requirements and must log a loud warning.

## Testing & commands

```
pnpm check        # svelte-check
pnpm lint         # eslint + prettier check
pnpm depcruise    # boundary lint
pnpm test         # vitest unit
pnpm test:integration   # vitest + isolated in-memory SQLite
pnpm test:e2e     # Playwright against built app (dev bypass + stripedev)
```

- Domain logic with DB effects → integration tests against an isolated in-memory SQLite
  database cloned from a migrated template. Keep concurrent-call outcome assertions to
  verify invariants under serialized synchronous writes; inject a fixed Clock for reproducibility.
- Every GET route must have a sweep fixture (route sweep renders all routes in ja+en and
  scans for raw enums/`undefined`/`NaN`/`[object Object]`). New route without fixture =
  test failure.
- Security regressions (cross-site POST rejected, rate limit 429, security headers,
  request-id) are pinned tests — keep them green.

## Conventions

- TypeScript `strict`; no `any` unless interfacing with untyped webhook payloads (then
  narrow immediately with zod).
- Errors: domain services throw typed errors; routes map them to localized user messages.
  Never leak stack traces or internal identifiers to responses.
- Logging: pino via the request-scoped logger (request-id child). No `console.log`.
- Commits: small, imperative subject, English. Never `git push --force` (use
  `--force-with-lease`). Do not commit secrets.
- ADRs in `docs/adr/` (see `.agents/skills/documentation-and-adrs/`): record any decision
  that deviates from the delegation spec, in the same PR.
