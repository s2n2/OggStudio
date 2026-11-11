"""Serve the bundled OggStudio card and register it as a Lovelace resource."""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlsplit

from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

CARD_PATH = "/oggstudio/oggstudio-card.js"
CARD_VERSION = "0.15.9"
CARD_URL = f"{CARD_PATH}?v={CARD_VERSION}"
CARD_FILE = Path(__file__).parent / "frontend" / "oggstudio-card.js"


async def async_register_card(hass: HomeAssistant) -> None:
    try:
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_PATH, str(CARD_FILE), False)]
        )
    except RuntimeError:
        _LOGGER.debug("OggStudio card path is already registered")
    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        return
    if getattr(lovelace, "resource_mode", getattr(lovelace, "mode", "storage")) != "storage":
        return
    resources = lovelace.resources
    if hasattr(resources, "async_get_info"):
        await resources.async_get_info()
    elif not getattr(resources, "loaded", False):
        await resources.async_load()
    matches = [i for i in resources.async_items() if urlsplit(i.get("url", "")).path == CARD_PATH]
    if matches:
        if matches[0].get("url") != CARD_URL:
            await resources.async_update_item(matches[0]["id"], {"url": CARD_URL, "res_type": "module"})
        return
    await resources.async_create_item({"url": CARD_URL, "res_type": "module"})
