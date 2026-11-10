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
from .convert import RUN_MODES, run_script
from .library import Library, clean_script, limit_script, script_info
from .privacy import async_setup_privacy, async_setup_privacy_entry, require_user
from .safety import async_panic, async_setup_safety, device_limits
from .together import async_setup_together
from .video import async_setup_video

_LOGGER = logging.getLogger(__name__)

type OggStudioConfigEntry = ConfigEntry[Library]

SAVE_SCHEMA = vol.Schema({vol.Required("name"): cv.string, vol.Required("script"): dict,
                          vol.Optional("mode"): vol.In(RUN_MODES)})
MODE_SCHEMA = vol.Schema({vol.Required("name"): cv.string, vol.Required("mode"): vol.In(RUN_MODES)})
NAME_SCHEMA = vol.Schema({vol.Required("name"): cv.string})
RENAME_SCHEMA = vol.Schema({vol.Required("name"): cv.string, vol.Required("new_name"): cv.string})
PLAY_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("name"): cv.string,
        vol.Optional("script"): dict,
        vol.Optional("speed"): vol.Any(vol.In(SPEEDS), vol.All(vol.Coerce(float), vol.Range(min=0.25, max=4))),
        vol.Optional("loop", default=False): cv.boolean,
        vol.Optional("mode"): vol.In(RUN_MODES),
    }
)
STOP_SCHEMA = vol.Schema({vol.Required("entity_id"): cv.entity_id})
CLAIM_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("owner"): vol.All(cv.string, vol.Length(min=1, max=80)),
        vol.Optional("label", default=""): cv.string,
        vol.Optional("release", default=False): cv.boolean,
    }
)
LIMITS_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("max", default=100): vol.All(vol.Coerce(float), vol.Range(min=0, max=100)),
        vol.Optional("lo", default=0): vol.All(vol.Coerce(float), vol.Range(min=0, max=100)),
        vol.Optional("hi", default=100): vol.All(vol.Coerce(float), vol.Range(min=0, max=100)),
        vol.Optional("speed", default=100): vol.All(vol.Coerce(float), vol.Range(min=5, max=100)),
    }
)
PLAYLIST_SCHEMA = vol.Schema({vol.Required("name"): cv.string, vol.Required("items"): list,
                              vol.Optional("loop", default=False): cv.boolean})


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
    await async_setup_video(hass)
    await async_setup_safety(hass)
    await async_setup_privacy(hass)
    await async_setup_together(hass)

    def guarded(handler: Any) -> Any:
        """Only the allowed users (when some are chosen); automations always."""
        async def run(call: ServiceCall) -> Any:
            require_user(hass, call.context.user_id)
            return await handler(call)
        return run

    async def panic(call: ServiceCall) -> ServiceResponse:
        stopped = await async_panic(hass)
        return {"stopped": stopped} if call.return_response else None

    async def set_limits(call: ServiceCall) -> None:
        _library(hass).set_limits(call.data["entity_id"], {k: call.data[k] for k in ("max", "lo", "hi", "speed")})

    async def save_playlist(call: ServiceCall) -> ServiceResponse:
        name = _library(hass).save_playlist(call.data["name"], call.data["items"], call.data["loop"])
        return {"name": name} if call.return_response else None

    async def delete_playlist(call: ServiceCall) -> None:
        _library(hass).delete_playlist(call.data["name"])

    async def save(call: ServiceCall) -> ServiceResponse:
        name = _library(hass).save(call.data["name"], call.data["script"], call.data.get("mode"))
        return {"name": name}

    async def claim(call: ServiceCall) -> None:
        _library(hass).claim(call.data["entity_id"], call.data["owner"], call.data["label"],
                             call.data["release"])

    async def set_mode(call: ServiceCall) -> None:
        _library(hass).set_mode(call.data["name"], call.data["mode"])

    async def delete(call: ServiceCall) -> None:
        _library(hass).delete(call.data["name"])

    async def rename(call: ServiceCall) -> None:
        _library(hass).rename(call.data["name"], call.data["new_name"])

    async def get_script(call: ServiceCall) -> ServiceResponse:
        script = _library(hass).get(call.data["name"])
        return {"name": call.data["name"], "script": script, **script_info(script)}

    async def play(call: ServiceCall) -> None:
        library = _library(hass)
        name: str | None = None
        if "script" in call.data:
            script = clean_script(call.data["script"])
        elif "name" in call.data or library.selected:
            name = call.data.get("name") or library.selected
            script = library.get(name)
        else:
            raise HomeAssistantError("Choose a saved script or give a script to play")
        # Stroke scripts are converted with the run mode given, else the one
        # last used for that script; giving one remembers it.
        mode = call.data.get("mode")
        if name and mode:
            library.set_mode(name, mode)
        script = run_script(script, mode or (library.mode(name) if name else None))
        script = limit_script(script, device_limits(hass, library, call.data["entity_id"]))
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

    hass.services.async_register(DOMAIN, "save", guarded(save), schema=SAVE_SCHEMA,
                                 supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "delete", guarded(delete), schema=NAME_SCHEMA)
    hass.services.async_register(DOMAIN, "set_mode", guarded(set_mode), schema=MODE_SCHEMA)
    hass.services.async_register(DOMAIN, "claim", guarded(claim), schema=CLAIM_SCHEMA)
    hass.services.async_register(DOMAIN, "rename", guarded(rename), schema=RENAME_SCHEMA)
    hass.services.async_register(DOMAIN, "get_script", guarded(get_script), schema=NAME_SCHEMA,
                                 supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "play", guarded(play), schema=PLAY_SCHEMA)
    hass.services.async_register(DOMAIN, "set_limits", guarded(set_limits), schema=LIMITS_SCHEMA)
    hass.services.async_register(DOMAIN, "save_playlist", guarded(save_playlist), schema=PLAYLIST_SCHEMA,
                                 supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "delete_playlist", guarded(delete_playlist), schema=NAME_SCHEMA)
    # Stopping is never refused.
    hass.services.async_register(DOMAIN, "stop", stop, schema=STOP_SCHEMA)
    hass.services.async_register(DOMAIN, "panic", panic, schema=vol.Schema({}),
                                 supports_response=SupportsResponse.OPTIONAL)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: OggStudioConfigEntry) -> bool:
    library = Library(hass, entry.entry_id)
    await library.async_load()
    entry.runtime_data = library
    async_setup_privacy_entry(hass, entry)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: OggStudioConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
