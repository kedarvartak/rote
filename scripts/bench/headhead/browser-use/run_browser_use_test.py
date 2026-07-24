import importlib.util
import unittest
import sys
from pathlib import Path
from types import SimpleNamespace

MODULE_PATH = Path(__file__).with_name("run_browser_use.py")
SPEC = importlib.util.spec_from_file_location("headhead_browser_use", MODULE_PATH)
module = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


class Usage:
    def __init__(self, values):
        self.values = values

    def model_dump(self, mode="json"):
        return self.values


class History:
    def __init__(self, successful):
        self.successful = successful

    def is_successful(self):
        return self.successful


class BrowserUseHeadToHeadTests(unittest.TestCase):
    def test_openai_usage_splits_inclusive_prompt_cache(self):
        agent = SimpleNamespace(token_cost_service=SimpleNamespace(usage_history=[
            SimpleNamespace(usage=Usage({"prompt_tokens": 100, "prompt_cached_tokens": 40, "completion_tokens": 7})),
        ]))
        self.assertEqual(module.usage_from_agent(agent, "openai"), (60, 40, 0, 7))

    def test_anthropic_usage_keeps_prompt_remainder_separate(self):
        agent = SimpleNamespace(token_cost_service=SimpleNamespace(usage_history=[
            SimpleNamespace(usage=Usage({
                "prompt_tokens": 60,
                "prompt_cached_tokens": 40,
                "prompt_cache_creation_5m_tokens": 10,
                "completion_tokens": 7,
            })),
        ]))
        self.assertEqual(module.usage_from_agent(agent, "anthropic"), (60, 40, 10, 7))

    def test_unpriceable_one_hour_cache_writes_fail(self):
        agent = SimpleNamespace(token_cost_service=SimpleNamespace(usage_history=[
            SimpleNamespace(usage=Usage({
                "prompt_tokens": 60,
                "prompt_cache_creation_1h_tokens": 10,
                "completion_tokens": 7,
            })),
        ]))
        with self.assertRaisesRegex(RuntimeError, "1-hour cache writes"):
            module.usage_from_agent(agent, "anthropic")

    def test_missing_receipts_fail_instead_of_recording_zero(self):
        agent = SimpleNamespace(token_cost_service=SimpleNamespace(usage_history=[]))
        with self.assertRaisesRegex(RuntimeError, "refusing to record zero"):
            module.usage_from_agent(agent, "openai")

    def test_success_requires_conclusion_and_exact_live_text(self):
        self.assertEqual(module.classify_outcome(History(True), "Done: exact", "Done: exact"), "success")
        self.assertEqual(module.classify_outcome(History(True), "wrong", "Done: exact"), "failure")
        self.assertEqual(module.classify_outcome(History(None), "wrong", "Done: exact"), "abandoned")
        with self.assertRaisesRegex(RuntimeError, "cannot be verified"):
            module.classify_outcome(History(True), None, "Done: exact")


if __name__ == "__main__":
    unittest.main()
