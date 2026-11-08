"""One OggStudio instance, no settings needed."""

from __future__ import annotations

from typing import Any

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN, OGG_DOMAIN


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
