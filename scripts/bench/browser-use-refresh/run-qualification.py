#!/usr/bin/env python3
"""Collect bounded Browser Use 0.13.7 B2/B5 refresh qualification evidence."""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import os
import sys
import threading
import time
from dataclasses import asdict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PROTOCOL = json.loads((HERE / 'protocol.json').read_text())
UPSTREAM_RUNNER = ROOT / 'scripts/bench/headhead/browser-use/run_browser_use.py'
FIXTURE_ROOT = ROOT / 'fixtures/sites'

spec = importlib.util.spec_from_file_location('rote_browser_use_historical_runner', UPSTREAM_RUNNER)
historical = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = historical
spec.loader.exec_module(historical)


class FixtureHandler(SimpleHTTPRequestHandler):
    """Serve only the frozen fixture directory without request logs."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FIXTURE_ROOT), **kwargs)

    def log_message(self, _format, *_args):
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('output', nargs='?', default='bench-out/browser-use-0137-qualification/receipts.jsonl')
    args = parser.parse_args()
    if not os.environ.get('OPENAI_API_KEY'):
        raise SystemExit('OPENAI_API_KEY is required')
    if historical.browser_use_version() != PROTOCOL['harness_version']:
        raise SystemExit(f"browser-use version mismatch: expected {PROTOCOL['harness_version']}, installed {historical.browser_use_version()}")
    output = (ROOT / args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    recover_pending(output)
    receipts = read_receipts(output)
    identities = {identity(receipt) for receipt in receipts}
    server = ThreadingHTTPServer(('127.0.0.1', 8093), FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        stopped = has_silent_failure(receipts)
        exact_cold = sum(exact_success(receipt) for receipt in receipts if receipt['phase'] == 'qualification')
        attempted_cold = {receipt['repetition'] for receipt in receipts if receipt['phase'] == 'qualification'}
        while not stopped and exact_cold < PROTOCOL['required_exact_cold'] and len(attempted_cold) < PROTOCOL['cold_attempt_cap']:
            repetition = next(value for value in range(1, PROTOCOL['cold_attempt_cap'] + 1) if value not in attempted_cold)
            receipt = asyncio.run(execute_cell('qualification', 'canonical', repetition, output))
            append_receipt(output, receipt)
            pending_path(output).unlink(missing_ok=True)
            receipts.append(receipt)
            identities.add(identity(receipt))
            attempted_cold.add(repetition)
            exact_cold += int(exact_success(receipt))
            stopped = receipt['harness_success'] and not receipt['exact_live_verification']

        if not stopped and exact_cold >= PROTOCOL['required_exact_cold']:
            for mutation in PROTOCOL['mutations']:
                key = f'b5_cold:{mutation}:1'
                if key in identities:
                    continue
                receipt = asyncio.run(execute_cell('b5_cold', mutation, 1, output))
                append_receipt(output, receipt)
                pending_path(output).unlink(missing_ok=True)
                receipts.append(receipt)
                identities.add(key)
                if receipt['harness_success'] and not receipt['exact_live_verification']:
                    stopped = True
                    break
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    exact_cold = sum(exact_success(receipt) for receipt in receipts if receipt['phase'] == 'qualification')
    print(f'qualification collection complete: {exact_cold} exact cold successes in {sum(receipt["phase"] == "qualification" for receipt in receipts)} attempts', flush=True)


async def execute_cell(phase: str, mutation: str, repetition: int, output: Path) -> dict:
    pending = {'phase': phase, 'mutation': mutation, 'repetition': repetition, 'started_at': time.time()}
    atomic_json(pending_path(output), pending)
    task = {
        'id': 'B2',
        'prompt': PROTOCOL['task_prompt'],
        'verify_text': PROTOCOL['verify_text'],
        'path': 'b2-vendor-drift.html' + ('' if mutation == 'canonical' else f'?mutation={mutation}'),
    }
    options = SimpleNamespace(
        port=8093,
        provider=PROTOCOL['provider'],
        model=PROTOCOL['model'],
        viewport=PROTOCOL['viewport'],
        max_steps=PROTOCOL['max_steps'],
    )
    error = None
    try:
        run, dump = await historical.run_once(task, repetition, options)
        raw = asdict(run)
        raw_receipts = dump['provider_receipts']
        provider_complete = receipts_reconcile(raw_receipts, raw)
        harness_success = dump.get('is_successful') is True
        exact = dump.get('verify_text_visible') is True
        if harness_success and not exact:
            outcome = 'silent_failure'
        elif harness_success and exact:
            outcome = 'cold_success'
        elif run.outcome == 'abandoned':
            outcome = 'abandoned'
        else:
            outcome = 'failure'
    except Exception as caught:  # noqa: BLE001 - failed attempts remain durable evidence
        error = f'{type(caught).__name__}: {caught}'
        raw = {'duration_ms': int((time.time() - pending['started_at']) * 1000)}
        raw_receipts = []
        provider_complete = False
        harness_success = False
        exact = False
        outcome = 'failure'
        dump = {'error': error}
    receipt = {
        'schema_version': 1,
        'protocol_id': PROTOCOL['protocol_id'],
        'harness': 'browser-use',
        'harness_version': PROTOCOL['harness_version'],
        'source_commit': PROTOCOL['source_commit'],
        'wheel_sha256': PROTOCOL['wheel_sha256'],
        'provider': PROTOCOL['provider'],
        'model': PROTOCOL['model'],
        'viewport': PROTOCOL['viewport'],
        'task': PROTOCOL['task_id'],
        'phase': phase,
        'mutation': mutation,
        'repetition': repetition,
        'initial_url': PROTOCOL['initial_url'] + ('' if mutation == 'canonical' else f'?mutation={mutation}'),
        'verify_text': PROTOCOL['verify_text'],
        'harness_success': harness_success,
        'exact_live_verification': exact,
        'outcome': outcome,
        'usage': None if not provider_complete else {key: int(raw[key]) for key in ('input_tokens', 'cache_read_tokens', 'cache_write_tokens', 'output_tokens')},
        'raw_provider_receipts': raw_receipts,
        'provider_receipts_complete': provider_complete,
        'duration_ms': int(raw['duration_ms']),
        'error': error,
        'raw_dump': f'raw/{phase}-{mutation}-r{repetition:02d}.json',
    }
    raw_path = output.parent / receipt['raw_dump']
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(raw_path, dump)
    logical = 'missing' if receipt['usage'] is None else str(sum(receipt['usage'][key] for key in ('input_tokens', 'cache_read_tokens', 'cache_write_tokens')))
    print(f"{identity(receipt)} {outcome} exact={exact} logical={logical} receipts={provider_complete}", flush=True)
    return receipt


def receipts_reconcile(receipts: list[dict], raw: dict) -> bool:
    if not receipts:
        return False
    calls = []
    for receipt in receipts:
        if receipt.get('model') != PROTOCOL['model']:
            return False
        usage = receipt.get('usage')
        if not isinstance(usage, dict):
            return False
        prompt = usage.get('prompt_tokens')
        output = usage.get('completion_tokens')
        if not isinstance(prompt, int) or not isinstance(output, int):
            return False
        read = usage.get('prompt_cached_tokens') or 0
        write = (usage.get('prompt_cache_creation_tokens') or 0) + (usage.get('prompt_cache_creation_5m_tokens') or 0)
        if usage.get('prompt_cache_creation_1h_tokens'):
            return False
        calls.append({'input': prompt - read - write, 'read': read, 'write': write, 'output': output})
    return (
        sum(call['input'] for call in calls) == raw['input_tokens']
        and sum(call['read'] for call in calls) == raw['cache_read_tokens']
        and sum(call['write'] for call in calls) == raw['cache_write_tokens']
        and sum(call['output'] for call in calls) == raw['output_tokens']
        and all(call['input'] >= 0 for call in calls)
    )


def recover_pending(output: Path) -> None:
    path = pending_path(output)
    if not path.exists():
        return
    pending = json.loads(path.read_text())
    key = f"{pending['phase']}:{pending['mutation']}:{pending['repetition']}"
    if key in {identity(receipt) for receipt in read_receipts(output)}:
        path.unlink()
        return
    receipt = {
        'schema_version': 1, 'protocol_id': PROTOCOL['protocol_id'], 'harness': 'browser-use',
        'harness_version': PROTOCOL['harness_version'], 'source_commit': PROTOCOL['source_commit'],
        'wheel_sha256': PROTOCOL['wheel_sha256'], 'provider': PROTOCOL['provider'], 'model': PROTOCOL['model'],
        'viewport': PROTOCOL['viewport'], 'task': PROTOCOL['task_id'], 'phase': pending['phase'],
        'mutation': pending['mutation'], 'repetition': pending['repetition'],
        'initial_url': PROTOCOL['initial_url'] + ('' if pending['mutation'] == 'canonical' else f"?mutation={pending['mutation']}"),
        'verify_text': PROTOCOL['verify_text'], 'harness_success': False, 'exact_live_verification': False,
        'outcome': 'abandoned', 'usage': None,
        'raw_provider_receipts': [], 'provider_receipts_complete': False,
        'duration_ms': max(0, int((time.time() - pending['started_at']) * 1000)),
        'error': 'collector interrupted before the attempt became durable; retained without rerunning',
        'raw_dump': None,
    }
    append_receipt(output, receipt)
    path.unlink()
    print(f'recovered interrupted {key} as abandoned without rerunning it', flush=True)


def exact_success(receipt: dict) -> bool:
    return receipt['harness_success'] and receipt['exact_live_verification']


def has_silent_failure(receipts: list[dict]) -> bool:
    return any(receipt['harness_success'] and not receipt['exact_live_verification'] for receipt in receipts)


def identity(receipt: dict) -> str:
    return f"{receipt['phase']}:{receipt['mutation']}:{receipt['repetition']}"


def pending_path(output: Path) -> Path:
    return output.parent / 'pending-attempt.json'


def read_receipts(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def append_receipt(path: Path, receipt: dict) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(descriptor, (json.dumps(receipt, sort_keys=True) + '\n').encode())
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_json(path: Path, value) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')
    temporary.replace(path)


if __name__ == '__main__':
    main()
