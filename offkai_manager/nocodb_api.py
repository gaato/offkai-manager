from __future__ import annotations

import json
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any, Iterable, Optional

import httpx

log = logging.getLogger(__name__)


class NocoDbError(RuntimeError):
    pass


@dataclass(frozen=True)
class NocoDbConfig:
    base_url: str
    token: str
    base_id: str


class NocoDbClient:
    def __init__(
        self,
        *,
        config: NocoDbConfig,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._config = config
        self._client = httpx.AsyncClient(
            base_url=config.base_url.rstrip("/"),
            headers={
                "accept": "application/json",
                "content-type": "application/json",
                # NocoDB v3 supports either xc-token or Authorization: Bearer.
                "xc-token": config.token,
            },
            timeout=timeout_seconds,
            follow_redirects=True,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    def _path(self, table_id: str, *, suffix: str) -> str:
        return f"/api/v3/data/{self._config.base_id}/{table_id}/{suffix.lstrip('/')}"

    def _short(self, value: Any, *, limit: int = 400) -> str:
        try:
            s = str(value)
        except Exception:
            return ""
        if len(s) <= limit:
            return s
        return s[:limit] + "..."

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json_body: Any = None,
    ) -> tuple[str, httpx.Response, float]:
        req_id = secrets.token_hex(4)
        t0 = time.monotonic()
        try:
            r = await self._client.request(method, path, params=params, json=json_body)
        except httpx.RequestError as e:
            dt_ms = (time.monotonic() - t0) * 1000.0
            log.error(
                "NocoDB request failed req_id=%s method=%s path=%s ms=%.1f error=%s",
                req_id,
                method,
                path,
                dt_ms,
                self._short(repr(e)),
                exc_info=e,
            )
            raise NocoDbError(
                f"NocoDB request failed req_id={req_id} method={method} path={path} error={e!r}"
            ) from e

        dt_ms = (time.monotonic() - t0) * 1000.0
        # Keep normal traffic quiet at INFO; DEBUG has full trace.
        log.debug(
            "NocoDB request ok req_id=%s method=%s path=%s ms=%.1f status=%s",
            req_id,
            method,
            path,
            dt_ms,
            r.status_code,
        )
        # If it is slow enough to matter, surface at INFO.
        if dt_ms >= 1500.0:
            log.info(
                "NocoDB request slow req_id=%s method=%s path=%s ms=%.1f status=%s",
                req_id,
                method,
                path,
                dt_ms,
                r.status_code,
            )
        return req_id, r, dt_ms

    def _raise_for_status(self, r: httpx.Response, *, req_id: str) -> None:
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            try:
                payload = r.json()
                detail = json.dumps(payload, ensure_ascii=False)
            except Exception:
                detail = r.text
            log.error(
                "NocoDB API error req_id=%s status=%s url=%s body=%s",
                req_id,
                r.status_code,
                str(r.request.url),
                self._short(detail, limit=2000),
            )
            raise NocoDbError(
                f"NocoDB API error req_id={req_id} status={r.status_code} url={r.request.url} body={detail}"
            ) from e

    async def list_records(
        self,
        *,
        table_id: str,
        where: Optional[str] = None,
        fields: Optional[Iterable[str]] = None,
        sort: Optional[list[dict[str, str]]] = None,
        page: int = 1,
        page_size: int = 200,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "pageSize": page_size}
        if where:
            params["where"] = where
        if fields:
            params["fields"] = list(fields)
        if sort:
            params["sort"] = sort

        path = self._path(table_id, suffix="records")
        req_id, r, _ = await self._request("GET", path, params=params)
        self._raise_for_status(r, req_id=req_id)
        return r.json()

    async def get_record(
        self,
        *,
        table_id: str,
        record_id: str | int,
        fields: Optional[Iterable[str]] = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if fields:
            params["fields"] = list(fields)
        path = self._path(table_id, suffix=f"records/{record_id}")
        req_id, r, _ = await self._request("GET", path, params=params)
        self._raise_for_status(r, req_id=req_id)
        return r.json()

    async def create_records(
        self,
        *,
        table_id: str,
        records: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        # Swagger allows either a single object or array; we always send an array.
        payload = [{"fields": r} for r in records]
        path = self._path(table_id, suffix="records")
        req_id, r, _ = await self._request("POST", path, json_body=payload)
        self._raise_for_status(r, req_id=req_id)
        data = r.json()
        return list(data.get("records", []))

    async def update_records(
        self,
        *,
        table_id: str,
        records: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        # records: [{"id": <pk>, "fields": {...}}, ...]
        path = self._path(table_id, suffix="records")
        req_id, r, _ = await self._request("PATCH", path, json_body=records)
        self._raise_for_status(r, req_id=req_id)
        data = r.json()
        return list(data.get("records", []))

    async def delete_records(
        self,
        *,
        table_id: str,
        record_ids: list[str | int],
    ) -> None:
        payload = [{"id": rid} for rid in record_ids]
        path = self._path(table_id, suffix="records")
        req_id, r, _ = await self._request("DELETE", path, json_body=payload)
        self._raise_for_status(r, req_id=req_id)

    async def count(self, *, table_id: str, where: Optional[str] = None) -> int:
        params: dict[str, Any] = {}
        if where:
            params["where"] = where
        path = self._path(table_id, suffix="count")
        req_id, r, _ = await self._request("GET", path, params=params)
        self._raise_for_status(r, req_id=req_id)
        data = r.json()
        return int(data.get("count", 0))
