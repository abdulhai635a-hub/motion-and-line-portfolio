"""Stdlib-only tests for the whole pipeline: python3 tests/test_pipeline.py"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import actions  # noqa: E402
import align  # noqa: E402
import generate_jsfl  # noqa: E402
import map_frames  # noqa: E402
import script_sheet  # noqa: E402

SHEET = ROOT / "examples" / "script_sheet.csv"
CONFIG = json.loads((ROOT / "config.json").read_text())


def write(tmp: Path, name: str, text: str) -> Path:
    path = tmp / name
    path.write_text(text, encoding="utf-8")
    return path


class SheetTests(unittest.TestCase):
    def test_example_sheet_parses(self):
        lines = script_sheet.load(SHEET)
        self.assertEqual([l.line_id for l in lines], [1, 2, 3, 4])
        self.assertEqual(lines[0].subjects[0].symbol, "CHAR_Raju")
        self.assertEqual(lines[1].action_chain, ["fade_in", "static"])
        self.assertEqual([s.symbol for s in lines[2].subjects], ["CHAR_Raju", "OBJ_Pizza"])
        self.assertEqual(lines[3].text, "Dhaka, 1971")

    def test_unknown_action_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write(
                Path(tmp), "bad.csv",
                "line_id,line_text,subject_type,subject_name,action,animation\n"
                "1,hello,character,Raju,moonwalk,linear\n",
            )
            with self.assertRaises(script_sheet.SheetError) as caught:
                script_sheet.load(path)
            self.assertIn("moonwalk", str(caught.exception))

    def test_relational_action_needs_two_subjects(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write(
                Path(tmp), "bad.csv",
                "line_id,line_text,subject_type,subject_name,action,animation\n"
                "1,hello,character,Raju,pick_up,linear\n",
            )
            with self.assertRaises(script_sheet.SheetError) as caught:
                script_sheet.load(path)
            self.assertIn("needs exactly 2 subjects", str(caught.exception))

    def test_missing_assets_flagged(self):
        lines = script_sheet.load(SHEET)
        library = {"CHAR_Raju", "TXT_Caption"}
        self.assertEqual(
            script_sheet.missing_assets(lines, library),
            [(2, "OBJ_Pizza"), (3, "OBJ_Pizza")],
        )


class AlignmentTests(unittest.TestCase):
    def build_words(self, transcript, step=0.5):
        words, t = [], 0.0
        for word in transcript.split():
            words.append(align.Word(word, round(t, 3), round(t + 0.4, 3), 0.9))
            t += step
        return words

    def test_exact_transcript_gives_line_boundaries(self):
        lines = script_sheet.load(SHEET)
        words = self.build_words(" ".join(l.line_text for l in lines))
        timings = align.align_lines(lines, words)
        self.assertEqual(timings[0].start_sec, 0.0)
        self.assertTrue(timings[0].end_sec < timings[1].start_sec)
        self.assertTrue(all(t.confidence > 0.8 for t in timings))

    def test_asr_errors_lower_confidence_but_keep_order(self):
        lines = script_sheet.load(SHEET)
        # Two dropped words and one substitution, as a real ASR pass would give.
        transcript = (
            "Raju walked the office "
            "a pizza sat on the tabel "
            "Raju picked up the pizza "
            "Dhaka 1971"
        )
        timings = align.align_lines(lines, self.build_words(transcript), 0.5)
        self.assertEqual([t.line_id for t in timings], [1, 2, 3, 4])
        for previous, current in zip(timings, timings[1:]):
            self.assertLessEqual(previous.start_sec, current.start_sec)
        self.assertLess(timings[0].confidence, 1.0)

    def test_unmatched_line_is_flagged_for_review(self):
        lines = script_sheet.load(SHEET)[:2]
        words = self.build_words("Raju walked toward the office")
        timings = align.align_lines(lines, words, 0.5)
        self.assertEqual(timings[1].confidence, 0.0)
        self.assertTrue(timings[1].needs_review)

    def test_needleman_wunsch_is_monotonic(self):
        pairs = align.needleman_wunsch(["a", "b", "c"], ["a", "x", "b", "c"])
        matched = [(i, j) for i, j in pairs if i is not None and j is not None]
        self.assertEqual([i for i, _ in matched], sorted(i for i, _ in matched))

    def test_normalize_keeps_non_latin_scripts(self):
        self.assertEqual(align.normalize("রাজু,"), "রাজু")
        self.assertEqual(align.normalize("Office."), "office")


class FrameMappingTests(unittest.TestCase):
    def test_formula_matches_prd(self):
        self.assertEqual(map_frames.sec_to_frame(2.140, 24), 52)
        self.assertEqual(map_frames.sec_to_frame(4.870, 24), 118)
        self.assertEqual(map_frames.sec_to_frame(0.0, 24), 1)

    def timeline(self, timings, library=None, config=None):
        return map_frames.build_timeline(
            script_sheet.load(SHEET), timings, config or dict(CONFIG), "vo.wav", library
        )

    def test_layers_are_reused_per_symbol(self):
        timings = [
            align.LineTiming(1, 0.0, 2.0, 1.0),
            align.LineTiming(2, 2.5, 4.0, 1.0),
            align.LineTiming(3, 4.5, 6.0, 1.0),
            align.LineTiming(4, 6.5, 7.0, 1.0),
        ]
        timeline = self.timeline(timings)
        self.assertEqual(
            [layer["name"] for layer in timeline["layers"]],
            ["char_Raju", "obj_Pizza", "txt_Caption"],
        )
        self.assertEqual(timeline["lines"][0]["start_frame"], 1)
        self.assertEqual(timeline["qa"]["warnings"], [])

    def test_overlap_and_short_range_warn(self):
        timings = [
            align.LineTiming(1, 0.0, 5.0, 1.0),
            align.LineTiming(2, 2.0, 4.0, 1.0),
            align.LineTiming(3, 1.0, 6.0, 1.0),  # Raju again, overlapping line 1
            align.LineTiming(4, 6.0, 6.01, 1.0),  # shorter than min_line_frames
        ]
        warnings = " ".join(self.timeline(timings)["qa"]["warnings"])
        self.assertIn("overlaps line 1", warnings)
        self.assertIn("padded", warnings)

    def test_low_confidence_and_missing_assets_reach_qa(self):
        timings = [align.LineTiming(i, i * 2.0, i * 2.0 + 1.5, 0.2 if i == 1 else 1.0)
                   for i in (1, 2, 3, 4)]
        timeline = self.timeline(timings, library={"CHAR_Raju", "TXT_Caption"})
        self.assertEqual(timeline["qa"]["flagged_line_ids"], [1])
        self.assertEqual(timeline["qa"]["missing_assets"], ["OBJ_Pizza"])

    def test_round_trips_back_into_script_lines(self):
        timings = [align.LineTiming(i, i * 2.0, i * 2.0 + 1.5, 1.0) for i in (1, 2, 3, 4)]
        rebuilt = map_frames.lines_from_timeline(self.timeline(timings))
        line, entry = rebuilt[2]
        self.assertEqual(line.action_chain, ["pick_up"])
        self.assertEqual([s.symbol for s in line.subjects], ["CHAR_Raju", "OBJ_Pizza"])
        self.assertEqual(entry["subjects"][0]["layer"], "char_Raju")


class ActionTests(unittest.TestCase):
    def setUp(self):
        self.ctx = actions.context_from_config(CONFIG)
        self.lines = script_sheet.load(SHEET)

    def ops_for(self, index, start=1, end=49):
        line = self.lines[index]
        layers = [map_frames.layer_name(s) for s in line.subjects]
        return actions.emit_line(self.ctx, line, layers, start, end)

    def test_chain_places_the_symbol_once(self):
        ops = self.ops_for(1)
        places = [op for op in ops if op["op"] == "place"]
        self.assertEqual(len(places), 1)
        self.assertEqual(places[0]["alpha"], 0)
        self.assertTrue(any(op["op"] == "tween" for op in ops))
        self.assertEqual(ops[-1]["through_frame"], 49)

    def test_entry_action_takes_entry_frames_then_holds(self):
        ops = self.ops_for(1, start=1, end=200)
        fade_end = [op for op in ops if op["op"] == "set_props"][0]["frame"]
        self.assertEqual(fade_end, 1 + CONFIG["entry_frames"])

    def test_walk_crosses_the_stage_and_loops_the_label(self):
        ops = self.ops_for(0)
        self.assertEqual(ops[2]["x"], -CONFIG["offstage_margin"])
        self.assertEqual(
            [op for op in ops if op["op"] == "set_props"][0]["x"],
            CONFIG["stage"]["width"] + CONFIG["offstage_margin"],
        )
        self.assertEqual([op["label"] for op in ops if op["op"] == "loop_label"], ["walk_cycle"])

    def test_pick_up_parents_object_to_character_and_releases_it(self):
        ops = self.ops_for(2, start=100, end=160)
        parent = [op for op in ops if op["op"] == "rig_parent"][0]
        self.assertEqual((parent["layer"], parent["parent_layer"]), ("obj_Pizza", "char_Raju"))
        self.assertEqual(parent["frame"], 100)
        self.assertEqual([op for op in ops if op["op"] == "rig_unparent"][0]["frame"], 160)

    def test_easing_maps_to_animate_range(self):
        self.assertEqual(actions.EASING["ease-out"], 50)
        self.assertEqual(actions.EASING["ease-in"], -50)
        for value in actions.EASING.values():
            self.assertTrue(-100 <= value <= 100)

    def test_every_action_emits_something(self):
        for code, spec in actions.VOCABULARY.items():
            subjects = self.lines[2].subjects if spec.subject_count == 2 else [self.lines[0].subjects[0]]
            line = script_sheet.ScriptLine(9, "x", subjects, [code], "linear", "caption")
            layers = [map_frames.layer_name(s) for s in subjects]
            ops = actions.emit_line(self.ctx, line, layers, 10, 40)
            self.assertTrue(len(ops) > 2, f"{code} emitted nothing")


class JsflTests(unittest.TestCase):
    def timeline(self):
        timings = [align.LineTiming(i, i * 2.0, i * 2.0 + 1.5, 1.0) for i in (1, 2, 3, 4)]
        return map_frames.build_timeline(
            script_sheet.load(SHEET), timings, dict(CONFIG), "vo.wav"
        )

    def payload(self, text):
        call = text[text.rindex("VAA.run("):]
        return json.loads(call[call.index(", [") + 2: call.rindex(");")])

    def test_batches_split_on_line_boundaries(self):
        ops = generate_jsfl.build_ops(self.timeline())
        batches = generate_jsfl.chunk(ops, 2)
        self.assertEqual(len(batches), 2)
        for batch in batches:
            self.assertEqual(batch[0]["op"], "comment")
            self.assertEqual(len([op for op in batch if op["op"] == "comment"]), 2)

    def test_written_file_carries_runtime_and_valid_json(self):
        timeline = self.timeline()
        timeline["config"]["batch_size"] = 0
        with tempfile.TemporaryDirectory() as tmp:
            written = generate_jsfl.write_batches(timeline, tmp, "vaa", None)
            self.assertEqual(len(written), 1)
            text = written[0].read_text(encoding="utf-8")
            self.assertIn("var VAA = (function ()", text)
            ops = self.payload(text)
            self.assertEqual(ops[0]["op"], "comment")
            self.assertTrue(any(op["op"] == "place" for op in ops))

    def test_only_the_first_batch_imports_the_voice_over(self):
        timeline = self.timeline()
        timeline["config"]["batch_size"] = 1
        with tempfile.TemporaryDirectory() as tmp:
            audio = write(Path(tmp), "vo.wav", "not really audio")
            written = generate_jsfl.write_batches(timeline, tmp, "vaa", str(audio))
            self.assertEqual(len(written), 4)
            self.assertIn(audio.resolve().as_uri(), written[0].read_text())
            self.assertIn('"audio_uri": ""', written[1].read_text())


if __name__ == "__main__":
    unittest.main(verbosity=2)
