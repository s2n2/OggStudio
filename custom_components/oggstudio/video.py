"""Videos for casting: the card uploads a video here, a TV plays it from here.

A Chromecast (or any TV that Home Assistant can cast to) fetches the video
itself, so a file that only exists in a browser cannot be cast. The card
uploads it in chunks (resumable, any size), then asks the TV's media player to
play ``/api/oggstudio/media/<file>``; Home Assistant signs that path for the TV
(``authSig``), and this view serves it with range requests so the TV can seek.
Only the last few videos are kept.
"""

from __future__ import annotations

import logging
import os
import re
import time
from pathlib import Path

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

UPLOAD_URL = "/api/oggstudio/video"
MEDIA_URL = "/api/oggstudio/media"
EXTENSIONS = {".mp4", ".m4v", ".webm", ".mov", ".mkv", ".ogv"}
KEEP = 3                           # finished videos kept (newest first)
MAX_CHUNK = 12 * 1024 * 1024       # under Home Assistant's 16 MB request limit
MAX_SIZE = 32 * 1024 ** 3
FILE_RE = re.compile(r"^[A-Za-z0-9_-]{1,60}-\d{1,14}\.[a-z0-9]{2,4}$")


def file_id(name: str, size: int) -> str:
    """A stable, safe file name for an uploaded video: same file, same name."""
    stem, ext = os.path.splitext(os.path.basename(str(name)))
    ext = ext.lower() if ext.lower() in EXTENSIONS else ".mp4"
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_")[:40] or "video"
    return f"{safe}-{int(size)}{ext}"


def video_dir(hass: HomeAssistant) -> Path:
    """Where videos live: the media folder when there is one (so they show in
    Home Assistant's media browser too), else the config folder."""
    media = getattr(hass.config, "media_dirs", None) or {}
    base = media.get("local") or next(iter(media.values()), None)
    return Path(base) / "oggstudio" if base else Path(hass.config.path("oggstudio_videos"))


def _received(path: Path, size: int) -> int:
    if path.exists():
        return size
    part = path.with_name(path.name + ".part")
    return part.stat().st_size if part.exists() else 0


def _append(path: Path, offset: int, data: bytes, size: int) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    if offset != have:
        return have                 # out of step: the card resumes from here
    with part.open("ab") as f:
        f.write(data)
    have += len(data)
    if have >= size:
        part.replace(path)
        os.utime(path)
        _prune(path.parent, path)
    return have


def _prune(folder: Path, keep: Path) -> None:
    done = sorted((p for p in folder.iterdir() if FILE_RE.match(p.name)),
                  key=lambda p: p.stat().st_mtime, reverse=True)
    for old in [p for p in done if p != keep][KEEP - 1:]:
        old.unlink(missing_ok=True)
    for part in folder.glob("*.part"):
        if time.time() - part.stat().st_mtime > 86400:
            part.unlink(missing_ok=True)


def _args(request: web.Request) -> tuple[str, int]:
    try:
        size = int(request.query["size"])
        name = request.query["name"]
    except (KeyError, ValueError) as err:
        raise web.HTTPBadRequest(text="name and size are needed") from err
    if not 0 < size <= MAX_SIZE:
        raise web.HTTPBadRequest(text="bad size")
    return name, size


class VideoUploadView(HomeAssistantView):
    """GET: how much of a video is here. POST: the next chunk of it."""

    url = UPLOAD_URL
    name = "api:oggstudio:video"

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    def _reply(self, fid: str, received: int, size: int) -> web.Response:
        return self.json({"file": fid, "received": received, "size": size, "done": received >= size,
                          "url": f"{MEDIA_URL}/{fid}"})

    async def get(self, request: web.Request) -> web.Response:
        name, size = _args(request)
        fid = file_id(name, size)
        path = video_dir(self.hass) / fid
        received = await self.hass.async_add_executor_job(_received, path, size)
        if received >= size:        # cast again: it is the newest again
            await self.hass.async_add_executor_job(os.utime, path)
        return self._reply(fid, received, size)

    async def post(self, request: web.Request) -> web.Response:
        name, size = _args(request)
        try:
            offset = int(request.query.get("offset", "0"))
        except ValueError as err:
            raise web.HTTPBadRequest(text="bad offset") from err
        request._client_max_size = MAX_CHUNK + 1024  # noqa: SLF001 - as Home Assistant's own uploads do
        data = await request.read()
        if len(data) > MAX_CHUNK or offset + len(data) > size:
            raise web.HTTPBadRequest(text="chunk too big")
        fid = file_id(name, size)
        path = video_dir(self.hass) / fid
        received = await self.hass.async_add_executor_job(_append, path, offset, data, size)
        return self._reply(fid, received, size)


class VideoMediaView(HomeAssistantView):
    """Serves an uploaded video (signed path for the TV; range requests)."""

    url = MEDIA_URL + "/{file}"
    name = "api:oggstudio:media"

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(self, request: web.Request, file: str) -> web.StreamResponse:
        if not FILE_RE.match(file):
            raise web.HTTPNotFound
        path = video_dir(self.hass) / file
        if not await self.hass.async_add_executor_job(path.is_file):
            raise web.HTTPNotFound
        return web.FileResponse(path)

    head = get


def async_register_video(hass: HomeAssistant) -> None:
    hass.http.register_view(VideoUploadView(hass))
    hass.http.register_view(VideoMediaView(hass))
