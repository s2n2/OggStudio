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

There is one device choice per card: the **Devices** box (see below). Record, Replay, the
take and library ▶ Play buttons and the video all use it.

## Record and replay

The Record section has two tabs, **● Record** and **▶ Replay**. Replay plays a script in the
card itself, so you can watch it: the pads move in the Vibrate view, the position bar in the
Stroke view. Tap the script button to pick the current take, a saved script or a file. Then
press **▶ Replay**, with a speed (0.5x to 2x) and Loop. Tap the progress bar to jump.

* The devices below follow just as they do when recording, each its own way, so you can
  switch Vibrate / Stroke while it plays to compare. It works with no device too (it just shows).
* Touching a pad, the position bar or a speed button takes over until you let go, then the
  script carries on.
* A stroke script replayed in the Vibrate view is mapped to vibration per device: each device
  (and its pad) has its own follow type, as in the Stroke view. A saved script's remembered
  run mode is used for the first device, and replaying remembers it again.

Replay is driven from the browser about 10 times a second (strokers get each move as it
starts). The take's **▶ Play now** and the Library's **▶ Play** use Replay too, with the
library's speed and Loop. Automations can still play inside Ogg's own frame loop with the
`oggstudio.play` service.

## Moods

The **◎ Mood** tab (beside Record and Replay) has a button for how you want it to feel: Rest,
Soft, Tease, Wave, Gasp, Build, Buzz, Edge, Frantic, Steady, Step, Bold, Embrace, Tip, Long,
Surprise, Grasp, Squeeze, Heartbeat, Ripple, Deep, Peak, Afterglow and Playful.

Each mood has three hand-made combos. Each combo has strokes for a stroker and a vibration
track for vibrators, built in sections that stay in step; Embrace, Squeeze and Heartbeat
give a second vibrator its own alternating track. Tapping a mood plays one of its combos at
random, with small variations, and a different combo follows when it ends (about 30 s each).
🎲 Another switches now, tapping the lit mood (or ■ Stop) stops, and **Strength** scales the
vibration. A mood is its own feel, so it ignores each device's follow type. Strokes stay
within the device's top speed.

## Devices

At the top of every card, the **Devices** box lists up to two outputs and how each one follows.
It is used for everything on the card: recording (Vibrate or Stroke), Replay, the take and
library Play buttons, and video. Each can be a
device, one motor of a two-motor device, or a stroker, so you can mix: two motors of one toy,
two toys, or a stroker and a vibrator. Pick **No device (record only)** to record without one.

* **Vibrate recorder:** choosing a second output adds a second pad, and the take gets two tracks
  (the second is played on motor 2).
* **✨ AI feel** maps by mood instead of by numbers, so a stroker and a vibrator can follow each
  other across toy types, live or from scripts:
  * *Stroke into a vibrator.* It reads stroke speed, rate, length, depth, pauses and whether
    it is speeding up. From that it picks a mood: rest, edge (stopping just after a peak),
    tease, glide, rhythm, build, intense or frantic. Each mood plays a matching pattern, such
    as a heartbeat or flicker for tease, a swell deeper in for glide, a pulse on every
    downstroke for rhythm, pounding or surges for intense, and flutter or buzz for frantic.
  * *Vibration into a stroker.* It reads level, swing, pulse rate and rise. From that it
    picks rest, tease, wave, pulse, steady, strong, buzz or build, and plans matching strokes
    within the device's top speed. Examples: short tip strokes with pauses for tease, one
    stroke per pulse, length following a swell, deep and fast for strong.
  * A new mood has to last about a second before it switches, and patterns re-roll every
    10–24 s. Scripts use a fixed seed, so they preview the same way each time. The current
    mood shows under the device (for example "✨ tease · heartbeat").
