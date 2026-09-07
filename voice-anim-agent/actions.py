"""Controlled action vocabulary (PRD section 8) and its lowering to JSFL ops.

Each action lowers to a short list of *primitive ops*. The JSFL runtime
(jsfl_runtime.jsfl) implements only those ~10 primitives, so adding an action
means writing Python here — not new JavaScript inside Animate. Ops are plain
dicts so they can be diffed and asserted on in tests.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

# Animate's tweenEasing is -100 (ease in) .. +100 (ease out).
EASING = {
    "linear": 0,
    "ease-in": -50,
    "ease-out": 50,
    # Animate needs a custom curve for ease-in-out; 0 keeps it honest and the
    # line lands in the manual-polish pass (PRD phase 4).
    "ease-in-out": 0,
}


@dataclass
class ActionSpec:
    code: str
    summary: str
    emit: Callable
    # 0 = applies to every subject on the line; N = relational, needs exactly N.
    subject_count: int = 0
    subject_roles: str = ""
    # Entry actions occupy `entry_frames` and then hold; the rest span the line.
    is_entry: bool = False


@dataclass
class Context:
    """Everything an emitter needs that isn't the subject itself."""

    fps: int
    stage_width: int
    stage_height: int
    entry_frames: int
    offstage_margin: int
    scale_step: float
    camera_pan_distance: int
    default_positions: dict

    def position(self, subject) -> tuple[float, float]:
        default = self.default_positions.get(subject.type, {"x": 0, "y": 0})
        x = subject.x if subject.x is not None else default["x"]
        y = subject.y if subject.y is not None else default["y"]
        return float(x), float(y)


def _place(layer, symbol, frame, x, y, alpha=100, scale=1.0, scale_x=None):
    return {
        "op": "place",
        "layer": layer,
        "symbol": symbol,
        "frame": frame,
        "x": x,
        "y": y,
        "alpha": alpha,
        "scale_x": scale if scale_x is None else scale_x,
        "scale_y": scale,
    }


def _keyframe(layer, frame, **props):
    return {"op": "set_props", "layer": layer, "frame": frame, **props}


def _tween(layer, start_frame, end_frame, easing):
    return {
        "op": "tween",
        "layer": layer,
        "start_frame": start_frame,
        "end_frame": end_frame,
        "type": "motion",
        "easing": EASING.get(easing, 0),
    }


def _hold(layer, through_frame):
    return {"op": "hold", "layer": layer, "through_frame": through_frame}


def _travel(ctx, subject, layer, start, end, easing, x_from, x_to,
            scale_x=1.0, label=None, hold_through=None):
    """Shared body of the walk/enter actions: place, tween in x, hold."""
    _, y = ctx.position(subject)
    ops = [_place(layer, subject.symbol, start, x_from, y, scale_x=scale_x)]
    if label:
        ops.append({"op": "loop_label", "layer": layer, "frame": start, "label": label})
    if end > start:
        ops.append(_keyframe(layer, end, x=x_to, y=y))
        ops.append(_tween(layer, start, end, easing))
    ops.append(_hold(layer, end if hold_through is None else hold_through))
    return ops


# --- emitters -------------------------------------------------------------
# Signature: (ctx, line, subjects, layers, start, end) -> list[op]


def _static(ctx, line, subjects, layers, start, end):
    ops = []
    for subject, layer in zip(subjects, layers):
        x, y = ctx.position(subject)
        ops.append(_place(layer, subject.symbol, start, x, y))
        ops.append(_hold(layer, end))
    return ops


def _fade(direction):
    def emit(ctx, line, subjects, layers, start, end):
        ops = []
        for subject, layer in zip(subjects, layers):
            x, y = ctx.position(subject)
            if direction == "in":
                a_from, a_to = 0, 100
                a, b = start, min(start + ctx.entry_frames, end)
            else:
                a_from, a_to = 100, 0
                a, b = max(end - ctx.entry_frames, start), end
                ops.append(_place(layer, subject.symbol, start, x, y, alpha=100))
            if direction == "in":
                ops.append(_place(layer, subject.symbol, a, x, y, alpha=a_from))
            if b > a:
                ops.append(_keyframe(layer, b, x=x, y=y, alpha=a_to))
                ops.append(_tween(layer, a, b, line.easing))
            ops.append(_hold(layer, end))
        return ops

    return emit


