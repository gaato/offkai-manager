# offkai-manager

Discord を中心にファン主催のオフ会を管理する bot と、主催者向け Web UI です。参加者は Discord の参加パネルで申し込み、主催者自身の Stripe アカウントへの事前決済、当日の受付まで進められ、プラットフォームは参加費を預かりません。2026 年 3 月の定員 180 人のファン交流会で使われた bot から発展したもので、以前の Python bot はタグ [`v1-2026-03-fes`](https://github.com/gaato/offkai-manager/tree/v1-2026-03-fes) に保存されています。

## できること

- **参加者**: Discord の日本語・英語パネルから申し込み、回答編集、キャンセル、キャンセル待ち、事前決済、通知の受信。
- **当日スタッフ**: Discord で受付番号や名前を検索し、チェックイン、現金・PayPay の受領記録、受付の取り消し。
- **主催者**: Web UI でイベント・定員・質問・参加費・Discord 設定を管理し、売上や受付状況の確認、リマインダー送信、名簿の印刷・CSV 出力。
- **運用者**: 運用画面でユーザー・団体・監査履歴を確認し、利用停止やサービスの稼働監視、バックアップを管理。

## セルフホスト

Node.js 26（バージョンは `mise.toml` に固定）、HTTP Interactions Endpoint を設定した Discord アプリケーション、Stripe Connect プラットフォームアカウント、SQLite 用の永続ボリュームが必要です。Litestream による継続バックアップは任意です。主催者 Web UI は日本語・英語に対応し、主要フォームは JavaScript なしでも利用できます。

[設定一覧](docs/configuration.md) と [本番運用手順](docs/operations.md) を参照してください。Compose の初期値はローカル開発専用です。

## 開発

```fish
mise install
pnpm install
env OFFKAI_DATABASE_PATH=./offkai.sqlite OFFKAI_AUTH_DEV_BYPASS=true pnpm dev --host 127.0.0.1
```

`http://127.0.0.1:5173/auth/dev` でローカルセッションを作れます。開発用ログインバイパスは訪問者が運用者を含む任意のセッションを作れるため、外部公開・共有環境・本番では絶対に有効にしないでください。実際の Discord・Stripe 認証情報は不要です。以下のテストは偽の外部サービスと分離した SQLite を使います。

```fish
pnpm test              # Vitest: unit
pnpm test:integration  # Vitest: in-memory SQLite
pnpm test:scenario     # Vitest: 署名付き Discord HTTP interactions
pnpm check             # Svelte / TypeScript
pnpm lint              # ESLint / Prettier
pnpm depcruise         # 依存境界
pnpm build             # adapter-node 本番ビルド
pnpm test:e2e          # ビルド後に headless Chromium + axe
pnpm test:e2e:all      # 設定済みの全ブラウザ
```

E2E は Docker 不要です。初回は `pnpm exec playwright install chromium` でブラウザを準備します。設計判断は [ADR 一覧](docs/adr/README.md) にあります。

## ライセンス

[AGPL-3.0-or-later](LICENSE)。依存ライブラリなどの表記は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

---

## English

A Discord-first bot and organizer web UI for fan meetups (offkai), covering registration panels, advance payment into each organizer's own Stripe account, and check-in at the door; the platform never holds participant funds. It grew out of a bot used for a 180-seat fan meetup in March 2026; the earlier Python bot is preserved at tag [`v1-2026-03-fes`](https://github.com/gaato/offkai-manager/tree/v1-2026-03-fes).

### Features

- **Participants**: register, edit answers, cancel, join a waitlist, pay in advance, and receive notifications through Japanese or English Discord panels.
- **Door staff**: find people by number or name in Discord, check them in, record cash/PayPay receipts, and undo attendance.
- **Organizers**: manage events, capacity, questions, fees, and Discord setup in the web UI; review payments and attendance, send reminders, and print/export rosters.
- **Operators**: inspect users, organizations, and audit history; suspend access, monitor health, and manage backups.

### Self-hosting

Requirements: Node.js 26 (pinned in `mise.toml`), a Discord application with an HTTP interactions endpoint, a Stripe Connect platform account, and a persistent volume for SQLite. Litestream backups are optional. The organizer UI supports Japanese and English, with core forms usable without JavaScript.

Read [configuration](docs/configuration.md) and [production operations](docs/operations.md). Compose defaults are for local development.

### Development

Run `mise install`, then `pnpm install`. Start a loopback-only development server with the fish command shown above and open `http://127.0.0.1:5173/auth/dev`. The development login bypass lets any visitor mint arbitrary sessions, including operator sessions: never expose it or enable it on a shared or production deployment. Real Discord/Stripe credentials are unnecessary for local development and tests.

The commands above run the unit, integration, signed-interaction scenario, type, lint, dependency-boundary, build, and headless E2E checks. E2E uses temporary SQLite and fake transports without Docker; install Chromium with `pnpm exec playwright install chromium` if needed. [ADRs](docs/adr/README.md) record design decisions.

### License

[AGPL-3.0-or-later](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
