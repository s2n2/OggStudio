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
* **Stroke recorder** (for a Handy or other stroker): set an upper and lower limit, hold
  Slow, Medium or Fast to stroke between them, and record a stroke funscript.
* **Run modes**: stroke scripts are kept as they are and turned into vibration when they
  play, by speed, position, both, or downstrokes or upstrokes only. Each saved script
  remembers the mode last used for it.
* **No device**: record without a device connected.

Playback runs inside Ogg's own frame loop (Ogg 2.1+), so timing does not
depend on the dashboard or network.

## Cards

Five cards come with OggStudio. Pick one that fits the dashboard, or use several:

| Card | Type | Shows |
|---|---|---|
| OggStudio | `custom:oggstudio-card` | Everything: record, library, video sync, import |
| OggStudio Recorder | `custom:oggstudio-recorder-card` | Big touch pads to record or play live, then save |
| OggStudio Player | `custom:oggstudio-player-card` | Saved patterns with speed and loop, plus import |
| OggStudio Video | `custom:oggstudio-video-card` | Video sync and recording a funscript for a video |
| OggStudio Stroke | `custom:oggstudio-stroke-card` | Stroke recorder with limits and three speeds (for a Handy) |

Every card takes an optional `title`. The full card also takes `sections`, a list
from `record`, `stroke`, `take`, `library`, `video` and `import`, to build your own mix
(the full card leaves out `stroke` unless you list it):

```yaml
type: custom:oggstudio-card
title: Bedroom studio
sections: [library, video, take]
```

The device picked in one card is remembered for all of them. Pick **No device (record only)**
to record without a device: nothing is sent, and the take can be saved or downloaded as usual.

## Stroke recorder

The **OggStudio Stroke** card records stroke funscripts, the kind a Handy plays, with two
limits and three speeds. On the OggStudio and Recorder cards, the **〰 Vibrate / ↕ Stroke**
toggle at the top of the Record section switches between the pads and this stroke recorder
(remembered per card type):

* **Hold Slow, Medium or Fast** to stroke between the lower and upper limit. Let go and it
  stops where it is. Each speed is a fixed time per stroke (1.6 s, 0.9 s or 0.5 s up and
  down), whatever the range.
* **Range bar** (left): drag the top or bottom edge to move that limit, or drag the middle
  to move the whole range without changing its width.
* **Position bar** (right): touch to move the stroker there by hand. Until it reaches your
  finger it moves no faster than the last speed button you used (Slow if none), so a stray
  touch at the far end never makes it jump. Once it has caught up it follows your finger
  directly, fast or slow.
* **Set limit** makes the current position a limit (handy on a controller). Above the other limit, it becomes the
  upper one; below it, the lower one. The first limit after a reset replaces whichever end
  is nearer. The limits are remembered per browser.
* **Reset limits** goes back to the full range, 0 to 100.
* **Record** starts and stops. The take is a stroke script: save it, copy its code, or press
  **Download** for a `.funscript` to load onto a Handy.

With a vibration device chosen, the device follows live using the mode picked under the bar.

On a game controller the defaults are: D-pad left, down and right for slow, medium and fast,
D-pad up or X for Set limit, B for Reset limits and A for Record. **Learn controls** on this
card maps its own buttons, separately from the other cards.

## Run modes

Stroke scripts (recorded on the Stroke card, or imported) are kept as positions and turned into
vibration when they play. The Take, Library and Video panels have a **Run as** choice:

| Mode | Vibration |
|---|---|
| Speed | How fast it moves: a full stroke in a quarter second = 100% |
| Position | The position itself (also how vibration scripts play) |
| Speed + position | Speed sets the strength, and position adds up to 35% of what is left above it. Fast strokes still reach 100%, while slow strokes and holds high up still register |
| Speed, downstrokes only | Speed while moving down, nothing on the way up: one pulse per stroke |
| Speed, upstrokes only | The same on the way up |

Each saved stroke script remembers the mode it was last played with, from the card or from
`oggstudio.play` with `mode`. Vibration scripts play as they are.

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

Script files are run with the **Run as** mode: Speed suits stroke funscripts made for videos,
Position suits scripts that already describe intensity.

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

Hat-switch D-pads, which report all four directions on one axis, are recognised. So are
buttons that read as pressed all the time, which are ignored. If Android lists extra devices
as gamepads, the card uses the one you press buttons on. While learning, a line under the
prompt shows the controller's raw readings. Each step is also written to the Home Assistant
log (Settings → System → Logs, search "OggStudio controller"), which helps when diagnosing an
odd controller. The mapping,
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

Stroke scripts are marked with `"metadata": {"type": "stroke"}` and kept as positions; see
[Run modes](#run-modes). When importing, **Automatic** treats a script as a stroke script unless
it says it is a vibration script.

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
| `oggstudio.play` | Play a saved script (`name`) or a given `script` on an Ogg device (`entity_id`), with `speed`, `loop` and, for stroke scripts, `mode` (speed, position, combo, down, up) |
| `oggstudio.set_mode` | Remember the run mode for a saved stroke script |
| `oggstudio.stop` | Stop playback on a device |
| `oggstudio.save` / `delete` / `rename` | Manage the library |
| `oggstudio.get_script` | Return a saved script (for export) |

Entities: **Saved script** (select) and **Replay speed** (select).

Synced video playback (following a media player's position) is planned.
