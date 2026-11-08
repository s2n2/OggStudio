# OggStudio

Record, import, save and replay vibration patterns on devices controlled by
[Ogg](https://github.com/s2n2/OggHA) in Home Assistant.

* **Record** with one slider (two for two-motor devices). The sliders drive
  the device live while recording.
* **Save as** a named script, pick it from the library, and **replay** it at
  0.5x to 2x speed, once or looped.
* **Import** funscripts (single file, or two files for two motors), share
  codes or JSON, then play them without saving or save them.
* **Share codes**: `ogg1:` + base64 of the gzipped funscript, easy to paste.

Playback runs inside Ogg's own frame loop (Ogg 2.1+), so timing does not
depend on the dashboard or network.

## Format

Scripts are standard [funscript](https://github.com/OpenFunscripter/OFS)
JSON: `{"version": "1.0", "actions": [{"at": ms, "pos": 0-100}]}`. For
vibration, `pos` is the intensity. A second motor is stored as
`"channels": {"V1": {"actions": [...]}}` (TCode channel naming).

When importing stroke scripts (for example ones made for synced videos),
choose **Movement speed → intensity**: a full 0-100 stroke in a quarter
second becomes 100%. Vibration scripts use **Position → intensity**.

## Install

1. HACS → Integrations → ⋮ → Custom repositories → add
   `https://github.com/s2n2/OggStudio` (category Integration), install, restart.
2. Settings → Devices & services → Add integration → **OggStudio**
   (Ogg 2.1 or later must be set up first).
3. Add the **OggStudio** card to a dashboard (the card resource is registered
   automatically in storage-mode dashboards).

## Services

| Service | What it does |
|---|---|
| `oggstudio.play` | Play a saved script (`name`) or a given `script` on an Ogg device (`entity_id`), with `speed` and `loop` |
| `oggstudio.stop` | Stop playback on a device |
| `oggstudio.save` / `delete` / `rename` | Manage the library |
| `oggstudio.get_script` | Return a saved script (for export) |

Entities: **Saved script** (select) and **Replay speed** (select).

Synced video playback (following a media player's position) is planned.
