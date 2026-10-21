# offkai-manager — agent guide

Discord participants use the bot; the SvelteKit web UI serves organizers and operators.
Use this guide with [configuration](docs/configuration.md), [operations](docs/operations.md)
and [ADRs](docs/adr/README.md) so changes follow the current public contracts.

- Use Node/pnpm pinned in `mise.toml`, TypeScript strict, Svelte 5 runes, callback props,
  snippets and `$app/state`, because legacy Svelte reactivity is disabled by the compiler.
  Avoid `any` and narrow untyped webhook payloads immediately so validation cannot bypass types.
- Keep routes thin (Zod parse → domain service → response). Domain code must stay framework-free
  and import gateway interfaces, while implementations own external effects; dependency-cruiser
  enforces these boundaries to keep business logic independently testable. Keep shared schemas
  and i18n client-safe so server code and secrets cannot enter browser bundles.
- Make each domain mutation and its audit row one synchronous `write` transaction
  (`BEGIN IMMEDIATE`); use `read` for snapshots. Never return promises or await in transaction
  callbacks, because better-sqlite3 commits before asynchronous work finishes. Preserve SQLite
  STRICT tables, partial unique indexes, composite FKs and the manual migration objects because
  they enforce money, history and concurrency invariants beyond TypeScript.
- Use bigint minor units and snapshot amount/currency/fees. Direct Stripe charges belong to the
  organizer's account; route settlement through the unified service and signed webhook ledger,
  never a return URL, because redirects are not payment evidence. Keep card inputs in hosted
  Checkout so the app never handles card data.
- Use DaisyUI components, semantic theme colors and Tailwind layout utilities with the built-in
  light/dark themes; keep `app.css` to setup only, because shared primitives avoid custom design
  maintenance. Use the five page snippets in `src/lib/components/page/` for consistent structure.
- Keep desktop navigation in `<nav>` and mobile `<details>/<summary>` inside `<header>`;
  use `menu menu-horizontal` for page navigation because dimmed inactive tabs fail AA contrast.
  Require explicit actions to open dialogs, with inline/no-JS fallbacks, so page loads stay usable.
- Use superforms + zod4 + `use:enhance` for multi-field forms and named POST actions for single
  transitions. All mutations need working no-JS forms and irreversible actions need confirmation,
  because enhancement must preserve access and deliberate consent.
- Put user-facing text in both typed EN/JA catalogs, statuses in label-key mappers and the brand
  in its single catalog token, so translation completeness and renaming remain enforceable.
- Parse environment settings only in `config.ts` and document them in `docs/configuration.md`;
  format/parse wall-clock time only through `server/time/`, because host TZ and scattered defaults
  make behavior deployment-dependent. Never expose dev login bypass because it grants arbitrary
  sessions. Use request-scoped pino and localized typed errors so logs correlate without leaking
  secrets, stack traces or internal IDs to users.
- Test DB effects with isolated migrated in-memory SQLite and fixed clocks, retaining concurrent
  outcome assertions because writes serialize synchronously. Keep schema parity checks because
  generated migrations omit manual SQLite details. Every GET needs a JA/EN route-sweep fixture
  to catch missing translations and raw values; preserve security regressions for CSRF, rate
  limits, headers and request IDs.
- Run `pnpm test` (unit), `pnpm test:integration` (SQLite), `pnpm test:scenario` (signed HTTP),
  `pnpm check`, `pnpm lint`, `pnpm depcruise`, `pnpm build` and `pnpm test:e2e` (headless
  Playwright + axe). Use fake Discord/Stripe transports because tests must be repeatable without
  external accounts or money movement. Keep build output stable while E2E serves it to avoid
  invalidating assets mid-run.
- Read existing code/docs before changing contracts and record new design decisions with reasons
  in an indexed ADR, because implementation and tests alone do not establish intended behavior.
  Keep changes scoped to the request and external publication explicit, because local tool access
  does not imply permission to publish. Never infer public identity; verify configured identity
  before external actions because this workspace uses different identities for different purposes.
