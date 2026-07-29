import importlib.util
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name('run-qualification.py')
SPEC = importlib.util.spec_from_file_location('browser_use_refresh_under_test', MODULE_PATH)
RUNNER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RUNNER
SPEC.loader.exec_module(RUNNER)


class BrowserUseRefreshRunnerTest(unittest.TestCase):
    def test_receipts_reconcile_provider_cache_buckets(self):
        receipts = [
            {'model': 'gpt-4.1-mini', 'usage': {'prompt_tokens': 100, 'prompt_cached_tokens': 40, 'completion_tokens': 5}},
            {'model': 'gpt-4.1-mini', 'usage': {'prompt_tokens': 20, 'prompt_cached_tokens': 0, 'completion_tokens': 2}},
        ]
        self.assertTrue(RUNNER.receipts_reconcile(receipts, {
            'input_tokens': 80, 'cache_read_tokens': 40, 'cache_write_tokens': 0, 'output_tokens': 7,
        }))
        self.assertFalse(RUNNER.receipts_reconcile(receipts, {
            'input_tokens': 79, 'cache_read_tokens': 40, 'cache_write_tokens': 0, 'output_tokens': 7,
        }))

    def test_interrupted_attempt_is_retained_without_zero_usage(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'receipts.jsonl'
            RUNNER.atomic_json(RUNNER.pending_path(output), {
                'phase': 'qualification', 'mutation': 'canonical', 'repetition': 1, 'started_at': time.time(),
            })
            RUNNER.recover_pending(output)
            receipt = json.loads(output.read_text())
            self.assertEqual(receipt['outcome'], 'abandoned')
            self.assertIsNone(receipt['usage'])
            self.assertFalse(receipt['provider_receipts_complete'])

    def test_append_receipt_preserves_order(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'receipts.jsonl'
            RUNNER.append_receipt(output, {'attempt': 1})
            RUNNER.append_receipt(output, {'attempt': 2})
            self.assertEqual([json.loads(line) for line in output.read_text().splitlines()], [{'attempt': 1}, {'attempt': 2}])


if __name__ == '__main__':
    unittest.main()
