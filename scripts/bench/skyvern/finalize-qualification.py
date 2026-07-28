#!/usr/bin/env python3
"""Derive immutable report receipts after Skyvern's asynchronous telemetry has settled."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNNER = HERE / 'run-qualification.py'
spec = importlib.util.spec_from_file_location('skyvern_qualification_runner', RUNNER)
runner = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runner
spec.loader.exec_module(runner)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit('usage: finalize-qualification.py <collection.jsonl> <finalized.jsonl>')
    source = Path(sys.argv[1]).resolve()
    destination = Path(sys.argv[2]).resolve()
    if source == destination:
        raise SystemExit('source and destination must differ; raw collection is append-only')
    receipts = runner.read_receipts(source)
    finalized = []
    for receipt in receipts:
        logs = runner.logs_for_run(receipt['run_id'])
        calls = runner.parse_llm_calls(logs)
        usage = runner.sum_usage(calls)
        regeneration = runner.sum_usage([call for call in calls if call['prompt_name'] == 'script-reviewer'])
        receipt = {
            **receipt,
            'usage': usage,
            'runtime_usage': runner.subtract_usage(usage, regeneration),
            'regeneration_usage': regeneration,
            'llm_call_aggregates': calls,
        }
        raw_directory = runner.ROOT / receipt['raw_directory']
        raw_directory.mkdir(parents=True, exist_ok=True)
        runner.atomic_write(raw_directory / 'skyvern.log', '\n'.join(logs) + ('\n' if logs else ''))
        finalized.append(receipt)
    destination.parent.mkdir(parents=True, exist_ok=True)
    runner.atomic_write(destination, ''.join(json.dumps(receipt, sort_keys=True) + '\n' for receipt in finalized))
    print(f'wrote {destination} from {len(finalized)} append-only collection receipts')


if __name__ == '__main__':
    main()
