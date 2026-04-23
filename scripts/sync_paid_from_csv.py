from __future__ import annotations

import argparse
import asyncio
import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from offkai_manager.config import load_config
from offkai_manager.nocodb_api import NocoDbClient, NocoDbConfig
from offkai_manager.nocodb_repo import NocoDbIds, OffkaiNocoDbRepo

PAID_STATUSES = {"支払済み", "paid", "PAID", "Paid"}


@dataclass(frozen=True)
class MemberIndexRow:
    member_id: int
    user_id: str
    username: str
    display_name: str


def _nc_fields(record: dict[str, Any] | None) -> dict[str, Any]:
    if not record:
        return {}
    fields = record.get("fields")
    return fields if isinstance(fields, dict) else {}


def _nc_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        try:
            return int(str(value))
        except Exception:
            return None


def _norm(value: str) -> str:
    return value.strip().lower().lstrip("@")


def _extract_tokens(primary: str, fallback_id: str) -> list[str]:
    raw = [primary or "", fallback_id or ""]
    out: list[str] = []
    for text in raw:
        if not text:
            continue
        # support values like "name / 123..." or "name/other"
        for part in text.replace("、", "/").replace("|", "/").split("/"):
            token = part.strip()
            if token:
                out.append(token)
    return out


def _read_csv_rows(path: Path) -> list[dict[str, str]]:
    encodings = ("utf-8-sig", "utf-16", "cp932")
    last_error: Exception | None = None
    for enc in encodings:
        try:
            with path.open("r", encoding=enc, newline="") as f:
                reader = csv.DictReader(f, delimiter="\t")
                return [dict(row) for row in reader]
        except UnicodeDecodeError as e:
            last_error = e
            continue
    if last_error is not None:
        raise last_error
    return []


async def _build_member_index(
    repo: OffkaiNocoDbRepo,
    *,
    event_id: int,
) -> tuple[dict[int, list[int]], list[MemberIndexRow]]:
    regs = await repo.list_registrations_for_event(event_id=event_id)

    registrations_by_member_id: dict[int, list[int]] = {}
    member_ids: set[int] = set()

    for reg in regs:
        fields = _nc_fields(reg)
        member_id = _nc_int(fields.get("member_id"))
        if member_id is None:
            linked = fields.get("member")
            if isinstance(linked, list) and linked and isinstance(linked[0], dict):
                member_id = _nc_int(linked[0].get("id"))
        reg_id = _nc_int(reg.get("id"))
        if member_id is None or reg_id is None:
            continue
        member_ids.add(member_id)
        registrations_by_member_id.setdefault(member_id, []).append(reg_id)

    members_by_id = await repo.list_members_by_ids(member_ids=sorted(member_ids))

    index: list[MemberIndexRow] = []
    for member_id, member in members_by_id.items():
        fields = _nc_fields(member)
        user_id = str(fields.get("user_id") or "").strip()
        username = str(fields.get("username") or "").strip()
        display_name = str(fields.get("display_name") or "").strip()
        index.append(
            MemberIndexRow(
                member_id=int(member_id),
                user_id=user_id,
                username=username,
                display_name=display_name,
            )
        )

    return registrations_by_member_id, index


def _match_member_ids(tokens: list[str], index: list[MemberIndexRow]) -> set[int]:
    matched: set[int] = set()
    token_norms = [_norm(t) for t in tokens if t.strip()]

    for token in token_norms:
        if token.isdigit():
            for row in index:
                if row.user_id == token:
                    matched.add(row.member_id)
            continue

        for row in index:
            if _norm(row.username) == token or _norm(row.display_name) == token:
                matched.add(row.member_id)

    return matched


async def async_main() -> None:
    parser = argparse.ArgumentParser(
        description="Mark paid registrations from CSV by matching Discord identifier"
    )
    parser.add_argument("--event-id", type=int, required=True)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="apply updates (default: dry-run)",
    )
    parser.add_argument(
        "--include-pending",
        action="store_true",
        help="treat 支払確認中 as paid candidate too",
    )
    parser.add_argument(
        "--status",
        action="append",
        default=[],
        help="target status value from CSV (can be specified multiple times)",
    )
    parser.add_argument(
        "--ticket-number-only",
        action="store_true",
        help="only update ticket_number (do not change has_paid)",
    )
    args = parser.parse_args()

    if args.status:
        statuses = {str(s).strip() for s in args.status if str(s).strip()}
    else:
        statuses = set(PAID_STATUSES)
        if args.include_pending:
            statuses.add("支払確認中")

    config = load_config()

    nocodb = NocoDbClient(
        config=NocoDbConfig(
            base_url=config.nocodb_base_url,
            token=config.nocodb_token,
            base_id=config.nocodb_base_id,
        )
    )
    repo = OffkaiNocoDbRepo(
        client=nocodb,
        ids=NocoDbIds(
            base_id=config.nocodb_base_id,
            table_event=config.nocodb_table_event,
            table_panel=config.nocodb_table_panel,
            table_registration=config.nocodb_table_registration,
            table_member=config.nocodb_table_member,
        ),
    )

    try:
        registrations_by_member_id, index = await _build_member_index(
            repo, event_id=args.event_id
        )

        candidates = 0
        updated_regs = 0
        unmatched = 0
        ambiguous = 0

        rows = _read_csv_rows(args.csv)
        for row in rows:
            status = str(row.get("ステータス") or "").strip()
            if status not in statuses:
                continue

            candidates += 1
            identifier = str(row.get("Your Discord username / ID") or "").strip()
            discord_id = str(row.get("Discord ID") or "").strip()
            ticket_number = str(row.get("チケット番号") or "").strip()

            tokens = _extract_tokens(identifier, discord_id)
            matched_member_ids = _match_member_ids(tokens, index)

            if len(matched_member_ids) == 0:
                unmatched += 1
                print(f"[UNMATCHED] id={identifier!r} discord_id={discord_id!r} ticket={ticket_number!r}")
                continue
            if len(matched_member_ids) > 1:
                ambiguous += 1
                print(
                    f"[AMBIGUOUS] id={identifier!r} discord_id={discord_id!r} members={sorted(matched_member_ids)}"
                )
                continue

            member_id = next(iter(matched_member_ids))
            reg_ids = registrations_by_member_id.get(member_id, [])
            if not reg_ids:
                unmatched += 1
                print(f"[NO-REG] member_id={member_id} id={identifier!r}")
                continue

            for reg_id in reg_ids:
                if args.apply:
                    fields: dict[str, Any]
                    if args.ticket_number_only:
                        fields = {
                            "ticket_number": ticket_number,
                        }
                    else:
                        fields = {
                            "has_paid": True,
                            "ticket_number": ticket_number,
                        }
                    await repo.update_registration(
                        registration_id=reg_id,
                        fields=fields,
                    )
                updated_regs += 1
                print(
                    f"[{'APPLY' if args.apply else 'DRY'}] reg_id={reg_id} member_id={member_id} ticket_number={ticket_number!r} has_paid_changed={not args.ticket_number_only}"
                )

        print("---")
        print(
            "summary "
            f"candidates={candidates} updated_regs={updated_regs} unmatched={unmatched} ambiguous={ambiguous} mode={'apply' if args.apply else 'dry-run'}"
        )
    finally:
        await nocodb.aclose()


if __name__ == "__main__":
    asyncio.run(async_main())
