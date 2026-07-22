import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("run_curve.py")
SPEC = importlib.util.spec_from_file_location("browser_use_curve_runner", MODULE_PATH)
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)

PROTOCOL = {
    "protocol_id": "protocol-v1",
    "provider": "openai",
    "model": "model-1",
    "checkpoints": [{"id": "WP-N07"}, {"id": "WP-N10"}],
}


def row(task: str, repetition: int, call: int, outcome: str) -> dict:
    return {
        "protocol_id": "protocol-v1",
        "provider": "openai",
        "model": "model-1",
        "task_id": task,
        "run_id": f"browser-use-{task}-r{repetition:02d}",
        "repetition": repetition,
        "call_index": call,
        "step_outcome": outcome,
        **({"verification_passed": outcome == "success"} if outcome != "continued" else {}),
    }


class BrowserUseCurveResumeTest(unittest.TestCase):
    def write_rows(self, rows: list[dict]) -> Path:
        directory = Path(tempfile.mkdtemp())
        path = directory / "raw.jsonl"
        path.write_text("".join(json.dumps(item) + "\n" for item in rows))
        return path

    def test_refuses_nonempty_overwrite(self) -> None:
        path = self.write_rows([row("WP-N07", 1, 1, "success")])
        with self.assertRaisesRegex(RuntimeError, "pass --resume"):
            RUNNER.completed_run_ids(path, PROTOCOL, False)

    def test_resumes_only_completed_runs_and_bounds_new_work(self) -> None:
        path = self.write_rows([
            row("WP-N07", 1, 1, "continued"),
            row("WP-N07", 1, 2, "failure"),
        ])
        completed = RUNNER.completed_run_ids(path, PROTOCOL, True)
        self.assertEqual(completed, {"browser-use-WP-N07-r01"})
        plan = RUNNER.pending_runs(PROTOCOL["checkpoints"], [1, 2], completed, 1)
        self.assertEqual([(item[0]["id"], item[1]) for item in plan], [("WP-N07", 2)])

    def test_rejects_an_incomplete_tail_instead_of_repeating_side_effects(self) -> None:
        path = self.write_rows([row("WP-N07", 1, 1, "continued")])
        with self.assertRaisesRegex(RuntimeError, "incomplete"):
            RUNNER.completed_run_ids(path, PROTOCOL, True)

    def test_rejects_receipts_from_another_protocol(self) -> None:
        invalid = row("WP-N07", 1, 1, "success")
        invalid["model"] = "other-model"
        path = self.write_rows([invalid])
        with self.assertRaisesRegex(RuntimeError, "mismatches protocol field model"):
            RUNNER.completed_run_ids(path, PROTOCOL, True)


if __name__ == "__main__":
    unittest.main()
