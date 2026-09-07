"""Phase 2 of the PRD workflow, end to end: sheet + voice-over -> .jsfl files.

    python3 pipeline.py --sheet examples/script_sheet.csv --audio vo_ep1.wav \
        --library examples/library_manifest.txt --out-dir out

Everything it writes (alignment.json, timeline.json, the .jsfl batches) is a
checkpoint you can inspect or hand-edit before the next stage runs.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

import align
import generate_jsfl
import map_frames
import script_sheet


def run(args) -> dict:
    config = map_frames.load_config(args.config)
    if args.fps:
        config["fps"] = args.fps
    threshold = float(config.get("confidence_threshold", 0.5))

    lines = script_sheet.load(args.sheet)
    library = script_sheet.load_library_manifest(args.library)

    if args.timings:
        timings = align.timings_from_manual(lines, align.load_manual_timings(args.timings))
    else:
        words = align.transcribe_words(args.audio, args.language, args.model, args.device)
        timings = align.align_lines(lines, words, threshold)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "alignment.json").write_text(
        json.dumps(
            {
                "audio_file": str(args.audio or ""),
                "lines": [asdict(t) for t in timings],
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    timeline = map_frames.build_timeline(
        lines, timings, config, audio_file=str(args.audio or ""), library=library
    )
    (out_dir / "timeline.json").write_text(
        json.dumps(timeline, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    written = generate_jsfl.write_batches(timeline, out_dir, args.stem, args.audio)
    return {"timeline": timeline, "jsfl": written, "out_dir": out_dir}


def print_report(result: dict) -> None:
    timeline = result["timeline"]
    qa = timeline["qa"]
    print(f"\n{len(timeline['lines'])} lines -> {len(timeline['layers'])} layers, "
          f"{len(result['jsfl'])} .jsfl batch(es) in {result['out_dir']}/")
    for warning in qa["warnings"]:
        print(f"  ! {warning}")
    if qa["missing_assets"]:
        print("\nBuild these in the Master Library before running the .jsfl:")
        for symbol in qa["missing_assets"]:
            print(f"  - {symbol}")
    if qa["flagged_line_ids"]:
        print(f"\nQA these lines after the run (PRD 7.2.4): {qa['flagged_line_ids']}")
    print("\nNext: open the Master Library .fla, then Commands > Run Command on:")
    for path in result["jsfl"]:
        print(f"  {path}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sheet", required=True, help="script sheet .csv/.json")
    parser.add_argument("--audio", help="voice-over .wav/.mp3")
    parser.add_argument("--timings", help="manual line_id,start_sec,end_sec CSV instead of WhisperX")
    parser.add_argument("--library", help="library manifest, to flag missing assets")
    parser.add_argument("--config", help="config.json override")
    parser.add_argument("--fps", type=int, help="override the config fps")
    parser.add_argument("--language", help="force a language code, e.g. hi, bn, en")
    parser.add_argument("--model", default="small", help="Whisper model size")
    parser.add_argument("--device", default="cpu", help="cpu or cuda")
    parser.add_argument("--out-dir", default="out")
    parser.add_argument("--stem", default="vaa")
    args = parser.parse_args(argv)

    if not args.audio and not args.timings:
        parser.error("give either --audio (WhisperX) or --timings (manual CSV)")

    try:
        result = run(args)
    except script_sheet.SheetError as error:
        print(f"script sheet is not usable:\n{error}", file=sys.stderr)
        return 2
    print_report(result)
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
