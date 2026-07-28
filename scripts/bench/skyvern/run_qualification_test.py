import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name('run-qualification.py')
SPEC = importlib.util.spec_from_file_location('skyvern_runner_under_test', MODULE_PATH)
RUNNER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RUNNER
SPEC.loader.exec_module(RUNNER)


class SkyvernQualificationRunnerTest(unittest.TestCase):
    def test_complete_pairs_require_every_exact_cell(self):
        receipts = [{'phase': 'cold', 'mutation': 'canonical', 'repetition': 1, 'harness_success': True, 'exact_live_verification': True}]
        receipts.extend(
            {'phase': phase, 'mutation': mutation, 'repetition': 1, 'harness_success': True, 'exact_live_verification': True}
            for phase, mutation in [('warm', 'canonical'), *[('drift', value) for value in RUNNER.PROTOCOL['mutations']]]
        )
        self.assertEqual(RUNNER.complete_repetitions(receipts), {1})
        receipts[-1]['exact_live_verification'] = False
        self.assertEqual(RUNNER.complete_repetitions(receipts), set())
        self.assertEqual(RUNNER.paired_repetitions(receipts, require_exact=False), {1})

    def test_append_receipt_never_overwrites_prior_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'receipts.jsonl'
            RUNNER.append_receipt(path, {'attempt': 1})
            RUNNER.append_receipt(path, {'attempt': 2})
            self.assertEqual([json.loads(line) for line in path.read_text().splitlines()], [{'attempt': 1}, {'attempt': 2}])

    def test_aggregate_usage_keeps_cache_reads_logical_and_reconciles_segments(self):
        calls = [
            {'input_tokens': 100, 'cache_read_tokens': 40, 'cache_write_tokens': 0, 'output_tokens': 5},
            {'input_tokens': 20, 'cache_read_tokens': 0, 'cache_write_tokens': 0, 'output_tokens': 2},
        ]
        total = RUNNER.sum_usage(calls)
        self.assertEqual(total, {'input_tokens': 80, 'cache_read_tokens': 40, 'cache_write_tokens': 0, 'output_tokens': 7})
        self.assertEqual(RUNNER.subtract_usage(total, RUNNER.sum_usage(calls[1:])), {'input_tokens': 60, 'cache_read_tokens': 40, 'cache_write_tokens': 0, 'output_tokens': 5})


if __name__ == '__main__':
    unittest.main()
