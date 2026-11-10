"""One OggStudio instance. Its options are about privacy."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, OGG_DOMAIN
from .privacy import DEFAULTS, hash_pin


class OggStudioConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if not self.hass.config_entries.async_entries(OGG_DOMAIN):
            return self.async_abort(reason="ogg_required")
        if user_input is not None:
            await self.async_set_unique_id(DOMAIN)
            return self.async_create_entry(title="OggStudio", data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> config_entries.OptionsFlow:
        return OggStudioOptionsFlow()


class OggStudioOptionsFlow(config_entries.OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        entry = self.config_entry
        errors: dict[str, str] = {}
        if user_input is not None:
            options = dict(entry.options)
            pin = str(user_input.pop("pin", "") or "").strip()
            remove = bool(user_input.pop("remove_pin", False))
            options.update(user_input)
            options["discreet_name"] = str(options.get("discreet_name") or "").strip()[:40] or DEFAULTS["discreet_name"]
            if remove:
                options.pop("pin_hash", None)
                options.pop("pin_salt", None)
            elif pin:
                if not 4 <= len(pin) <= 32:
                    errors["pin"] = "pin_length"
                else:
                    options["pin_hash"], options["pin_salt"] = await self.hass.async_add_executor_job(hash_pin, pin)
            if not errors:
                return self.async_create_entry(title="", data=options)

        def now(key: str) -> Any:
            return entry.options.get(key, DEFAULTS[key])

        users = {u.id: u.name or u.id for u in await self.hass.auth.async_get_users()
                 if not u.system_generated and u.is_active}
        schema = vol.Schema({
            vol.Required("no_history", default=now("no_history")): cv.boolean,
            vol.Required("discreet", default=now("discreet")): cv.boolean,
            vol.Optional("discreet_name", default=now("discreet_name")): cv.string,
            vol.Optional("users", default=[u for u in now("users") if u in users]): cv.multi_select(users),
            vol.Optional("pin"): cv.string,
            vol.Optional("remove_pin", default=False): cv.boolean,
            vol.Required("auto_lock", default=now("auto_lock")): vol.All(vol.Coerce(int), vol.Range(min=0, max=240)),
        })
        return self.async_show_form(
            step_id="init", data_schema=schema, errors=errors,
            description_placeholders={"pin": "set" if entry.options.get("pin_hash") else "not set"})