def _enter(side):
    def emit(ctx, line, subjects, layers, start, end):
        ops = []
        for subject, layer in zip(subjects, layers):
            x, _ = ctx.position(subject)
            x_from = (
                -ctx.offstage_margin
                if side == "left"
                else ctx.stage_width + ctx.offstage_margin
            )
            settle = min(start + ctx.entry_frames, end)
            ops += _travel(
                ctx, subject, layer, start, settle, line.easing, x_from, x,
                hold_through=end,
            )
        return ops

    return emit


def _walk_across(direction):
    def emit(ctx, line, subjects, layers, start, end):
        ops = []
        left = -ctx.offstage_margin
        right = ctx.stage_width + ctx.offstage_margin
        for subject, layer in zip(subjects, layers):
            if direction == "lr":
                x_from, x_to, scale_x = left, right, 1.0
            else:
                # Library art is drawn facing right, so mirror it going the other way.
                x_from, x_to, scale_x = right, left, -1.0
            ops += _travel(
                ctx, subject, layer, start, end, line.easing,
                x_from, x_to, scale_x=scale_x, label="walk_cycle",
            )
        return ops

    return emit


def _walk_cycle(ctx, line, subjects, layers, start, end):
    """Walk in place — the nested walk_cycle frame label does the moving."""
    ops = []
    for subject, layer in zip(subjects, layers):
        x, y = ctx.position(subject)
        ops.append(_place(layer, subject.symbol, start, x, y))
        ops.append({"op": "loop_label", "layer": layer, "frame": start, "label": "walk_cycle"})
        ops.append(_hold(layer, end))
    return ops


def _scale(direction):
    def emit(ctx, line, subjects, layers, start, end):
        ops = []
        target = 1.0 + (ctx.scale_step if direction == "up" else -ctx.scale_step)
        for subject, layer in zip(subjects, layers):
            x, y = ctx.position(subject)
            ops.append(_place(layer, subject.symbol, start, x, y, scale=1.0))
            if end > start:
                ops.append(_keyframe(layer, end, x=x, y=y, scale_x=target, scale_y=target))
                ops.append(_tween(layer, start, end, line.easing))
            ops.append(_hold(layer, end))
        return ops

    return emit


def _pick_up(ctx, line, subjects, layers, start, end):
    """Parent the object's layer to the character's layer for this range.

    PRD section 9: JSFL cannot set a null rig parent, so the runtime unparents
    via the temporary-layer workaround at end_frame.
    """
    (parent, child), (parent_layer, child_layer) = subjects[:2], layers[:2]
    px, py = ctx.position(parent)
    cx, cy = ctx.position(child)
    return [
        _place(parent_layer, parent.symbol, start, px, py),
        {"op": "loop_label", "layer": parent_layer, "frame": start, "label": "pickup_pose"},
        _hold(parent_layer, end),
        _place(child_layer, child.symbol, start, cx, cy),
        {
            "op": "rig_parent",
            "layer": child_layer,
            "parent_layer": parent_layer,
            "frame": start,
        },
        _hold(child_layer, end),
        {"op": "rig_unparent", "layer": child_layer, "frame": end},
    ]


def _camera_pan(direction):
    def emit(ctx, line, subjects, layers, start, end):
        ops = []
        distance = ctx.camera_pan_distance * (-1 if direction == "left" else 1)
        for subject, layer in zip(subjects, layers):
            x, y = ctx.position(subject)
            # The camera MovieClip holds the whole scene, so panning left means
            # sliding its contents right (PRD section 8).
            ops.append(_place(layer, subject.symbol, start, x, y))
            if end > start:
                ops.append(_keyframe(layer, end, x=x - distance, y=y))
                ops.append(_tween(layer, start, end, line.easing))
            ops.append(_hold(layer, end))
        return ops

    return emit


