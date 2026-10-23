import asyncio
import mimetypes
from pathlib import Path

import httpx


class ApiError(Exception):
    def __init__(self, status: int, uncertain=False, code=None):
        self.status = status
        self.uncertain = uncertain
        self.code = code
        if code == "INVALID_IMAGE_CONTENT":
            super().__init__("精修文件已损坏或无法完整解码，请重新导出后重试")
            return
        super().__init__(f"Picflow HTTP {status}" if status else "Picflow 网络中断")


class Picflow:
    def __init__(self, url: str, transport=None, cookies=None):
        headers = {"X-PicPeak-Integrated-Bridge": "1"}
        self.http = httpx.AsyncClient(
            base_url=url.rstrip("/") + "/api/internal/bridge/",
            headers=headers,
            cookies=cookies,
            timeout=httpx.Timeout(180, connect=10),
            transport=transport,
            follow_redirects=False,
        )

    async def close(self):
        await self.http.aclose()

    async def photos(self, event_id: int):
        photos, page, pages, expected = [], 1, 1, None
        while page <= pages:
            response = None
            for attempt in range(3):
                try:
                    response = await self.http.get(f"events/{event_id}/photos", params={"page": page, "limit": 100})
                except httpx.TransportError:
                    if attempt == 2:
                        raise ApiError(0)
                else:
                    if response.status_code < 400:
                        break
                    if response.status_code not in {429, 500, 502, 503, 504} or attempt == 2:
                        raise ApiError(response.status_code)
                delay = min(30, 2 ** attempt)
                if response is not None:
                    try:
                        delay = min(30, max(delay, float(response.headers.get("Retry-After", "0"))))
                    except ValueError:
                        pass
                await asyncio.sleep(delay)
            payload = response.json()
            total = payload["pagination"].get("filtered")
            if total is not None:
                if expected is not None and total != expected:
                    raise ValueError("Picflow 分页期间照片数量变化，稍后重试")
                expected = total
            photos.extend(payload["photos"])
            pages = int(payload["pagination"]["pages"])
            if pages > 10000:
                raise ValueError("Picflow 分页异常")
            page += 1
        if len({p["id"] for p in photos}) != len(photos):
            raise ValueError("Picflow 分页期间列表变化，拒绝使用不完整选片快照")
        if expected is not None and len(photos) != expected:
            raise ValueError("Picflow 分页不完整，拒绝修改选片文件")
        return photos

    async def replace(self, event_id: int, photo_id: int, file: Path, filename: str):
        # Do not retry a mutation automatically: a lost response may mean the
        # replacement already succeeded. The engine reconciles our marker.
        with file.open("rb") as stream:
            try:
                r = await self.http.post(f"events/{event_id}/photos", data={"replaces_photo_id": str(photo_id)}, files={"photo": (filename, stream, mimetypes.guess_type(filename)[0] or "image/jpeg")})
            except httpx.TransportError:
                raise ApiError(0, uncertain=True)
        if r.status_code >= 400:
            code = None
            if r.status_code == 422:
                try:
                    payload = r.json()
                    code = payload.get("code") if isinstance(payload, dict) else None
                except ValueError:
                    pass
            raise ApiError(r.status_code, uncertain=r.status_code >= 500, code=code)
        try:
            data = r.json()
            if not isinstance(data, dict) or data.get("replaced") is not True or not isinstance(data.get("photo"), dict) or data["photo"].get("id") != photo_id:
                raise ValueError("Unexpected upload response")
        except (ValueError, TypeError, AttributeError):
            raise ApiError(0, uncertain=True)
        return data


# Keep previous internal import names available to integrations during the
# product rebrand.
Phoflow = Picflow
PicPeak = Picflow
