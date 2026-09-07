"""Stage 1 — forced alignment (PRD section 7).

Finds the (start_sec, end_sec) of every script line inside the voice-over.

Two sources of word-level timestamps are supported:
  * WhisperX, when installed (`--audio path.wav`)
  * a manual timings CSV (`--timings timings.csv`), which is how Phase A can be
    tested end-to-end before the ML stack is set up, and how a QA-flagged line
    gets corrected by hand.

The line-to-word matching is a Needleman-Wunsch global alignment over the token
streams, exactly as described in PRD 7.2 — it is monotonic, so a line can never
be matched to words spoken before the previous line.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from dataclasses import asdict, dataclass
from pathlib import Path

import script_sheet

MATCH, MISMATCH, GAP = 2, -1, -1


@dataclass
class Word:
    word: str
    start: float
    end: float
    score: float = 1.0


@dataclass
class LineTiming:
    line_id: int
    start_sec: float
    end_sec: float
    confidence: float
    note: str = ""

    @property
    def needs_review(self) -> bool:
        return bool(self.note)


_PUNCT = re.compile(r"[^\wऀ-ॿঀ-৿]+", re.UNICODE)


def normalize(token: str) -> str:
    """Casefold and strip punctuation; keeps Devanagari/Bengali codepoints."""
    token = unicodedata.normalize("NFKC", token).casefold()
    return _PUNCT.sub("", token)


def tokenize(text: str) -> list[str]:
    return [t for t in (normalize(part) for part in text.split()) if t]


def needleman_wunsch(a: list[str], b: list[str]) -> list[tuple[int | None, int | None]]:
    """Global alignment of two token lists. Returns (i, j) pairs; None = gap."""
    n, m = len(a), len(b)
    score = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        score[i][0] = i * GAP
    for j in range(1, m + 1):
        score[0][j] = j * GAP
    for i in range(1, n + 1):
        row, prev = score[i], score[i - 1]
        ai = a[i - 1]
        for j in range(1, m + 1):
            diag = prev[j - 1] + (MATCH if ai == b[j - 1] else MISMATCH)
            row[j] = max(diag, prev[j] + GAP, row[j - 1] + GAP)

    pairs: list[tuple[int | None, int | None]] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0:
            diag = score[i - 1][j - 1] + (MATCH if a[i - 1] == b[j - 1] else MISMATCH)
            if score[i][j] == diag:
                pairs.append((i - 1, j - 1))
                i, j = i - 1, j - 1
                continue
        if i > 0 and score[i][j] == score[i - 1][j] + GAP:
            pairs.append((i - 1, None))
            i -= 1
            continue
        pairs.append((None, j - 1))
        j -= 1
    pairs.reverse()
    return pairs


def align_lines(
    lines: list[script_sheet.ScriptLine],
    words: list[Word],
    confidence_threshold: float = 0.5,
) -> list[LineTiming]:
    """Map every script line onto a time range in the recognized word stream."""
    script_tokens: list[str] = []
    owner: list[int] = []  # index into `lines` for each script token
    for index, line in enumerate(lines):
        for token in tokenize(line.line_text):
            script_tokens.append(token)
            owner.append(index)

    asr_tokens = [normalize(w.word) for w in words]
    pairs = needleman_wunsch(script_tokens, asr_tokens)

    matched: dict[int, list[int]] = {i: [] for i in range(len(lines))}
    for si, wi in pairs:
        if si is None or wi is None:
            continue
        if script_tokens[si] == asr_tokens[wi]:
            matched[owner[si]].append(wi)

    total_tokens = [0] * len(lines)
    for index in owner:
        total_tokens[index] += 1

    timings: list[LineTiming] = []
    audio_end = words[-1].end if words else 0.0
    for index, line in enumerate(lines):
        hits = matched[index]
        if hits:
            start = words[min(hits)].start
            end = words[max(hits)].end
            ratio = len(hits) / max(total_tokens[index], 1)
            mean_score = sum(words[w].score for w in hits) / len(hits)
            confidence = round(min(1.0, ratio * mean_score), 3)
            note = ""
        else:
            # Nothing matched: fall back to the gap between the neighbours so
            # the pipeline still produces a frame range for manual fixing.
            start = timings[-1].end_sec if timings else 0.0
            end = audio_end
            confidence = 0.0
            note = "no words matched — timing is a guess, fix it by hand"
        if not note and confidence < confidence_threshold:
            note = f"low confidence ({confidence:.2f})"
        timings.append(LineTiming(line.line_id, round(start, 3), round(end, 3), confidence, note))

    _enforce_monotonic(timings)
    return timings


def _enforce_monotonic(timings: list[LineTiming]) -> None:
    """Lines are spoken in order, so ranges must not go backwards or invert."""
    for previous, current in zip(timings, timings[1:]):
        if current.start_sec < previous.start_sec:
            current.start_sec = previous.start_sec
            current.note = (current.note + "; " if current.note else "") + "start clamped forward"
        if current.end_sec < current.start_sec:
            current.end_sec = current.start_sec
            current.note = (current.note + "; " if current.note else "") + "zero-length range"


def transcribe_words(
    audio_path: str | Path,
    language: str | None = None,
    model_name: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
) -> list[Word]:
    """Word-level timestamps via WhisperX (ASR + wav2vec2 forced alignment)."""
    try:
        import whisperx  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise SystemExit(
            "whisperx is not installed. Either `pip install -r requirements.txt` "
            "or run with --timings for a manual timing sheet."
        ) from exc

    audio_path = str(audio_path)
    model = whisperx.load_model(model_name, device, compute_type=compute_type, language=language)
    audio = whisperx.load_audio(audio_path)
    result = model.transcribe(audio)
    align_model, metadata = whisperx.load_align_model(
        language_code=language or result["language"], device=device
    )
    aligned = whisperx.align(result["segments"], align_model, metadata, audio, device)

    words: list[Word] = []
    for segment in aligned["segments"]:
        for word in segment.get("words", []):
            if word.get("start") is None or word.get("end") is None:
                continue  # WhisperX drops timings for unalignable tokens
            words.append(
                Word(
                    word=word["word"],
                    start=float(word["start"]),
                    end=float(word["end"]),
                    score=float(word.get("score", 1.0) or 0.0),
                )
            )
    return words


def load_manual_timings(path: str | Path) -> dict[int, tuple[float, float]]:
    """CSV with line_id,start_sec,end_sec — a hand-timed or corrected sheet."""
    rows = {}
    with Path(path).open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            rows[int(row["line_id"])] = (float(row["start_sec"]), float(row["end_sec"]))
    return rows


def timings_from_manual(
    lines: list[script_sheet.ScriptLine], manual: dict[int, tuple[float, float]]
) -> list[LineTiming]:
    timings = []
    for line in lines:
        if line.line_id not in manual:
            raise SystemExit(f"timings file has no row for line_id {line.line_id}")
        start, end = manual[line.line_id]
        timings.append(LineTiming(line.line_id, start, end, 1.0, "manual timing"))
    _enforce_monotonic(timings)
    return timings


def report(timings: list[LineTiming], threshold: float) -> list[str]:
    """QA lines for the console (PRD 7.2 step 4 — never fully set-and-forget)."""
    flagged = [t for t in timings if t.needs_review and t.confidence < threshold]
    out = [f"aligned {len(timings)} lines; {len(flagged)} need review"]
    for timing in flagged:
        out.append(
            f"  ! line {timing.line_id}: {timing.start_sec:.2f}s-{timing.end_sec:.2f}s "
            f"conf={timing.confidence:.2f} ({timing.note})"
        )
    return out


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Forced-align a script sheet against a voice-over.")
    parser.add_argument("--sheet", required=True, help="script sheet .csv/.json")
    parser.add_argument("--audio", help="voice-over .wav/.mp3 (runs WhisperX)")
    parser.add_argument("--timings", help="manual line_id,start_sec,end_sec CSV instead of ASR")
    parser.add_argument("--language", help="force a language code, e.g. hi, bn, en")
    parser.add_argument("--model", default="small", help="Whisper model size (default: small)")
    parser.add_argument("--device", default="cpu", help="cpu or cuda (default: cpu)")
    parser.add_argument("--threshold", type=float, default=0.5, help="QA confidence threshold")
    parser.add_argument("--out", default="alignment.json", help="where to write the timings")
    args = parser.parse_args(argv)

    if not args.audio and not args.timings:
        parser.error("give either --audio (WhisperX) or --timings (manual CSV)")

    lines = script_sheet.load(args.sheet)
    if args.timings:
        timings = timings_from_manual(lines, load_manual_timings(args.timings))
    else:
        words = transcribe_words(args.audio, args.language, args.model, args.device)
        timings = align_lines(lines, words, args.threshold)

    Path(args.out).write_text(
        json.dumps(
            {
                "audio_file": Path(args.audio).name if args.audio else "",
                "lines": [asdict(t) for t in timings],
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print("\n".join(report(timings, args.threshold)))
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
