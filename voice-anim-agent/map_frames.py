"""Stage 2 — seconds to Animate frame numbers, and the JSON contract (PRD 7.4, 12).

The timeline JSON this produces is the single source of truth: Stage 3 reads it
and nothing else, so a hand-edited JSON is a first-class way to fix a bad line.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import align
import script_sheet


def sec_to_frame(seconds: float, fps: int) -> int:
    """PRD 7.4 — Animate timelines are 1-based."""
    return round(seconds * fps) + 1


def layer_name(subject: script_sheet.Subject) -> str:
    kind = {"character": "char", "object": "obj", "background": "bg",
            "text-overlay": "txt", "camera": "cam"}[subject.type]
    return f"{kind}_{subject.name}"


def build_timeline(
    lines: list[script_sheet.ScriptLine],
    timings: list[align.LineTiming],
    config: dict,
    audio_file: str = "",
    library: set[str] | None = None,
) -> dict:
    fps = int(config.get("fps", 24))
    min_frames = int(config.get("min_line_frames", 2))
    threshold = float(config.get("confidence_threshold", 0.5))
    by_id = {t.line_id: t for t in timings}

    layers: dict[str, dict] = {}
    out_lines = []
    warnings: list[str] = []

    for line in lines:
        timing = by_id.get(line.line_id)
        if timing is None:
            warnings.append(f"line {line.line_id}: no alignment, skipped")
            continue

        start_frame = sec_to_frame(timing.start_sec, fps)
        end_frame = sec_to_frame(timing.end_sec, fps)
        if end_frame - start_frame < min_frames:
            end_frame = start_frame + min_frames
            warnings.append(
                f"line {line.line_id}: range shorter than {min_frames} frames, padded"
            )
        if timing.confidence < threshold:
            warnings.append(
                f"line {line.line_id}: confidence {timing.confidence:.2f} "
                f"< {threshold} — verify before polishing ({timing.note})"
            )

        subjects = []
        for subject in line.subjects:
            name = layer_name(subject)
            layer = layers.setdefault(
                name, {"name": name, "symbol": subject.symbol, "type": subject.type, "spans": []}
            )
            for other_id, other_start, other_end in layer["spans"]:
                if start_frame < other_end and other_start < end_frame:
                    warnings.append(
                        f"line {line.line_id}: {subject.symbol} overlaps line {other_id} "
                        f"on layer {name} (frames {start_frame}-{end_frame}) — "
                        "the later keyframes win, split the symbol onto its own line if that is wrong"
                    )
                    break
            layer["spans"].append((line.line_id, start_frame, end_frame))
            subjects.append(
                {
                    "type": subject.type,
                    "name": subject.name,
                    "symbol": subject.symbol,
                    "action": line.action,
                    "layer": name,
                    "x": subject.x,
                    "y": subject.y,
                    "in_library": None if library is None else subject.symbol in library,
                }
            )

        out_lines.append(
            {
                "line_id": line.line_id,
                "line_text": line.line_text,
                "start_sec": timing.start_sec,
                "end_sec": timing.end_sec,
                "start_frame": start_frame,
                "end_frame": end_frame,
                "alignment_confidence": timing.confidence,
                "alignment_note": timing.note,
                "action_chain": line.action_chain,
                "easing": line.easing,
                "text": line.text,
                "subjects": subjects,
            }
        )

    missing = sorted({(s["symbol"]) for l in out_lines for s in l["subjects"] if s["in_library"] is False})
    warnings += [f"missing library asset: {symbol} (build it in the Master Library first)" for symbol in missing]

    return {
        "fps": fps,
        "audio_file": audio_file,
        "config": config,
        "layers": [
            {"name": layer["name"], "symbol": layer["symbol"], "type": layer["type"]}
            for layer in layers.values()
        ],
        "lines": out_lines,
        "qa": {
            "flagged_line_ids": [
                l["line_id"] for l in out_lines
                if l["alignment_confidence"] < threshold
            ],
            "missing_assets": missing,
            "warnings": warnings,
        },
    }


def lines_from_timeline(timeline: dict) -> list[tuple[script_sheet.ScriptLine, dict]]:
    """Rebuild ScriptLine objects from the JSON contract for Stage 3."""
    rebuilt = []
    for entry in timeline["lines"]:
        subjects = [
            script_sheet.Subject(
                type=s["type"], name=s["name"], symbol=s["symbol"], x=s.get("x"), y=s.get("y")
            )
            for s in entry["subjects"]
        ]
        line = script_sheet.ScriptLine(
            line_id=entry["line_id"],
            line_text=entry["line_text"],
            subjects=subjects,
            action_chain=entry["action_chain"],
            easing=entry.get("easing", "linear"),
            text=entry.get("text", ""),
        )
        rebuilt.append((line, entry))
    return rebuilt


def load_config(path: str | Path | None) -> dict:
    path = Path(path) if path else Path(__file__).resolve().parent / "config.json"
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Map aligned seconds onto Animate frames.")
    parser.add_argument("--sheet", required=True)
    parser.add_argument("--alignment", required=True, help="alignment.json from align.py")
    parser.add_argument("--config", help="config.json (defaults to the one next to this script)")
    parser.add_argument("--library", help="library manifest to check symbols against")
    parser.add_argument("--fps", type=int, help="override the config fps")
    parser.add_argument("--out", default="timeline.json")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    if args.fps:
        config["fps"] = args.fps

    lines = script_sheet.load(args.sheet)
    alignment = json.loads(Path(args.alignment).read_text(encoding="utf-8"))
    timings = [align.LineTiming(**row) for row in alignment["lines"]]

    timeline = build_timeline(
        lines,
        timings,
        config,
        audio_file=alignment.get("audio_file", ""),
        library=script_sheet.load_library_manifest(args.library),
    )
    Path(args.out).write_text(
        json.dumps(timeline, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    for warning in timeline["qa"]["warnings"]:
        print(f"  ! {warning}")
    print(f"wrote {args.out} ({len(timeline['lines'])} lines, {len(timeline['layers'])} layers)")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
