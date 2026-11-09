"""Saved-script and playback-speed selectors."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, NO_SCRIPT, SPEEDS
from .library import Library, script_info


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    library: Library = entry.runtime_data
    async_add_entities([ScriptSelect(entry, library), SpeedSelect(entry, library)])


class _Base(SelectEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry, library: Library, key: str) -> None:
        self.library = library
        self._attr_unique_id = f"{entry.entry_id}:{key}"
        self._attr_translation_key = key
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)}, name="OggStudio", manufacturer="Ogg",
            model="Pattern studio",
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self.library.add_listener(self.async_write_ha_state))


class ScriptSelect(_Base):
    """Saved scripts; the selection is what OggStudio plays by default."""

    _attr_icon = "mdi:playlist-music"

    def __init__(self, entry: ConfigEntry, library: Library) -> None:
        super().__init__(entry, library, "saved_script")

    @property
    def options(self) -> list[str]:
        return sorted(self.library.scripts, key=str.casefold) or [NO_SCRIPT]

    @property
    def current_option(self) -> str:
        return self.library.selected or (self.options[0] if self.library.scripts else NO_SCRIPT)

    @property
    def extra_state_attributes(self) -> dict:
        details = {}
        for name, record in self.library.scripts.items():
            details[name] = {**script_info(record["script"]), "saved": record.get("saved"),
                             "mode": record.get("mode")}
        return {"scripts": details}

    async def async_select_option(self, option: str) -> None:
        self.library.select(option)


class SpeedSelect(_Base):
    _attr_icon = "mdi:speedometer"
    _attr_options = list(SPEEDS)

    def __init__(self, entry: ConfigEntry, library: Library) -> None:
        super().__init__(entry, library, "speed")

    @property
    def current_option(self) -> str:
        return self.library.speed

    async def async_select_option(self, option: str) -> None:
        self.library.set_speed(option)
