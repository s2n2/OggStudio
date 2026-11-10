"""A Stop everything button: for automations, a physical button, or a voice assistant."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .safety import async_panic


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([PanicButton(entry)])


class PanicButton(ButtonEntity):
    _attr_has_entity_name = True
    _attr_translation_key = "stop_everything"
    _attr_icon = "mdi:stop-circle"

    def __init__(self, entry: ConfigEntry) -> None:
        self._attr_unique_id = f"{entry.entry_id}:panic"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)}, name="OggStudio", manufacturer="Ogg",
            model="Pattern studio",
        )

    async def async_press(self) -> None:
        await async_panic(self.hass)