* **How each follows** applies to everything: a vibrator by one of the [Run modes](#run-modes)
  (Position passes levels straight through, as before), a stroker by position (**Stroker**).
  In the Vibrate recorder the pads show what you draw and each device gets it mapped its own
  way. A saved stroke script's remembered run mode is used for the first output.

The choices are remembered per browser.

**One controller per device.** The cards run in each phone's or computer's browser, so two people
can record at the same time on different devices. While a card drives a device it claims it in
Home Assistant (`oggstudio.claim`). Another card then shows **Take control (who has it)**
instead of the follow choice, and sends nothing to that device until you press it. A claim
lapses about 12 seconds after a card stops refreshing it (closed page, lost connection).

**Strokers through Ogg.** A stroker (for example a Handy connected to Intiface over Bluetooth)
is driven with "go to this position over this long" moves, sent the moment each stroke turns.
That needs an `ogg.linear` service in Ogg. Until Ogg has one, OggStudio falls back to Ogg's
Position control, which moves over a fixed second, so following is coarse.

## Stroke recorder

The **OggStudio Stroke** card records stroke funscripts, the kind a Handy plays, with two
limits and three speeds. On the OggStudio and Recorder cards, the **〰 Vibrate / ↕ Stroke**
toggle at the top of the Record section switches between the pads and this stroke recorder
(remembered per card type):

* **Hold Slow, Medium or Fast** to stroke between the lower and upper limit. Let go and it
  stops where it is. Each speed is a % of the device's top speed, set with the slider above
  its button (defaults 30%, 55% and 100%). 100% is a full 0 to 100 stroke in a quarter second,
  about 384 mm/s on a Handy's 96 mm of usable travel, close to its roughly 400 mm/s top
  speed.
  The device moves at that speed whatever the range, so a short range just makes quicker
  strokes. The choices are remembered per browser.
* **⟳ Latch** keeps a speed running without holding the button. While latched, holding a
  different speed overrides it until you let go, then the latched speed carries on. Holding
  the latched speed's own button unlatches it: it runs while held and stops when you let go.
  Latching another speed switches to it, and pressing the lit latch again stops.
* **Range bar** (left): drag the top or bottom edge to move that limit, or drag the middle
  to move the whole range without changing its width.
* **Position bar** (right): touch to move the stroker there by hand. Until it reaches your
  finger it moves no faster than the last speed button you used (Slow if none), so a stray
  touch at the far end never makes it jump. Once it has caught up it follows your finger
  directly, fast or slow. While a speed is latched, the position bar overrides it only while
  your finger is down (even outside the range); let go and it heads back into the range and
  carries on.
* **Set limit** makes the current position a limit (handy on a controller). Above the other limit, it becomes the
  upper one; below it, the lower one. The first limit after a reset replaces whichever end
  is nearer. The limits are remembered per browser.
* **Reset limits** goes back to the full range, 0 to 100.
* **Record** starts and stops. The take is a stroke script: save it, copy its code, or press
  **Download** for a `.funscript` to load onto a Handy.

The devices that follow, and how, are chosen in the [Devices](#devices) box.

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
| Position above 50% | Only the top half counts: 50% and below is off, then it scales to full, so 75% position = 50% power |
| Speed + position | Speed sets the strength, and position adds up to 35% of what is left above it. Fast strokes still reach 100%, while slow strokes and holds high up still register |
| Speed, downstrokes only | Speed while moving down, nothing on the way up: one pulse per stroke |
| Speed, upstrokes only | The same on the way up |

Each saved stroke script remembers the mode it was last played with, from the card or from
`oggstudio.play` with `mode` (speed, position, upper, combo, down, up). Vibration scripts play as they are.

## Video sync

The card's **Video sync** panel plays a video alongside a script:

1. Choose a video on your phone or computer.
2. Choose a script: a `.funscript` file on the same device (two files give a two-motor
   toy one track per motor), the current take, or a script from your OggStudio library.
3. Press **Go**.

The video never leaves your device. The browser plays it straight from the local file, and
nothing is uploaded to Home Assistant. While the video plays, the card reads the video's
position about ten times a second and sends the matching level with `ogg.live`. Pausing,
seeking and changing playback speed stay in sync, and pausing stops the toy. **Sync offset**
(remembered per browser) sends each moment slightly early to make up for Bluetooth delay.

### Casting the video

**📺 Cast** uses Chrome's built-in cast to play the video on a Chromecast (Chrome on Android
or a computer, on the same network). The video still streams from your phone, nothing goes
to Home Assistant, and the devices keep following the video's position on the Chromecast.
Press it again to stop casting. Chrome may refuse to cast some local files; the button says
so, and casting the whole tab from Chrome's ⋮ menu is the fallback.

### Making a script for a video

Under the video there is one simple slider and a small **● Rec** button. The slider is the
same thing as the control above: the position in the Stroke view, the intensity in Vibrate.
Press Rec, play the video and drag it. The devices follow, and each value is recorded
against the video's own time, so the script lines up with that video (a stroke script in the
Stroke view). While a script plays with the video it is handled exactly like Replay, just on
the video's clock: the devices follow their follow types, the pads or stroke bar and the
slider show it, and holding the slider takes over until you let go. You can pause,
scrub back and record a section again: the newer pass replaces what was there. When you're
done, press **Use as take** (it replays with the video straight away, and you can save it to
the library) or **Download .funscript** (saved with the video's name).

Script files are treated as stroke scripts and mapped per device; choose Position for a device
if the file already describes intensity.

## Game controller

You can record with a small Bluetooth gamepad paired to your phone instead of your finger.
Tick **🎮 Controller**, next to the Live pads / Devices follow checkbox in the Record section
(under ● Rec on the Video card); its status and **Learn controls** appear once it is ticked. It ticks itself when a controller
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

Downloads follow the usual funscript naming: a vibration script is saved as `name.vib.funscript`
and a stroke script as `name.funscript`. On import the type is detected: OggStudio's own marker
in the file, else a `.vib.funscript` name means vibration, else it is a stroke script (how it
vibrates is set per device). **Inverted** flips a script authored upside down. Stroke scripts are also marked with `"metadata": {"type": "stroke"}` and kept as positions; see
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
| `oggstudio.claim` | Claim, refresh or release live control of a device (used by the cards) |
| `oggstudio.stop` | Stop playback on a device |
| `oggstudio.save` / `delete` / `rename` | Manage the library |
| `oggstudio.get_script` | Return a saved script (for export) |

Entities: **Saved script** (select) and **Replay speed** (select).

Synced video playback (following a media player's position) is planned.
