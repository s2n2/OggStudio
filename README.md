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
* **Game controller**: record with a Bluetooth gamepad. Up and down set the level,
  left and right set how fast it moves, and a button starts and stops recording.

Playback runs inside Ogg's own frame loop (Ogg 2.1+), so timing does not
depend on the dashboard or network.

## Cards

Four cards come with OggStudio. Pick one that fits the dashboard, or use several:

| Card | Type | Shows |
|---|---|---|
| OggStudio | `custom:oggstudio-card` | Everything: record, library, video sync, import |
| OggStudio Recorder | `custom:oggstudio-recorder-card` | Big touch pads to record or play live, then save |
| OggStudio Player | `custom:oggstudio-player-card` | Saved patterns with speed and loop, plus import |
| OggStudio Video | `custom:oggstudio-video-card` | Video sync and recording a funscript for a video |

Every card takes an optional `title`. The full card also takes `sections`, a list
from `record`, `take`, `library`, `video` and `import`, to build your own mix:

```yaml
type: custom:oggstudio-card
title: Bedroom studio
sections: [library, video, take]
```

The device picked in one card is remembered for all of them.

## Video sync

The card's **Video sync** panel plays a video alongside a script:

1. Choose a video on your phone or computer.
2. Choose a script: a `.funscript` file on the same device (two files give a two-motor
   toy one track per motor), or a script from your OggStudio library.
3. Press **Go**.

The video never leaves your device. The browser plays it straight from the local file, and
nothing is uploaded to Home Assistant. While the video plays, the card reads the video's
position about ten times a second and sends the matching level with `ogg.live`. Pausing,
seeking and changing playback speed stay in sync, and pausing stops the toy. **Sync offset**
(remembered per browser) sends each moment slightly early to make up for Bluetooth delay.

### Making a script for a video

Under the video there is one bar per motor and a small **● Rec** button. Press Rec, play the
video and drag the bars left and right. The toy follows your finger, and each level is
recorded against the video's own time, so the script lines up with that video. You can pause,
scrub back and record a section again: the newer pass replaces what was there. When you're
done, press **Use as take** (it replays with the video straight away, and you can save it to
the library) or **Download .funscript** (saved with the video's name).

Stroke funscripts made for videos are converted using movement speed, so faster strokes give
stronger vibration. Choose "Vibration script" for scripts that already describe intensity.

## Game controller

You can record with a small Bluetooth gamepad paired to your phone instead of your finger.
Tick **🎮 Controller** on the Recorder or Video card. It ticks itself when a controller
connects; Chrome only reports a controller after you press one of its buttons.

| Control | Default | Does |
|---|---|---|
| Up / down | D-pad or left stick, arrow keys | Moves the level up or down at the current speed while held. A stick is proportional: push it half way to move at half speed |
| Left / right | D-pad or left stick, arrow keys | Steps the speed: 15, 30, 60, 100, 180 or 300 % per second |
| Record | A (button 0), Enter | Starts or stops recording. With a video loaded, it starts **● Rec** and plays the video; pressing it again stops and pauses |
| Level to 0 | B (button 1), Esc | Drops straight to 0 |
| Switch motor | Y (button 3) | Two-motor devices: motor 1, motor 2, or both |

The level stays where you leave it. Recording works as it does with the pads: the device
follows live and every change is saved in the take.

Generic controllers number their buttons in different ways, and some have axes that jitter or
rest off-centre. Press **Learn controls** to map yours:

1. Press any button to wake the controller, then leave it alone for a moment while the card
   measures where each axis rests and how much it jitters.
2. Press the button you want for **Record**.
3. For each other control, **hold it, then press Record** to confirm. The card takes whatever
   moved furthest beyond its normal jitter. Pressing Record with nothing held, or **Skip**,
   keeps the default.

Hat-switch D-pads, which report all four directions on one axis, are recognised. The mapping,
the speed and the on/off setting are remembered per browser. Controllers in keyboard mode,
which send arrow keys, also work: press a key for Record, then a key for each control. A
keyboard on a computer works the same way.

**HTTPS needed for gamepads.** Chrome hides gamepads from pages that are not served over
HTTPS, so a dashboard opened as `http://192.168.x.x:8123` cannot see them. In that case the
status line says so. You can fix it by:

* opening Home Assistant through an HTTPS address (Nabu Casa, or your own certificate), or
* in Chrome on the phone, opening `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
  adding your Home Assistant address (for example `http://192.168.1.10:8123`), enabling it
  and relaunching Chrome, or
* switching the controller to keyboard mode, which works without HTTPS.

Use Chrome itself rather than the Companion app if the Companion app doesn't see the
controller.

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
3. Add one of the OggStudio cards (see [Cards](#cards)) to a dashboard (the card resource is registered
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