def _text_overlay(ctx, line, subjects, layers, start, end):
    ops = []
    for subject, layer in zip(subjects, layers):
        x, y = ctx.position(subject)
        ops.append(
            {
                "op": "text",
                "layer": layer,
                "frame": start,
                "end_frame": end,
                "text": line.text or line.line_text,
                "x": x,
                "y": y,
            }
        )
        ops.append(_hold(layer, end))
    return ops


def _spec(code, summary, emit, **kwargs) -> ActionSpec:
    return ActionSpec(code=code, summary=summary, emit=emit, **kwargs)


VOCABULARY: dict[str, ActionSpec] = {
    spec.code: spec
    for spec in [
        _spec("static", "Present, no movement", _static),
        _spec("fade_in", "Alpha 0 -> 100", _fade("in"), is_entry=True),
        _spec("fade_out", "Alpha 100 -> 0", _fade("out")),
        _spec("enter_from_left", "Slides in from the left and settles", _enter("left"), is_entry=True),
        _spec("enter_from_right", "Slides in from the right and settles", _enter("right"), is_entry=True),
        _spec("walk_left_to_right", "Walks all the way across, left to right", _walk_across("lr")),
        _spec("walk_right_to_left", "Walks all the way across, right to left", _walk_across("rl")),
        _spec("walk_cycle", "Walks in place (nested walk_cycle label)", _walk_cycle),
        _spec("scale_up", "Grows by scale_step", _scale("up")),
        _spec("scale_down", "Shrinks by scale_step", _scale("down")),
        _spec(
            "pick_up",
            "Character picks up an object (rig parenting)",
            _pick_up,
            subject_count=2,
            subject_roles="character first, then object",
        ),
        _spec("camera_pan_left", "Documentary camera pan left", _camera_pan("left")),
        _spec("camera_pan_right", "Documentary camera pan right", _camera_pan("right")),
        _spec("text_overlay", "Lower-third text field", _text_overlay),
    ]
}


def emit_line(ctx: Context, line, layers: list[str], start_frame: int, end_frame: int) -> list[dict]:
    """Lower one aligned script line into ops.

    An action chain splits the frame range: entry actions (fade_in,
    enter_from_*) take `entry_frames`, whatever follows gets the remainder.
    """
    ops: list[dict] = [
        {
            "op": "comment",
            "text": f"line {line.line_id} [{start_frame}-{end_frame}] {line.action}: {line.line_text}",
        }
    ]
    for layer in layers:
        ops.append({"op": "ensure_layer", "layer": layer})

    cursor = start_frame
    for index, code in enumerate(line.action_chain):
        spec = VOCABULARY[code]
        is_last = index == len(line.action_chain) - 1
        if is_last or not spec.is_entry:
            segment_end = end_frame
        else:
            segment_end = min(cursor + ctx.entry_frames, end_frame)
        ops += spec.emit(ctx, line, line.subjects, layers, cursor, segment_end)
        cursor = segment_end
    return _dedupe_places(ops)


def _dedupe_places(ops: list[dict]) -> list[dict]:
    """Within one line, a symbol is placed once.

    Later segments of an action chain ("fade_in + static") would otherwise drop
    a fresh blank keyframe and re-add the symbol, throwing away the state the
    previous segment just built. They become plain property keyframes instead.
    """
    placed: set[str] = set()
    result = []
    for op in ops:
        if op["op"] == "place" and op["layer"] in placed:
            op = {
                "op": "set_props",
                "layer": op["layer"],
                "frame": op["frame"],
                "x": op["x"],
                "y": op["y"],
                "alpha": op["alpha"],
                "scale_x": op["scale_x"],
                "scale_y": op["scale_y"],
            }
        elif op["op"] == "place":
            placed.add(op["layer"])
        result.append(op)
    return result


def context_from_config(config: dict) -> Context:
    stage = config.get("stage", {})
    return Context(
        fps=int(config.get("fps", 24)),
        stage_width=int(stage.get("width", 1920)),
        stage_height=int(stage.get("height", 1080)),
        entry_frames=int(config.get("entry_frames", 12)),
        offstage_margin=int(config.get("offstage_margin", 400)),
        scale_step=float(config.get("scale_step", 0.2)),
        camera_pan_distance=int(config.get("camera_pan_distance", 300)),
        default_positions=config.get("default_positions", {}),
    )
