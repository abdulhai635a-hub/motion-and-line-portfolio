"""Script sheet loading and validation (PRD section 6.1).

The sheet is the only place the user expresses creative intent, so everything in
it is validated up front: a typo in an action code or a symbol name should stop
the pipeline here, not halfway through a JSFL run inside Animate.
"""

from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import actions

SUBJECT_TYPES = ("character", "object", "background", "text-overlay", "camera")

SYMBOL_PREFIX = {
    "character": "CHAR_",
    "object": "OBJ_",
    "background": "BG_",
    "text-overlay": "TXT_",
    "camera": "CAM_",
}


class SheetError(Exception):
    """Raised when the sheet is malformed badly enough that nothing can run."""


@dataclass
class Subject:
    type: str
    name: str
    symbol: str
    x: float | None = None
    y: float | None = None


@dataclass
class ScriptLine:
    line_id: int
    line_text: str
    subjects: list[Subject]
    action_chain: list[str]
    easing: str = "linear"
    text: str = ""

    @property
    def action(self) -> str:
        return " + ".join(self.action_chain)


def _split(value: str, seps: str) -> list[str]:
    parts = re.split(f"[{re.escape(seps)}]", value or "")
    return [p.strip() for p in parts if p.strip()]


def _symbol_for(subject_type: str, name: str) -> str:
    """CHAR_Raju / OBJ_Pizza (PRD 6.2). An already-prefixed name is left alone."""
    prefix = SYMBOL_PREFIX[subject_type]
    return name if name.startswith(prefix) else prefix + name


def _float_or_none(value: str | None) -> float | None:
    value = (value or "").strip()
    return float(value) if value else None


def parse_row(row: dict, row_number: int, errors: list[str]) -> ScriptLine | None:
    """Turn one sheet row into a ScriptLine, appending human-readable errors."""
    where = f"row {row_number}"

    raw_id = (row.get("line_id") or "").strip()
    try:
        line_id = int(raw_id)
    except ValueError:
        errors.append(f"{where}: line_id must be an integer, got {raw_id!r}")
        return None
    where = f"line {line_id}"

    line_text = (row.get("line_text") or "").strip()
    if not line_text:
        errors.append(f"{where}: line_text is empty (it must be the verbatim spoken words)")

    types = _split(row.get("subject_type", ""), "+,")
    names = _split(row.get("subject_name", ""), ",+")
    for subject_type in types:
        if subject_type not in SUBJECT_TYPES:
            errors.append(
                f"{where}: unknown subject_type {subject_type!r} "
                f"(allowed: {', '.join(SUBJECT_TYPES)})"
            )
    if not types or not names:
        errors.append(f"{where}: subject_type and subject_name are both required")
        return None
    if len(types) == 1 and len(names) > 1:
        types = types * len(names)
    if len(types) != len(names):
        errors.append(
            f"{where}: {len(types)} subject_type(s) but {len(names)} subject_name(s) — "
            "they must pair up one-to-one"
        )
        return None

    action_chain = _split(row.get("action", ""), "+")
    if not action_chain:
        errors.append(f"{where}: action is required")
    for code in action_chain:
        if code not in actions.VOCABULARY:
            errors.append(
                f"{where}: unknown action {code!r} — the vocabulary is controlled, see "
                f"actions.py ({', '.join(sorted(actions.VOCABULARY))})"
            )

    x, y = _float_or_none(row.get("x")), _float_or_none(row.get("y"))
    if (x is not None or y is not None) and len(names) > 1:
        errors.append(f"{where}: x/y can only be given for a single-subject line")
        x = y = None

    subjects = [
        Subject(type=t, name=n, symbol=_symbol_for(t, n), x=x, y=y)
        for t, n in zip(types, names)
        if t in SUBJECT_TYPES
    ]
    if not subjects:
        return None

    for code in action_chain:
        spec = actions.VOCABULARY.get(code)
        if spec and spec.subject_count and len(subjects) != spec.subject_count:
            errors.append(
                f"{where}: action {code!r} needs exactly {spec.subject_count} subjects "
                f"({spec.subject_roles}), got {len(subjects)}"
            )

    return ScriptLine(
        line_id=line_id,
        line_text=line_text,
        subjects=subjects,
        action_chain=action_chain,
        easing=(row.get("animation") or "linear").strip() or "linear",
        text=(row.get("text") or "").strip(),
    )


def load(path: str | Path) -> list[ScriptLine]:
    """Load a .csv or .json script sheet. Raises SheetError listing every problem."""
    path = Path(path)
    if path.suffix.lower() == ".json":
        rows = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(rows, dict):
            rows = rows.get("lines", [])
        rows = [{k: ("" if v is None else str(v)) for k, v in row.items()} for row in rows]
    else:
        with path.open(newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))

    errors: list[str] = []
    lines = []
    for number, row in enumerate(rows, start=2):  # row 1 is the header
        parsed = parse_row(row, number, errors)
        if parsed is not None:
            lines.append(parsed)

    seen: set[int] = set()
    for line in lines:
        if line.line_id in seen:
            errors.append(f"line {line.line_id}: duplicate line_id")
        seen.add(line.line_id)

    if not lines and not errors:
        errors.append(f"{path}: no rows found")
    if errors:
        raise SheetError("\n".join(f"  - {e}" for e in errors))

    lines.sort(key=lambda line: line.line_id)
    return lines


def load_library_manifest(path: str | Path | None) -> set[str] | None:
    """Symbol names present in the Master Library, or None when unknown.

    Accepts the .txt produced by tools/export_library.jsfl (one name per line,
    '#' comments) or a JSON array / {"symbols": [...]} file.
    """
    if not path:
        return None
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        data = json.loads(text)
        names = data.get("symbols", []) if isinstance(data, dict) else data
        return {str(n).strip() for n in names if str(n).strip()}
    return {
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def missing_assets(lines: Iterable[ScriptLine], library: set[str] | None) -> list[tuple[int, str]]:
    """(line_id, symbol) pairs the library doesn't contain — PRD goal 6."""
    if library is None:
        return []
    missing = []
    for line in lines:
        for subject in line.subjects:
            if subject.symbol not in library:
                missing.append((line.line_id, subject.symbol))
    return missing
