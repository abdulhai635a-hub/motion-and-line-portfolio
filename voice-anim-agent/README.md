# voice-anim-agent

Phase A implementation of the *Voice-Driven Frame-by-Frame Animation Agent* PRD:
a voice-over plus a structured script sheet go in, `.jsfl` command files come
out, and Adobe Animate builds the layers, keyframes and tweens synced to the
audio.

It is self-contained and has nothing to do with the Next.js site in the rest of
this repository — it is Python 3.9+ (stdlib only, except WhisperX for Stage 1)
plus one JSFL runtime file.

```
script sheet (.csv)  ─┐
voice-over (.wav)    ─┤→ align.py ─→ alignment.json ─→ map_frames.py ─→ timeline.json
                      │                                                      │
config.json ──────────┘                                       generate_jsfl.py
                                                                             │
                                                          out/vaa_batch01.jsfl …
                                                                             │
                                            Animate: Commands > Run Command ─┘
```

`timeline.json` is the contract between Python and JSFL (PRD section 12). Every
stage reads and writes files, so you can stop, inspect or hand-edit at any point
and resume from there.

## Quick start

```bash
cd voice-anim-agent
python3 tests/test_pipeline.py          # 23 tests, no dependencies needed

# Dry run with hand-written timings — no ML stack required:
python3 pipeline.py \
    --sheet examples/script_sheet.csv \
    --timings examples/timings.csv \
    --library examples/library_manifest.txt \
    --out-dir out

# The real thing, once WhisperX is installed (see requirements.txt):
python3 pipeline.py --sheet script_ep1.csv --audio vo_ep1.wav \
    --language en --library library_manifest.txt --out-dir out
```

Then in Animate: open the Master Library `.fla`, and run each generated file via
**Commands > Run Command**, in order. Results and warnings go to the Output panel.

Stages can also be run one at a time (`align.py`, `map_frames.py`,
`generate_jsfl.py` each have their own `--help`).

## The script sheet

| column | meaning |
| --- | --- |
| `line_id` | integer, defines the order |
| `line_text` | **verbatim** words from the voice-over — forced alignment matches on these |
| `subject_type` | `character`, `object`, `background`, `text-overlay`, `camera` (`+` joins several) |
| `subject_name` | library symbol name without the prefix; `,` separates several |
| `action` | one or more codes from the vocabulary below, joined by `+` |
| `animation` | `linear`, `ease-in`, `ease-out`, `ease-in-out` |
| `x`, `y` | optional stage position; defaults come from `config.json` |
| `text` | text content for `text_overlay` lines |

Symbol names follow PRD 6.2: `CHAR_<Name>` and `OBJ_<Name>` are derived from
`subject_type` + `subject_name`, so `character` + `Raju` → `CHAR_Raju`.

An action chain applies to the whole line. Entry actions (`fade_in`,
`enter_from_*`) take `entry_frames` and whatever follows them fills the rest of
the line's duration — that is how `fade_in + static` works.

## Action vocabulary

Controlled on purpose (PRD section 8): unknown codes fail validation instead of
producing something surprising inside Animate.

| code | what it does |
| --- | --- |
| `static` | placed, no movement |
| `fade_in` / `fade_out` | alpha tween 0↔100 over `entry_frames` |
| `enter_from_left` / `enter_from_right` | slides in from off-stage and settles at its position |
| `walk_left_to_right` / `walk_right_to_left` | crosses the whole stage, looping the symbol's `walk_cycle` label (right-to-left mirrors the art) |
| `walk_cycle` | walks in place |
| `scale_up` / `scale_down` | scales by `scale_step` across the line |
| `pick_up` | parents the object's layer to the character's for the line (needs 2 subjects: character first) |
| `camera_pan_left` / `camera_pan_right` | pans the camera MovieClip that holds the scene |
| `text_overlay` | creates a lower-third text field |

Adding an action = one emitter in `actions.py`. It lowers to the ~10 primitives
the JSFL runtime already implements (`place`, `set_props`, `tween`, `hold`,
`loop_label`, `rig_parent`, `rig_unparent`, `text`, `ensure_layer`, `comment`),
so most new actions need no new JavaScript.

## What you still have to do by hand

Phase 0 of the PRD is not automatable and this code does not pretend otherwise:

- Build every recurring character as a Movie Clip symbol named `CHAR_<Name>`,
  rigged, with frame labels (`idle`, `walk_cycle`, `pickup_pose`) — the
  `loop_label` op looks those labels up by name and warns if they are missing.
- Build props as `OBJ_<Name>` and keep everything in one Master Library `.fla`.
- Export the symbol list once with `tools/export_library.jsfl` so the pipeline
  can flag missing assets *before* generating anything.
- Nest the scene inside a camera MovieClip if you want the camera actions.
- Polish afterwards: easing, acting, and the QA-flagged lines. The tool does the
  mechanical setup, not the performance.

## Alignment and QA

`align.py` runs WhisperX for word-level timestamps, then matches your line text
against the recognized words with a Needleman-Wunsch global alignment (PRD 7.2).
The matching is monotonic, so a line can never be timed to words spoken earlier
than the previous line.

Every line gets a confidence = (matched words ÷ words in the line) × mean word
score. Anything below `confidence_threshold` is listed in the console report and
in `timeline.json` under `qa.flagged_line_ids`. Hindi/Bengali–English code-mixed
speech is where this drops (PRD 7.3), so the QA step is not optional. To correct
a line, put it in a timings CSV (`line_id,start_sec,end_sec`) and re-run with
`--timings`, or edit `timeline.json` and re-run `generate_jsfl.py` alone.

## Config

`config.json` holds `fps`, stage size, `entry_frames`, `offstage_margin`,
`scale_step`, `camera_pan_distance`, default positions per subject type, the
QA threshold, the voice-over layer name/position, and `batch_size`.

The document's fps must match `fps` — the runtime warns loudly if it doesn't,
because every frame number would be wrong. Frame numbers in the JSON are 1-based
like the Animate UI; the runtime converts to the 0-based JSFL API.

## Known limits (all from PRD 9/13)

- **Batching is required.** JSFL is synchronous, so long scripts freeze Animate.
  `batch_size` (default 50 lines) splits the output and the document is saved
  after each batch.
- **Rig parenting.** `setRigParentAtFrame` has no null-parent form; releasing a
  `pick_up` goes through the scratch-layer workaround. The runtime checks the
  method exists and warns instead of failing if your Animate build lacks it.
- **`ease-in-out` maps to 0.** Animate needs a custom easing curve for it; the
  line is left for the manual pass rather than being faked.
- **Same symbol, overlapping lines.** One symbol gets one layer, so overlapping
  ranges are reported as warnings — split them onto separate lines if the later
  keyframes shouldn't win.
- Adobe Animate itself is paid; everything in this folder is not.

The JSFL API surface used here (`addItemToDocument`, `insertBlankKeyframe`,
`convertToKeyframes`, `tweenType`/`tweenEasing`, `soundLibraryItem`,
`setRigParentAtFrame`, `reorderLayer`) is stable across recent Animate versions,
but it has not been executed against a real Animate install from this
environment — run one short clip end to end before trusting it on an episode.

## Not in Phase A

Lip-sync, free-form natural language instructions, auto-generating missing
assets, and 3D are all out of scope per the PRD. The next steps it names are
Phase B (bigger action vocabulary, multi-character sync) and Phase C (a QA
dashboard over `timeline.json`'s `qa` block).
