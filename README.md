# offkai-manager

2026-03-07 開催の「[Expo/7th fes.] hololive ID&EN fans Off-Kai」(海浜幕張・180席貸切)の運営に使った Discord bot。

A Discord bot used to run a 180-seat fan off-kai event in March 2026. Published as-is for reference.

## 機能

- 参加登録パネル(ボタン + 多言語 embed、`data/offkai_panel_content.json` で JA/EN の告知文を管理)
- 登録・キャンセルに応じたロール付与と定員管理
- [NocoDB](https://nocodb.com/) をバックエンドにしたイベント・パネル・登録・メンバーの管理
- Peatix 支払い状況の CSV 取り込みによる支払済みロール同期(`scripts/sync_paid_from_csv.py`)

## 構成

- Python >= 3.13 / [py-cord](https://pycord.dev/) / httpx
- 依存管理は [uv](https://docs.astral.sh/uv/)
- 設定は環境変数(`offkai_manager/config.py` 参照)

```
uv sync
uv run main.py
```

## License

All rights reserved. 参照用に公開していますが、ライセンスは付与していません(複製・再配布・改変利用は不可)。
