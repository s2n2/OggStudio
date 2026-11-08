"""OggStudio: record, import, save and replay patterns, played through Ogg."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, OGG_DOMAIN, PLATFORMS, SPEEDS
from .dashboard_resource import async_register_card
from .library import Library, clean_script, script_info

_LOGGER = logging.getLogger(__name__)

type OggStudioConfigEntry = ConfigEntry[Library]

SAVE_SCHEMA = vol.Schema({vol.Required("name"): cv.string, vol.Required("script"): dict})
NAME_SCHEMA = vol.Schema({vol.Required("name"): cv.string})
RENAME_SCHEMA = vol.Schema({vol.Required("name"): cv.string, vol.Required("new_name"): cv.string})
PLAY_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("name"): cv.string,
        vol.Optional("script"): dict,
        vol.Optional("speed"): vol.Any(vol.In(SPEEDS), vol.All(vol.Coerce(float), vol.Range(min=0.25, max=4))),
        vol.Optional("loop", default=False): cv.boolean,
    }
)
STOP_SCHEMA = vol.Schema({vol.Required("entity_id"): cv.entity_id})


def _library(hass: HomeAssistant) -> Library:
    entries = [e for e in hass.config_entries.async_entries(DOMAIN) if e.state is ConfigEntryState.LOADED]
    if not entries:
        raise HomeAssistantError("Set up OggStudio first")
    return entries[0].runtime_data


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    try:
        await async_register_card(hass)
    except Exception:  # noqa: BLE001 - an optional card must never break the integration
        _LOGGER.exception("Could not register the OggStudio card")

    async def save(call: ServiceCall) -> ServiceResponse:
        name = _library(hass).save(call.data["name"], call.data["script"])
        return {"name": name}

    async def delete(call: ServiceCall) -> None:
        _library(hass).delete(call.data["name"])

    async def rename(call: ServiceCall) -> None:
        _library(hass).rename(call.data["name"], call.data["new_name"])

    async def get_script(call: ServiceCall) -> ServiceResponse:
        script = _library(hass).get(call.data["name"])
        return {"name": call.data["name"], "script": script, **script_info(script)}

    async def play(call: ServiceCall) -> None:
        library = _library(hass)
        if "script" in call.data:
            script = clean_script(call.data["script"])
        elif "name" in call.data:
            script = library.get(call.data["name"])
        elif library.selected:
            script = library.get(library.selected)
        else:
            raise HomeAssistantError("Choose a saved script or give a script to play")
        speed: Any = call.data.get("speed", library.speed)
        factor = float(str(speed).rstrip("x"))
        await hass.services.async_call(
            OGG_DOMAIN,
            "play_script",
            {"entity_id": call.data["entity_id"], "script": script, "speed": factor,
             "loop": call.data["loop"]},
            blocking=True,
        )

    async def stop(call: ServiceCall) -> None:
        await hass.services.async_call(
            OGG_DOMAIN, "stop_script", {"entity_id": call.data["entity_id"]}, blocking=True
        )

    hass.services.async_register(DOMAIN, "save", save, schema=SAVE_SCHEMA,
                                 supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "delete", delete, schema=NAME_SCHEMA)
    hass.services.async_register(DOMAIN, "rename", rename, schema=RENAME_SCHEMA)
    hass.services.async_register(DOMAIN, "get_script", get_script, schema=NAME_SCHEMA,
                                 supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "play", play, schema=PLAY_SCHEMA)
    hass.services.async_register(DOMAIN, "stop", stop, schema=STOP_SCHEMA)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: OggStudioConfigEntry) -> bool:
    library = Library(hass, entry.entry_id)
    await library.async_load()
    entry.runtime_data = library
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: OggStudioConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
