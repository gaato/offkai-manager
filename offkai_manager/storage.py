from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Iterable, Optional
from uuid import uuid4

ISO_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


@dataclass
class FormButtonConfig:
    config_id: str
    custom_id: str
    guild_id: int
    channel_id: int
    message_id: Optional[int]
    form_url: str
    field_id: str
    button_label: str
    button_style: str
    description: Optional[str]
    embed_title: str
    created_by: int
    updated_by: int
    updated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).strftime(ISO_FORMAT)
    )

    def to_payload(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_payload(cls, payload: Dict[str, Any]) -> "FormButtonConfig":
        return cls(
            config_id=payload["config_id"],
            custom_id=payload["custom_id"],
            guild_id=payload["guild_id"],
            channel_id=payload["channel_id"],
            message_id=payload.get("message_id"),
            form_url=payload["form_url"],
            field_id=payload["field_id"],
            button_label=payload["button_label"],
            button_style=payload["button_style"],
            description=payload.get("description"),
            embed_title=payload.get("embed_title", "Googleフォーム回答リンク"),
            created_by=payload.get("created_by", payload.get("updated_by", 0)),
            updated_by=payload.get("updated_by", payload.get("created_by", 0)),
            updated_at=payload.get(
                "updated_at", datetime.now(timezone.utc).strftime(ISO_FORMAT)
            ),
        )


class FormButtonStorage:
    """Simple JSON-backed storage for button configurations."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._configs: Dict[str, FormButtonConfig] = {}
        self._load()

    # ------------------------------------------------------------------
    # internal helpers
    # ------------------------------------------------------------------
    def _load(self) -> None:
        if not self.path.exists():
            self._configs = {}
            return

        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            backup = self.path.with_suffix(self.path.suffix + ".corrupted")
            self.path.replace(backup)
            self._configs = {}
            return

        records = payload.get("records", {})
        if not isinstance(records, dict):
            self._configs = {}
            return

        parsed: Dict[str, FormButtonConfig] = {}
        for key, value in records.items():
            try:
                parsed[key] = FormButtonConfig.from_payload(value)
            except KeyError:
                continue
        self._configs = parsed

    def _save(self) -> None:
        with self._lock:
            serialized = {
                "records": {
                    key: config.to_payload() for key, config in self._configs.items()
                }
            }
            tmp_path = self.path.with_suffix(self.path.suffix + ".tmp")
            tmp_path.write_text(
                json.dumps(serialized, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            tmp_path.replace(self.path)

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------
    def all(self) -> Iterable[FormButtonConfig]:
        return list(self._configs.values())

    def get(self, config_id: str) -> Optional[FormButtonConfig]:
        return self._configs.get(config_id)

    def get_by_custom_id(self, custom_id: str) -> Optional[FormButtonConfig]:
        for config in self._configs.values():
            if config.custom_id == custom_id:
                return config
        return None

    def get_by_message_id(self, message_id: int) -> Optional[FormButtonConfig]:
        for config in self._configs.values():
            if config.message_id == message_id:
                return config
        return None

    def create(
        self,
        *,
        guild_id: int,
        channel_id: int,
        message_id: Optional[int],
        form_url: str,
        field_id: str,
        button_label: str,
        button_style: str,
        description: Optional[str],
        embed_title: str,
        author_id: int,
    ) -> FormButtonConfig:
        config_id = uuid4().hex
        custom_id = f"formbutton:{config_id}"
        config = FormButtonConfig(
            config_id=config_id,
            custom_id=custom_id,
            guild_id=guild_id,
            channel_id=channel_id,
            message_id=message_id,
            form_url=form_url,
            field_id=field_id,
            button_label=button_label,
            button_style=button_style,
            description=description,
            embed_title=embed_title,
            created_by=author_id,
            updated_by=author_id,
        )
        self._configs[config_id] = config
        self._save()
        return config

    def update(self, config_id: str, **fields: Any) -> FormButtonConfig:
        config = self._configs[config_id]
        for key, value in fields.items():
            if hasattr(config, key):
                setattr(config, key, value)
        config.updated_at = datetime.now(timezone.utc).strftime(ISO_FORMAT)
        if "updated_by" not in fields:
            # keep previous updated_by if not supplied
            pass
        self._configs[config_id] = config
        self._save()
        return config

    def set_message_id(self, config_id: str, message_id: int) -> FormButtonConfig:
        return self.update(config_id, message_id=message_id)
