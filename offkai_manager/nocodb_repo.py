from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

from offkai_manager.nocodb_api import NocoDbClient

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class NocoDbIds:
    base_id: str
    table_event: str
    table_panel: str
    table_registration: str
    table_member: str


class OffkaiNocoDbRepo:
    def __init__(self, *, client: NocoDbClient, ids: NocoDbIds) -> None:
        self._client = client
        self._ids = ids

    def _fields(self, record: Optional[dict[str, Any]]) -> dict[str, Any]:
        if not record:
            return {}
        f = record.get("fields")
        return f if isinstance(f, dict) else {}

    def _first_link_id(self, value: Any) -> Optional[int]:
        """Extract first linked record id from NocoDB LinkToAnotherRecord shape."""
        if not isinstance(value, list) or not value:
            return None
        first = value[0]
        if not isinstance(first, dict):
            return None
        rid = first.get("id")
        try:
            return int(rid)
        except Exception:
            return None

    # -----------------
    # Event
    # -----------------
    async def get_event(self, event_id: int) -> Optional[dict[str, Any]]:
        try:
            return await self._client.get_record(
                table_id=self._ids.table_event,
                record_id=event_id,
            )
        except Exception:
            log.exception("Failed to fetch event event_id=%s", event_id)
            return None

    async def create_event(
        self,
        *,
        title: str,
        capacity: int,
        guild_id: int,
        participant_role_id: Optional[int],
        pending_role_id: Optional[int],
        log_channel_id: Optional[int] = None,
    ) -> int:
        recs = await self._client.create_records(
            table_id=self._ids.table_event,
            records=[
                {
                    "title": title,
                    "capacity": capacity,
                    "guild_id": str(guild_id),
                    "participant_role_id": (
                        str(participant_role_id) if participant_role_id else ""
                    ),
                    "pending_role_id": str(pending_role_id) if pending_role_id else "",
                    "log_channel_id": str(log_channel_id) if log_channel_id else "",
                }
            ],
        )
        rid = int(recs[0]["id"])
        return rid

    async def update_event(
        self,
        *,
        event_id: int,
        fields: dict[str, Any],
    ) -> None:
        await self._client.update_records(
            table_id=self._ids.table_event,
            records=[{"id": event_id, "fields": fields}],
        )

    # -----------------
    # Panel
    # -----------------
    async def get_panel(self, panel_id: int) -> Optional[dict[str, Any]]:
        try:
            return await self._client.get_record(
                table_id=self._ids.table_panel,
                record_id=panel_id,
            )
        except Exception:
            log.exception("Failed to fetch panel panel_id=%s", panel_id)
            return None

    async def list_panels_by_ids(
        self, *, panel_ids: list[int]
    ) -> dict[int, dict[str, Any]]:
        if not panel_ids:
            return {}

        out: dict[int, dict[str, Any]] = {}

        chunk_size = 50
        for i in range(0, len(panel_ids), chunk_size):
            chunk = panel_ids[i : i + chunk_size]
            values = ",".join(str(x) for x in chunk)
            where = f"(id,in,{values})"
            payload = await self._client.list_records(
                table_id=self._ids.table_panel,
                where=where,
                page_size=200,
            )
            for r in payload.get("records", []):
                try:
                    out[int(r["id"])] = r
                except Exception:
                    continue

        return out

    async def list_panels(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            payload = await self._client.list_records(
                table_id=self._ids.table_panel,
                page=page,
                page_size=200,
            )
            records = list(payload.get("records", []))
            out.extend(records)
            # NocoDB uses token pagination; if next is null, we are done.
            if not payload.get("next"):
                break
            page += 1
        return out

    async def list_panel_ids_for_event(self, *, event_id: int, limit: int = 20000) -> list[int]:
        """List panel ids for an event.

        Use ForeignKey column `event_id` (stable for filtering).
        """
        where = f"(event_id,eq,{event_id})"
        out: list[int] = []
        page = 1
        while True:
            payload = await self._client.list_records(
                table_id=self._ids.table_panel,
                where=where,
                page=page,
                page_size=min(200, max(1, limit - len(out))),
            )
            for r in payload.get("records", []):
                try:
                    out.append(int(r["id"]))
                except Exception:
                    continue
            if len(out) >= limit:
                break
            if not payload.get("next"):
                break
            page += 1
        return out

    async def create_panel(
        self,
        *,
        event_id: int,
        channel_id: int,
        title: str,
        description: Optional[str],
        language: str,
        embed: dict[str, Any],
    ) -> tuple[int, dict[str, Any]]:
        recs = await self._client.create_records(
            table_id=self._ids.table_panel,
            records=[
                {
                    "title": title,
                    "description": description or "",
                    "channel_id": str(channel_id),
                    "message_id": "0",
                    "language": str(language or ""),
                    # JSON field (NocoDB): store the exact payload compatible with discord.Embed.from_dict()
                    "embed": embed,
                    # Prefer FK column for stable filtering.
                    "event_id": int(event_id),
                }
            ],
        )
        rid = int(recs[0]["id"])
        return rid, recs[0]

    async def set_panel_message_id(
        self,
        *,
        panel_id: int,
        message_id: int,
    ) -> None:
        await self._client.update_records(
            table_id=self._ids.table_panel,
            records=[{"id": panel_id, "fields": {"message_id": str(message_id)}}],
        )

    # -----------------
    # Member
    # -----------------
    async def find_member(
        self, *, guild_id: int, user_id: int
    ) -> Optional[dict[str, Any]]:
        where = f"(guild_id,eq,{guild_id})~and(user_id,eq,{user_id})"
        payload = await self._client.list_records(
            table_id=self._ids.table_member,
            where=where,
            page_size=1,
        )
        records = list(payload.get("records", []))
        return records[0] if records else None

    async def get_or_create_member(
        self,
        *,
        guild_id: int,
        user_id: int,
        display_name: str,
    ) -> dict[str, Any]:
        existing = await self.find_member(guild_id=guild_id, user_id=user_id)
        if existing:
            # Best-effort keep display name fresh
            try:
                await self._client.update_records(
                    table_id=self._ids.table_member,
                    records=[
                        {
                            "id": existing["id"],
                            "fields": {"display_name": display_name},
                        }
                    ],
                )
            except Exception:
                pass
            return existing

        recs = await self._client.create_records(
            table_id=self._ids.table_member,
            records=[
                {
                    "display_name": display_name,
                    "user_id": str(user_id),
                    "guild_id": str(guild_id),
                    # tickets is MultiSelect; leave empty.
                    "tickets": "",
                }
            ],
        )
        return recs[0]

    async def update_member(
        self,
        *,
        member_id: int,
        fields: dict[str, Any],
    ) -> None:
        await self._client.update_records(
            table_id=self._ids.table_member,
            records=[{"id": member_id, "fields": fields}],
        )

    async def set_member_tickets(
        self,
        *,
        guild_id: int,
        user_id: int,
        display_name: str,
        ticket_keys: list[str],
    ) -> None:
        member = await self.get_or_create_member(
            guild_id=guild_id,
            user_id=user_id,
            display_name=display_name,
        )
        # swagger.json snapshot models tickets as a string.
        value = ",".join(ticket_keys)
        await self.update_member(member_id=int(member["id"]), fields={"tickets": value})

    # -----------------
    # Registration
    # -----------------
    async def find_registration_for_event(
        self,
        *,
        event_id: int,
        member_id: int,
    ) -> Optional[dict[str, Any]]:
        # NOTE: In practice, NocoDB where filtering on LinkToAnotherRecord can be unreliable.
        # Use ForeignKey columns for stability.
        where = f"(event_id,eq,{event_id})~and(member_id,eq,{member_id})"
        payload = await self._client.list_records(
            table_id=self._ids.table_registration,
            where=where,
            page_size=1,
        )
        records = list(payload.get("records", []))
        return records[0] if records else None

    async def list_registrations_for_member(
        self, *, member_id: int, limit: int = 20000
    ) -> list[dict[str, Any]]:
        where = f"(member_id,eq,{member_id})"
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            payload = await self._client.list_records(
                table_id=self._ids.table_registration,
                where=where,
                page=page,
                page_size=min(200, max(1, limit - len(out))),
            )
            records = list(payload.get("records", []))
            out.extend(records)
            if len(out) >= limit:
                break
            if not payload.get("next"):
                break
            page += 1
        return out

    async def list_registrations_for_event_member(
        self,
        *,
        event_id: int,
        member_id: int,
        limit: int = 20000,
    ) -> list[dict[str, Any]]:
        """Return all registrations for (event_id, member_id)."""
        where = f"(event_id,eq,{event_id})~and(member_id,eq,{member_id})"
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            payload = await self._client.list_records(
                table_id=self._ids.table_registration,
                where=where,
                page=page,
                page_size=min(200, max(1, limit - len(out))),
            )
            records = list(payload.get("records", []))
            out.extend(records)
            if len(out) >= limit:
                break
            if not payload.get("next"):
                break
            page += 1
        return out

    async def find_registration(
        self,
        *,
        panel_id: int,
        member_id: int,
    ) -> Optional[dict[str, Any]]:
        # Use ForeignKey columns for stability.
        where = f"(panel_id,eq,{panel_id})~and(member_id,eq,{member_id})"
        payload = await self._client.list_records(
            table_id=self._ids.table_registration,
            where=where,
            page_size=1,
        )
        records = list(payload.get("records", []))
        return records[0] if records else None

    async def count_confirmed_for_event(self, *, event_id: int) -> int:
        where = f"(event_id,eq,{event_id})~and(is_confirmed,eq,true)"
        return int(await self._client.count(table_id=self._ids.table_registration, where=where))

    async def list_registrations_for_event(
        self, *, event_id: int, limit: int = 20000
    ) -> list[dict[str, Any]]:
        where = f"(event_id,eq,{event_id})"
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            payload = await self._client.list_records(
                table_id=self._ids.table_registration,
                where=where,
                page=page,
                page_size=min(200, max(1, limit - len(out))),
            )
            records = list(payload.get("records", []))
            out.extend(records)
            if len(out) >= limit:
                break
            if not payload.get("next"):
                break
            page += 1
        return out

    async def create_registration(
        self,
        *,
        event_id: int,
        panel_id: int,
        member_id: int,
        display_name: str,
        twitter_id: Optional[str],
        residence: Optional[str],
        requests: Optional[str],
        is_confirmed: bool,
    ) -> int:
        recs = await self._client.create_records(
            table_id=self._ids.table_registration,
            records=[
                {
                    "display_name": display_name,
                    "twitter_id": twitter_id or "",
                    "residence": residence or "",
                    "requests": requests or "",
                    "is_confirmed": bool(is_confirmed),
                    "has_paid": False,
                    "notes": "",
                    # Prefer FK columns for stable filtering.
                    "event_id": int(event_id),
                    "panel_id": int(panel_id),
                    "member_id": int(member_id),
                }
            ],
        )
        return int(recs[0]["id"])

    async def delete_registration(self, *, registration_id: int) -> None:
        await self._client.delete_records(
            table_id=self._ids.table_registration,
            record_ids=[registration_id],
        )

    async def update_registration(
        self,
        *,
        registration_id: int,
        fields: dict[str, Any],
    ) -> None:
        await self._client.update_records(
            table_id=self._ids.table_registration,
            records=[{"id": registration_id, "fields": fields}],
        )

    async def list_members_by_ids(
        self, *, member_ids: list[int]
    ) -> dict[int, dict[str, Any]]:
        if not member_ids:
            return {}

        out: dict[int, dict[str, Any]] = {}

        # NocoDB where supports (field,in,a,b,c). Keep chunks modest.
        chunk_size = 50
        for i in range(0, len(member_ids), chunk_size):
            chunk = member_ids[i : i + chunk_size]
            values = ",".join(str(x) for x in chunk)
            where = f"(id,in,{values})"
            payload = await self._client.list_records(
                table_id=self._ids.table_member,
                where=where,
                page_size=200,
            )
            for r in payload.get("records", []):
                try:
                    out[int(r["id"])] = r
                except Exception:
                    continue

        return out
