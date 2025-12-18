from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class AppConfig:
    discord_bot_token: str
    nocodb_base_url: str
    nocodb_token: str
    nocodb_base_id: str
    nocodb_table_event: str
    nocodb_table_panel: str
    nocodb_table_registration: str
    nocodb_table_member: str


def load_config() -> AppConfig:
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        raise SystemExit("DISCORD_BOT_TOKEN 環境変数を設定してください。")

    base_url = os.environ.get("NOCODB_BASE_URL")
    if not base_url:
        raise SystemExit("NOCODB_BASE_URL 環境変数を設定してください。")

    # systemd環境では NOCODB_API_TOKEN を使っている想定。
    # フォールバックは持たず、設定ミスは即座に落として気づけるようにする。
    nocodb_token = os.environ.get("NOCODB_API_TOKEN")
    if not nocodb_token:
        raise SystemExit("NOCODB_API_TOKEN 環境変数を設定してください。")

    # Defaults pinned to docs/swagger.json snapshot.
    base_id = os.environ.get("NOCODB_BASE_ID", "p5539hv9f4qzq7j")
    table_event = os.environ.get("NOCODB_TABLE_EVENT", "mnhp5wiu0o6dfcq")
    table_panel = os.environ.get("NOCODB_TABLE_PANEL", "m3xxabd0f8esojw")
    table_registration = os.environ.get("NOCODB_TABLE_REGISTRATION", "mfua4r5icujt108")
    table_member = os.environ.get("NOCODB_TABLE_MEMBER", "mt91osuydj2jya2")

    return AppConfig(
        discord_bot_token=token,
        nocodb_base_url=base_url,
        nocodb_token=nocodb_token,
        nocodb_base_id=base_id,
        nocodb_table_event=table_event,
        nocodb_table_panel=table_panel,
        nocodb_table_registration=table_registration,
        nocodb_table_member=table_member,
    )
