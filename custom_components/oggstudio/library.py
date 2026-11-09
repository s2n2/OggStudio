"""Saved scripts (funscript timelines) kept in Home Assistant storage."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN, MAX_NAME_LENGTH, MAX_SCRIPTS, SPEEDS, STORAGE_VERSION
from .convert import RUN_MODES, is_stroke

MAX_ACTIONS = 200_000
MAX_MS = 6 * 60 * 60 * 1000


def _clean_actions(raw: Any) -> list[dict[str, int]]:
    if not isinstance(raw, list) or len(raw) > MAX_ACTIONS:
        raise HomeAssistantError("A script needs a list of actions")
    actions = []
    for item in raw:
        if not isinstance(item, dict):
            raise HomeAssistantError("Invalid script action")
        at, pos = item.get("at"), item.get("pos")
        if isinstance(at, bool) or not isinstance(at, (int, float)) or not 0 <= at <= MAX_MS:
            raise HomeAssistantError("Invalid action time")
        if isinstance(pos, bool) or not isinstance(pos, (int, float)) or not math.isfinite(pos):
            raise HomeAssistantError("Invalid action position")
        actions.append({"at": int(at), "pos": int(round(min(100, max(0, pos))))})
    actions.sort(key=lambda action: action["at"])
    return actions


def clean_script(script: Any) -> dict[str, Any]:
    """Validate and normalise a funscript (with optional second motor)."""
    if not isinstance(script, dict):
        raise HomeAssistantError("A script must be a funscript object")
    clean: dict[str, Any] = {
        "version": "1.0",
        "inverted": bool(script.get("inverted", False)),
        "range": 100,
        "actions": _clean_actions(script.get("actions")),
    }
    channels = script.get("channels")
    if isinstance(channels, dict) and isinstance(channels.get("V1"), dict):
        clean["channels"] = {"V1": {"actions": _clean_actions(channels["V1"].get("actions"))}}
    if not clean["actions"]:
        raise HomeAssistantError("The script has no actions")
    metadata = script.get("metadata")
    if isinstance(metadata, dict):
        clean["metadata"] = {
            k: v for k, v in metadata.items()
            if isinstance(k, str) and isinstance(v, (str, int, float, bool)) and len(str(v)) < 500
        }
    return clean


def script_info(script: dict[str, Any]) -> dict[str, Any]:
    second = script.get("channels", {}).get("V1", {}).get("actions") or [{"at": 0}]
    first = script["actions"] or [{"at": 0}]
    duration = max(first[-1]["at"], second[-1]["at"])
    return {"duration_ms": duration, "motors": 2 if "channels" in script else 1,
            "actions": len(script["actions"]), "kind": "stroke" if is_stroke(script) else "vibration"}


class Library:
    """Named scripts plus the shared playback speed."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self._store = Store[dict[str, Any]](hass, STORAGE_VERSION, f"{DOMAIN}.{entry_id}")
        self.scripts: dict[str, dict[str, Any]] = {}
        self.selected: str | None = None
        self.speed = "1x"
        self._listeners: set[Callable[[], None]] = set()

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        scripts = data.get("scripts", {})
        if isinstance(scripts, dict):
            for name, record in scripts.items():
                try:
                    self.scripts[name] = {
                        "script": clean_script(record.get("script")),
                        "saved": record.get("saved"),
                    }
                    if record.get("mode") in RUN_MODES:
                        self.scripts[name]["mode"] = record["mode"]
                except (HomeAssistantError, AttributeError):
                    continue
        if data.get("speed") in SPEEDS:
            self.speed = data["speed"]
        if data.get("selected") in self.scripts:
            self.selected = data["selected"]

    def _save(self) -> None:
        self._store.async_delay_save(
            lambda: {"scripts": self.scripts, "speed": self.speed, "selected": self.selected}, 1
        )

    @callback
    def add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    def _notify(self) -> None:
        for listener in tuple(self._listeners):
            listener()

    @staticmethod
    def _name(name: Any) -> str:
        if not isinstance(name, str) or not name.strip():
            raise HomeAssistantError("Give the script a name")
        name = " ".join(name.split())
        if len(name) > MAX_NAME_LENGTH:
            raise HomeAssistantError(f"Names can be at most {MAX_NAME_LENGTH} characters")
        return name

    def save(self, name: Any, script: Any, mode: str | None = None) -> str:
        name = self._name(name)
        if name not in self.scripts and len(self.scripts) >= MAX_SCRIPTS:
            raise HomeAssistantError("The library is full; delete some scripts first")
        clean = clean_script(script)
        clean.setdefault("metadata", {})["title"] = name
        self.scripts[name] = {"script": clean, "saved": dt_util.utcnow().isoformat()}
        if mode in RUN_MODES and is_stroke(clean):
            self.scripts[name]["mode"] = mode
        self.selected = name
        self._save()
        self._notify()
        return name

    def delete(self, name: Any) -> None:
        name = self._name(name)
        if self.scripts.pop(name, None) is None:
            raise HomeAssistantError("No saved script has that name")
        if self.selected == name:
            self.selected = next(iter(sorted(self.scripts)), None)
        self._save()
        self._notify()

    def rename(self, name: Any, new_name: Any) -> None:
        name, new_name = self._name(name), self._name(new_name)
        if name not in self.scripts:
            raise HomeAssistantError("No saved script has that name")
        if new_name in self.scripts and new_name != name:
            raise HomeAssistantError("A script with the new name already exists")
        self.scripts[new_name] = self.scripts.pop(name)
        self.scripts[new_name]["script"].setdefault("metadata", {})["title"] = new_name
        if self.selected == name:
            self.selected = new_name
        self._save()
        self._notify()

    def get(self, name: Any) -> dict[str, Any]:
        name = self._name(name)
        if name not in self.scripts:
            raise HomeAssistantError("No saved script has that name")
        return self.scripts[name]["script"]

    def mode(self, name: str) -> str | None:
        """Run mode last used for a saved stroke script."""
        record = self.scripts.get(name)
        return record.get("mode") if record else None

    def set_mode(self, name: Any, mode: str) -> None:
        name = self._name(name)
        record = self.scripts.get(name)
        if record is None:
            raise HomeAssistantError("No saved script has that name")
        if mode not in RUN_MODES:
            raise HomeAssistantError("Unknown run mode")
        if not is_stroke(record["script"]) or record.get("mode") == mode:
            return
        record["mode"] = mode
        self._save()
        self._notify()

    def select(self, name: str) -> None:
        if name in self.scripts:
            self.selected = name
            self._save()
            self._notify()

    def set_speed(self, speed: str) -> None:
        if speed not in SPEEDS:
            raise HomeAssistantError("Unknown speed")
        self.speed = speed
        self._save()
        self._notify()

    @property
    def speed_factor(self) -> float:
        return float(self.speed.rstrip("x"))
