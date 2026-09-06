# Earth Studio Text-to-Camera-Path Agent

Turns a plain-language instruction into a camera keyframe plan for
[Google Earth Studio](https://earth.google.com/studio/), and — optionally —
types that plan into a live Earth Studio session so the app creates the
keyframes itself.

```
$ node src/cli.ts plan "Start from space, zoom into Japan.
                        Hold for 3 seconds.
                        Then fly to Mount Fuji and zoom in close.
                        Hold for 2 seconds."
```

```
Keyframes (each row is one keyframe to create on the timeline)
   frame       time  step      latitude     longitude      altitude m     pan    tilt    roll     fov  label
       0     0.000s     1     36.204800    138.252900     10000000.00     0.0     0.0     0.0    60.0  start Japan (start)
     120     4.000s     2     36.204800    138.252900       800000.00     0.0     0.0     0.0    60.0  zoom_in Japan (end)
     210     7.000s     3     36.204800    138.252900       800000.00     0.0     0.0     0.0    60.0  hold Japan (end)
     330    11.000s     4     35.360600    138.727400         1500.00     0.0     0.0     0.0    60.0  fly_to Mount Fuji (end)
     390    13.000s     5     35.360600    138.727400         1500.00     0.0     0.0     0.0    60.0  hold Mount Fuji (end)
```

Implements the PRD in
`Earth_Studio_Text_Agent_PRD.docx` (v1.0). Section references below point at it.

## What it does and does not do

Earth Studio has **no public API** and no documented way to import a keyframe
timeline (PRD 4). That shapes everything here:

| | |
|---|---|
| **Does** | Parse the instruction, resolve place names, compute a frame-accurate timeline, write a reviewable plan, and drive a signed-in Earth Studio session to create real keyframes. |
| **Does not** | Render video. Earth Studio has no render-trigger API, so the final render stays a manual click (PRD 3.2). |
| **Does not** | Accept voice input, or edit an existing project in place (PRD 3.2). |

The supported automation path is **Option A** from PRD 4.1: a Playwright script
types values into the attribute fields, exactly as a person would, so Earth
Studio's own keyframe engine does the work and nothing about the file format is
guessed. Option B (writing a project file directly) is included only as a
clearly-labelled experiment — see [The .esp experiment](#the-esp-experiment).

## Requirements

- Node.js 22.6 or newer (TypeScript runs directly, there is no build step).
- Playwright, only for the `login`, `drive` and `verify-layout` commands:
  `npm install && npx playwright install chromium`.

Everything else — parsing, geocoding, the timeline, all output files — works
with no dependencies and no network.

**On Windows**, PowerShell blocks npm's script wrapper by default
(`npm.ps1 cannot be loaded because running scripts is disabled`). Either write
`npm.cmd install` / `npm.cmd test`, or allow local scripts once with
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. The `node src/cli.ts ...`
commands are unaffected.

## Quick start

```bash
cd earth-studio-agent

# 1. Plan. No browser needed. Writes earth-studio-path.json and .log.txt.
node src/cli.ts plan "zoom into Japan, hold 3 seconds, then fly to Mount Fuji and zoom in close"

# 2. Sign in to Google once. The profile is remembered for later runs.
node src/cli.ts login --user-data-dir ./.es-profile

# 3. Check the selectors against the live app (see the warning below).
node src/cli.ts verify-layout --user-data-dir ./.es-profile

# 4. Type the plan into Earth Studio.
node src/cli.ts drive "zoom into Japan, hold 3 seconds, then fly to Mount Fuji and zoom in close" \
  --user-data-dir ./.es-profile
```

`login` opens Chromium at Earth Studio and waits while you sign in and open the
project you want the keyframes in; `--user-data-dir` is where that session is
kept, so `verify-layout` and `drive` reuse it. Steps 2-4 need a display;
`--headless` works once you are signed in.

### If Google will not sign you in

Google often refuses to sign in inside an automated browser:

> **Couldn't sign you in** - This browser or app may not be secure.

That is Google's anti-automation check, not a fault in the agent, and no launch
flag reliably defeats it. The dependable route is the other way round: sign in
yourself, in your own Chrome, and let the agent attach to that window.

Start Chrome with a debugging port and a profile of its own:

```powershell
# Windows PowerShell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\es-chrome-profile"
```

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/es-chrome-profile"

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/es-chrome-profile"
```

In that window: sign in to Google, open your Earth Studio project. Then point the
agent at it with `--cdp` instead of `--user-data-dir`, and skip `login` entirely:

```bash
node src/cli.ts verify-layout --cdp http://localhost:9222
node src/cli.ts drive "zoom into Japan, hold 3 seconds, then fly to Mount Fuji" --cdp http://localhost:9222
```

The agent works in the tab already showing Earth Studio, so your open project is
used rather than a fresh one, and disconnecting leaves your browser running.
`--user-data-dir` must be a directory Chrome is not already using, which is why
the commands above name a new one.

Then, in Earth Studio: review the keyframes on the timeline, nudge anything you
want, and render from Earth Studio itself.

## Command grammar (PRD 7)

The parser is forgiving rather than strict. Each step may name:

| Field | Examples |
|---|---|
| Place | `Japan`, `Mount Fuji`, `Washington, D.C.`, `Trinidad and Tobago` |
| Action | `zoom in`, `zoom out`, `fly to`, `pan to`, `hold`, `wait`, `start from` |
| Duration | `3 seconds`, `5 sec`, `2s`, `hold 1.5 seconds`, `for half a second`, `2 minutes` |
| Zoom level | `close`, `country level`, `street level`, or an explicit `zoom to 500 meters` / `1.5km` / `1000 feet` |

Sentences (split on `.`, `;`, `!`, newlines and tabs) separate steps. Within one
sentence, a clause that names no place refines the one before it, so
`fly to Mount Fuji and zoom in close` is a single move that ends close in — which
is what the PRD's worked example expects. A `hold` always stands on its own,
because it occupies its own span of time.

Two conveniences worth knowing:

- **An establishing pose is added** when the command does not start with one,
  so `fly to Rome` actually moves rather than sitting on one pose. Disable with
  `--no-implicit-start`.
- **A bare `zoom in` / `zoom out`** moves one rung along the altitude table
  below, relative to where the camera already is.

## Default zoom/altitude table (PRD 8)

| Descriptor | Altitude |
|---|---|
| space / global | 10,000,000 m |
| country level | 800,000 m |
| region / state level | 150,000 m |
| city level | 15,000 m |
| close / landmark level | 1,500 m |
| street level | 150 m |

When no descriptor is given, the altitude comes from the kind of place: a
country lands at country level, a city at city level, a landmark at close level.
Everything is overridable — per step in the command, or per session in
`src/config.ts`.

## Place names (PRD 6, FR2)

Places resolve against a built-in table of ~220 countries, regions, cities and
landmarks. That keeps the agent deterministic and usable offline. `--online`
adds an OpenStreetMap (Nominatim) lookup for anything the table does not know.

When a name is ambiguous the agent picks the most likely match **and says so**:

```
! [AMBIGUOUS_PLACE] step 2: "Georgia" is ambiguous: used Georgia - country in
  the Caucasus (confidence 0.507); the closest alternative was Georgia - state
  in the United States.
```

PRD 12 leaves open whether ambiguity should be resolved automatically or always
asked about, so both are supported: the default assumes and logs, and
`--confirm-ambiguous` asks. You can also disambiguate by typing the qualified
name — `fly to Paris, Texas` resolves to Texas, not France.

## Outputs

| File | Contents |
|---|---|
| `<prefix>.json` | The camera path: every step, every keyframe, every warning. This is the canonical output and the input to `drive`. |
| `<prefix>.log.txt` | The human-readable log required by FR5 — what is set at which frame, and why each altitude and duration was chosen. |
| `<prefix>.csv` | `--csv`. One row per keyframe, for spreadsheets or your own scripts. |
| `<prefix>.esp` | `--esp`. Experimental, see below. |

## Driving Earth Studio (PRD 4.1, FR4)

`drive` seeks the playhead to each computed frame, types every camera attribute,
and **reads each value back** to confirm the edit landed. A value that does not
stick is reported with its step, frame and field rather than being skipped
(FR6):

```
[DRIVER_FIELD_WRITE_FAILED] (step 3) Stopped at frame 210 while applying step 3.
  detail: The camera altitude field did not accept 800000.
  hint:   2 of 5 keyframes were written before this.
```

### How a value is entered

Earth Studio has no inputs for the camera values. Each attribute is a row keyed
by `data-attribute-type`, and its value sits behind a scrub widget:

```html
<li class="attribute" data-attribute-type="latitude">
  <span class="title">Latitude</span>
  <span class="actions">
    <span class="value">
      <span class="scrub-input valueInput" tabindex="0">
        <span class="presentedValueContainer"><span class="presentedValue">29.323</span></span>
        <span class="unit degrees" title="Degrees">°</span>
    <button data-action="click:addKeyframe" title-tooltip="Add keyframe">
```

Clicking the widget inserts a `contenteditable` holding the full-precision
value; Enter commits it, and the keyframe button beside it turns the value into
a keyframe. The playhead has no field at all — its readout only toggles between
frames and a timecode — so it is moved with the arrow keys (Shift steps five
frames) or the transport buttons.

Two details are easy to get wrong and are handled explicitly:

- **Altitude reads in kilometres** while the agent plans in metres, so a planned
  1500 m is typed as `1.5`. The scale is derived at run time by comparing the
  rounded value on screen with the full-precision value in the edit box, so it
  stays right if Earth Studio switches units by magnitude.
- **Longitude and the rotations carry two widgets** — whole turns beside
  degrees — so the degrees one is named rather than taken by position.

### Selectors, and re-verifying them

The selectors in `src/driver/selectors.ts` were read off a live, signed-in
session; `verifiedOn` says when. Google publishes no stable DOM contract, so
they can still go stale.

This is PRD 11's mitigation, built in: every selector lives in that one file,
each field lists several candidates, and `verify-layout` reports exactly which
candidate matched and which fields need a new one:

```
Selector set 1.0.0 (verified unverified)
Missing required fields: camera altitude

  ok      camera latitude        [data-attribute="latitude"] input
  MISSING camera altitude        tried 4 candidates
```

`probe` is the quickest way to re-derive them: it lists every attribute row the
project shows, with its type, value and displayed unit, and suggests a selector
for each.

```bash
node src/cli.ts probe --cdp http://localhost:9222
```

```
  data-attribute-type    title              value        unit
  latitude               Latitude           29.323       ° (Degrees)
  altitude               Altitude           63170        km (Kilometers)
  rotationX              Pan                355.743      ° (Degrees)   [2 widgets]
```

`probe --attribute latitude --type-value 12.5` clicks one value and reports what
the page does at each step, ending with Escape so nothing is changed;
`probe --playhead` does the same for the transport keys and buttons.

When something is missing that `probe` cannot explain, `inspect` dumps what the
page really contains — every editable field, its label, its attributes and a
selector that reaches it:

```bash
node src/cli.ts inspect --cdp http://localhost:9222
```

```
Page   https://earth.google.com/studio/...
Found  5 editable field(s), 0 iframe(s)

[2] input  "Latitude"
    selector : input[aria-label="Latitude"]
    attrs    : class="num-field" aria-label="Latitude" value="0"
    parents  : div  <  div  <  div  <  body
```

It also says when a page has no fields at all, and whether that is because the
editor sits inside an iframe or because this is not the editor page.

Put the reported selectors at the top of the matching `candidates` list in
`src/driver/selectors.ts`, or supply a corrected file at run time with
`--selectors my-selectors.json` — no other file needs to change. The same check
runs before every `drive`, so a UI change stops the run instead of silently
writing nothing.

### Camera conventions

`pan`, `tilt`, `roll` and field of view are written at every keyframe from
`--tilt` / `--fov` and the defaults in `src/config.ts`. Earth Studio names the
rotations by axis — Pan is `rotationX`, Tilt `rotationY`, Roll `rotationZ`. The
default tilt of `0` assumes 0 degrees points straight down; if your Earth Studio
build treats tilt differently, set `--tilt` to suit. Transitions are left at Earth Studio's own
default easing, which PRD 11 scopes as linear/auto-ease for v1.

## The .esp experiment

`--esp` writes a project file shaped like Earth Studio's own. **The format is
undocumented** (PRD 4.2 rates this Option B as low reliability), so this file is
inferred, not verified: it may or may not open. It costs nothing to try, and the
same plan is always available through the supported `drive` path. If Earth
Studio rejects it, that is the expected failure mode, not a bug.

## Answers to the PRD's open questions (PRD 12)

| Question | Answer here |
|---|---|
| Edit an open project, or only build new ones? | Only new sequences, as PRD 3.2 scopes. `drive` writes into whatever project is open, so an existing project is edited only if you open one first. |
| Default frame rate and resolution? | 30fps, 1920x1080. Change with `--fps`, `--width`, `--height`. |
| Resolve ambiguity automatically or always ask? | Automatic and logged by default; `--confirm-ambiguous` asks instead. |

## Development

```bash
npm test          # 205 tests, ~40s
npm run typecheck # tsc --noEmit, strict
```

The suite covers the parser, geocoder, timeline, log, `.esp` writer, driver and
CLI. Two parts are worth calling out:

- **`test/driver.browser.test.ts`** drives a real Chromium against
  `test/fixtures/earth-studio-attributes.html`, which reproduces the markup and
  the behaviour read off the live editor: rows keyed by `data-attribute-type`,
  a scrub widget that opens a contenteditable on click, a kilometre-denominated
  altitude, per-row keyframe buttons, and a timeline driven by keys and
  transport buttons. It verifies seeking, the editing gesture, unit conversion,
  read-back and error reporting. It **cannot** verify that the live DOM still
  matches `DEFAULT_SELECTORS` — that is what `verify-layout` and `probe` are
  for. The tests skip themselves when no browser is available.
- **`test/driver.cdp.test.ts`** starts a browser with `--remote-debugging-port`
  exactly as the instructions above tell you to, attaches to it, writes a whole
  plan into it, and checks that disconnecting leaves it running.
- **`test/geocode.http.test.ts`** runs the online geocoder over real HTTP against
  a local Nominatim-shaped server, so timeouts, status codes and headers are
  exercised without depending on (or hammering) the public service.

## Requirements traceability

| Requirement | Where |
|---|---|
| FR1 parse multi-step commands | `src/parser.ts` |
| FR2 resolve places, handle ambiguity, log the choice | `src/geocode/` |
| FR3 frame-accurate timeline at a configurable frame rate | `src/timeline.ts` |
| FR4 drive Earth Studio to create keyframes | `src/driver/` |
| FR5 human-readable log of what was set at each frame | `src/log.ts` |
| FR6 fail gracefully, naming the step that failed | `src/errors.ts`, used throughout |

## Known limits

- The selectors match Earth Studio as of the date in `verifiedOn`, and Google
  can change the interface without notice. `verify-layout` checks them on every
  run and `probe` re-derives them; both need a signed-in session.
- The built-in place table is a curated ~220 entries; anything else needs
  `--online`.
- `pan_to` moves the camera to the named place; it does not yet compute a
  heading. Easing beyond Earth Studio's default is out of scope for v1 (PRD 11).
- Rendering is manual, by design (PRD 3.2).
