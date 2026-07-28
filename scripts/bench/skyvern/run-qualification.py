#!/usr/bin/env python3
"""Collect bounded, append-safe Skyvern B2/B5 qualification evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PROTOCOL = json.loads((HERE / 'protocol.json').read_text())
ANSI = re.compile(r'\x1b\[[0-9;]*m')
TERMINAL = {'completed', 'failed', 'terminated', 'canceled', 'timed_out'}
FIELDS = tuple(PROTOCOL['parameters'])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('output', nargs='?', default='bench-out/skyvern-qualification/receipts.jsonl')
    parser.add_argument('--fresh', action='store_true', help='destroy only the isolated Skyvern qualification state first')
    args = parser.parse_args()
    if not os.environ.get('OPENAI_API_KEY'):
        raise SystemExit('OPENAI_API_KEY is required')
    output = (ROOT / args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    state = HERE / 'state'
    if args.fresh:
        compose('down', '-v', check=False)
        shutil.rmtree(state, ignore_errors=True)
        if output.exists():
            output.unlink()
        shutil.rmtree(output.parent / 'raw', ignore_errors=True)
    state.mkdir(parents=True, exist_ok=True)
    fixture_state = state / 'fixture'
    fixture_state.mkdir(parents=True, exist_ok=True)
    fixture_state.chmod(0o777)
    env_path = state / 'skyvern.env'
    env_path.write_text('\n'.join([
        'ENABLE_OPENAI=true',
        'LLM_KEY=OPENAI_GPT4_1_MINI',
        f"OPENAI_API_KEY={os.environ['OPENAI_API_KEY']}",
        'LOG_LEVEL=INFO',
        '',
    ]))
    env_path.chmod(0o600)
    compose('up', '-d')
    wait_for_service()
    start_fixture_server()
    api_key = read_api_key()
    recover_pending_cell(api_key, output)
    receipts = read_receipts(output)
    identities = {identity(receipt) for receipt in receipts}
    completed_pairs = complete_repetitions(receipts)
    attempted_repetitions = {receipt['repetition'] for receipt in receipts if receipt['phase'] == 'cold'}

    while len(completed_pairs) < PROTOCOL['required_complete_pairs']:
        finished_repetitions = paired_repetitions(receipts, require_exact=False)
        resumable = sorted(
            receipt['repetition'] for receipt in receipts
            if receipt['phase'] == 'cold'
            and receipt['harness_success']
            and receipt['exact_live_verification']
            and receipt['repetition'] not in finished_repetitions
        )
        if not resumable and len(attempted_repetitions) >= PROTOCOL['cold_attempt_cap']:
            break
        repetition = resumable[0] if resumable else next(
            candidate for candidate in range(1, PROTOCOL['cold_attempt_cap'] + 1)
            if candidate not in attempted_repetitions
        )
        cold_key = f'cold:canonical:{repetition}'
        cold = next((receipt for receipt in receipts if identity(receipt) == cold_key), None)
        if cold is None:
            workflow = create_workflow(api_key, repetition)
            cold = record_cell(api_key, workflow, 'cold', 'canonical', repetition, output)
            receipts.append(cold)
            identities.add(cold_key)
            attempted_repetitions.add(repetition)
        if not (cold['harness_success'] and cold['exact_live_verification'] and cold['artifact_after']):
            continue

        cells = [('warm', 'canonical'), *[('drift', mutation) for mutation in PROTOCOL['mutations']]]
        stopped = False
        for phase, mutation in cells:
            key = f'{phase}:{mutation}:{repetition}'
            if key in identities:
                continue
            receipt = record_cell(api_key, cold['workflow'], phase, mutation, repetition, output)
            receipts.append(receipt)
            identities.add(key)
            if receipt['harness_success'] and not receipt['exact_live_verification']:
                print(f'{key} STOP: harness success failed independent exact verification', flush=True)
                stopped = True
                break
        completed_pairs = complete_repetitions(receipts)
        if stopped:
            break
    print(f'qualification collection complete: {len(attempted_repetitions)} cold attempts, {len(completed_pairs)} complete pairs', flush=True)


def create_workflow(api_key: str, repetition: int) -> dict:
    parameters = [
        {'parameter_type': 'workflow', 'key': key, 'workflow_parameter_type': 'string'}
        for key in FIELDS
    ]
    verify = PROTOCOL['verify_text']
    for key in FIELDS:
        verify = verify.replace(PROTOCOL['parameters'][key], '{{' + key + '}}')
    options = PROTOCOL['workflow_options']
    definition = {
        'title': f"Rote B2 Skyvern qualification r{repetition:02d}",
        'run_with': options['run_with'],
        'ai_fallback': options['ai_fallback'],
        'adaptive_caching': options['adaptive_caching'],
        'enable_self_healing': options['enable_self_healing'],
        'code_version': options['code_version'],
        'generate_script_on_terminal': options['generate_script_on_terminal'],
        'workflow_definition': {
            'version': 2,
            'parameters': parameters,
            'blocks': [{
                'block_type': 'task',
                'label': 'register_vendor',
                'url': PROTOCOL['initial_url'],
                'navigation_goal': PROTOCOL['task_prompt'],
                'parameter_keys': list(FIELDS),
                'max_steps_per_run': options['max_steps'],
                'complete_criterion': f'The page visibly contains this exact completed registration summary: {verify}',
                'complete_verification': True,
            }],
        },
    }
    return api(api_key, '/v1/agents', {'json_definition': definition})


def record_cell(api_key: str, workflow: dict, phase: str, mutation: str, repetition: int, output: Path) -> dict:
    receipt = execute_cell(api_key, workflow, phase, mutation, repetition, output)
    append_receipt(output, receipt)
    pending_path().unlink(missing_ok=True)
    return receipt


def execute_cell(api_key: str, workflow: dict, phase: str, mutation: str, repetition: int, output: Path) -> dict:
    reset_fixture(mutation)
    workflow_id = workflow['workflow_permanent_id']
    artifact_before = get_artifact(api_key, workflow_id)
    started = time.time()
    pending = {
        'workflow': workflow, 'phase': phase, 'mutation': mutation, 'repetition': repetition,
        'run_id': None, 'started': started, 'artifact_before': artifact_before,
    }
    # INVARIANT: persist launch intent before the external mutation so an interruption can never silently rerun a cell.
    atomic_json(pending_path(), pending)
    response = api(api_key, '/v1/run/agents', {
        'agent_id': workflow_id,
        'parameters': PROTOCOL['parameters'],
        'run_with': 'code',
        'ai_fallback': True,
    })
    run_id = response['run_id']
    atomic_json(pending_path(), {**pending, 'run_id': run_id})
    result = poll_run(api_key, run_id)
    return finalize_cell(api_key, workflow, phase, mutation, repetition, output, run_id, started, artifact_before, result)


def recover_pending_cell(api_key: str, output: Path) -> None:
    path = pending_path()
    if not path.exists():
        return
    pending = json.loads(path.read_text())
    if pending.get('run_id') is None:
        raise RuntimeError('a persisted launch intent has no Skyvern run ID; inspect upstream runs before clearing state/pending-cell.json')
    existing = {identity(receipt) for receipt in read_receipts(output)}
    key = f"{pending['phase']}:{pending['mutation']}:{pending['repetition']}"
    if key in existing:
        path.unlink()
        return
    result = poll_run(api_key, pending['run_id'])
    receipt = finalize_cell(
        api_key, pending['workflow'], pending['phase'], pending['mutation'], pending['repetition'],
        output, pending['run_id'], pending['started'], pending['artifact_before'], result,
    )
    append_receipt(output, receipt)
    path.unlink()
    print(f'recovered interrupted {key} without rerunning it', flush=True)


def finalize_cell(
    api_key: str, workflow: dict, phase: str, mutation: str, repetition: int, output: Path,
    run_id: str, started: float, artifact_before: dict | None, result: dict,
) -> dict:
    key = f'{phase}:{mutation}:{repetition}'
    duration_ms = max(0, (time.time() - started) * 1000)
    artifact_after = wait_for_artifact(api_key, workflow['workflow_permanent_id'], required=phase == 'cold')
    audit = read_audit()
    exact = exact_audit(audit)
    destructive = [event for event in audit if event.get('kind') == 'destructive_dispatch']
    logs = logs_for_run(run_id)
    calls = parse_llm_calls(logs)
    usage = sum_usage(calls)
    regeneration_usage = sum_usage([call for call in calls if call['prompt_name'] == 'script-reviewer'])
    runtime_usage = subtract_usage(usage, regeneration_usage)
    script_run = result.get('script_run') or {}
    harness_success = result.get('status') == 'completed'
    if harness_success and not exact:
        outcome = 'silent_failure'
    elif not harness_success:
        outcome = 'failure'
    elif phase == 'cold':
        outcome = 'cold_success'
    elif script_run.get('ai_fallback_triggered'):
        outcome = 'ai_fallback_success'
    elif sum(usage.values()) > 0:
        outcome = 'model_assisted_replay_success'
    else:
        outcome = 'code_replay_success'
    raw_dir = output.parent / 'raw' / f'r{repetition:02d}' / f'{phase}-{mutation}'
    raw_dir.mkdir(parents=True, exist_ok=True)
    atomic_json(raw_dir / 'run.json', result)
    atomic_json(raw_dir / 'audit.json', audit)
    atomic_json(raw_dir / 'artifact-before.json', artifact_before)
    atomic_json(raw_dir / 'artifact-after.json', artifact_after)
    atomic_write(raw_dir / 'skyvern.log', '\n'.join(logs) + ('\n' if logs else ''))
    receipt = {
        'schema_version': 1,
        'protocol_id': PROTOCOL['protocol_id'],
        'harness': 'skyvern',
        'harness_version': PROTOCOL['harness_version'],
        'source_commit': PROTOCOL['source_commit'],
        'image_index_digest': PROTOCOL['image_index_digest'],
        'provider': PROTOCOL['provider'],
        'model': PROTOCOL['model'],
        'viewport': PROTOCOL['viewport'],
        'task': PROTOCOL['task_id'],
        'phase': phase,
        'mutation': mutation,
        'repetition': repetition,
        'initial_url': PROTOCOL['initial_url'],
        'verify_text': PROTOCOL['verify_text'],
        'workflow': workflow,
        'run_id': run_id,
        'status': result.get('status'),
        'harness_success': harness_success,
        'exact_live_verification': exact,
        'outcome': outcome,
        'ai_fallback_triggered': bool(script_run.get('ai_fallback_triggered')),
        'script_id_used': result.get('script_id') or script_run.get('script_id'),
        'script_revision_id_used': script_run.get('script_revision_id'),
        'artifact_before': artifact_identity(artifact_before),
        'artifact_after': artifact_identity(artifact_after),
        'artifact_changed': artifact_identity(artifact_before) != artifact_identity(artifact_after),
        'usage': usage,
        'runtime_usage': runtime_usage,
        'regeneration_usage': regeneration_usage,
        'llm_call_aggregates': calls,
        'raw_provider_receipts': [],
        'provider_receipts_complete': False,
        'duration_ms': duration_ms,
        'destructive_dispatches': destructive,
        'independent_audit': audit,
        'failure_reason': result.get('failure_reason'),
        'raw_directory': str(raw_dir.relative_to(ROOT)),
    }
    print(f"{key} {outcome} exact={exact} fallback={receipt['ai_fallback_triggered']} tokens={sum(usage.values())} artifact_changed={receipt['artifact_changed']}", flush=True)
    return receipt


def pending_path() -> Path:
    return HERE / 'state' / 'pending-cell.json'


def api(api_key: str, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        'http://127.0.0.1:8000' + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'x-api-key': api_key, 'content-type': 'application/json'},
        method='GET' if body is None else 'POST',
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)


def poll_run(api_key: str, run_id: str) -> dict:
    for _ in range(360):
        result = api(api_key, '/v1/runs/' + run_id)
        if result.get('status') in TERMINAL:
            return result
        time.sleep(2)
    raise TimeoutError(f'{run_id} did not finish within 12 minutes')


def get_artifact(api_key: str, workflow_id: str) -> dict | None:
    listing = api(api_key, '/v1/scripts/workflows/' + workflow_id)
    scripts = listing.get('scripts', [])
    if not scripts:
        return None
    script = sorted(scripts, key=lambda value: value['created_at'])[-1]
    version = script['latest_version']
    code = api(api_key, f"/v1/scripts/{script['script_id']}/versions/{version}")
    canonical = json.dumps(code, sort_keys=True, separators=(',', ':')).encode()
    return {'metadata': script, 'code': code, 'sha256': hashlib.sha256(canonical).hexdigest()}


def wait_for_artifact(api_key: str, workflow_id: str, required: bool) -> dict | None:
    deadline = time.time() + (180 if required else 50)
    previous = None
    stable_since = None
    while time.time() < deadline:
        current = get_artifact(api_key, workflow_id)
        identity_value = artifact_identity(current)
        if current is not None and identity_value == previous:
            stable_since = stable_since or time.time()
            if time.time() - stable_since >= 15:
                return current
        else:
            previous = identity_value
            stable_since = time.time() if current is not None else None
        time.sleep(5)
    if required:
        raise TimeoutError(f'generated artifact did not appear for {workflow_id}')
    return get_artifact(api_key, workflow_id)


def artifact_identity(artifact: dict | None) -> dict | None:
    if artifact is None:
        return None
    metadata = artifact['metadata']
    return {
        'script_id': metadata['script_id'],
        'version': metadata['latest_version'],
        'sha256': artifact['sha256'],
        'cache_key_value': metadata['cache_key_value'],
    }


def reset_fixture(mutation: str) -> None:
    fixture = HERE / 'state' / 'fixture'
    fixture.mkdir(parents=True, exist_ok=True)
    for path in (fixture / 'audit.json', fixture / 'audit.tmp'):
        path.unlink(missing_ok=True)
    (fixture / 'mutation').write_text('' if mutation == 'canonical' else mutation)


def read_audit() -> list[dict]:
    path = HERE / 'state' / 'fixture' / 'audit.json'
    for _ in range(20):
        if path.exists():
            try:
                return json.loads(path.read_text())
            except json.JSONDecodeError:
                pass
        time.sleep(0.25)
    return []


def exact_audit(events: list[dict]) -> bool:
    expected = PROTOCOL['parameters']
    return any(event.get('kind') == 'submission' and event.get('values') == expected for event in events)


def logs_for_run(run_id: str) -> list[str]:
    result = compose('logs', 'skyvern', '--no-color', capture=True)
    lines = []
    for raw in result.stdout.splitlines():
        clean = ANSI.sub('', raw)
        if run_id in clean:
            clean = re.sub(r'sk-[A-Za-z0-9_-]{10,}', '[REDACTED]', clean)
            lines.append(clean)
    return lines


def parse_llm_calls(lines: list[str]) -> list[dict]:
    calls = []
    for line in lines:
        if 'LLM API handler duration metrics' not in line:
            continue
        def value(name: str) -> str | None:
            match = re.search(rf'\b{name}=([^ ]+)', line)
            return match.group(1) if match else None
        def integer(name: str) -> int:
            raw = value(name)
            return 0 if raw in (None, 'None') else int(raw)
        calls.append({
            'prompt_name': value('prompt_name') or 'unknown',
            'input_tokens': integer('input_tokens'),
            'cache_read_tokens': integer('cached_tokens'),
            'cache_write_tokens': 0,
            'output_tokens': integer('output_tokens'),
        })
    return calls


def sum_usage(calls: list[dict]) -> dict:
    total = {'input_tokens': 0, 'cache_read_tokens': 0, 'cache_write_tokens': 0, 'output_tokens': 0}
    for call in calls:
        cached = min(call['cache_read_tokens'], call['input_tokens'])
        total['input_tokens'] += call['input_tokens'] - cached
        total['cache_read_tokens'] += cached
        total['output_tokens'] += call['output_tokens']
    return total


def subtract_usage(total: dict, removed: dict) -> dict:
    return {key: total[key] - removed[key] for key in total}


def start_fixture_server() -> None:
    container = compose('ps', '-q', 'skyvern', capture=True).stdout.strip()
    subprocess.run(['docker', 'exec', container, 'pkill', '-f', '/benchmark/fixture-server.py'], check=False)
    subprocess.run(['docker', 'exec', '-d', container, 'python', '/benchmark/fixture-server.py'], check=True)
    time.sleep(1)


def wait_for_service() -> None:
    for _ in range(90):
        try:
            urllib.request.urlopen('http://127.0.0.1:8000/api/v1/heartbeat', timeout=3)
            return
        except (OSError, urllib.error.URLError, TimeoutError):
            time.sleep(3)
    raise TimeoutError('Skyvern did not become healthy')


def read_api_key() -> str:
    path = HERE / 'state' / 'credentials' / 'credentials.toml'
    for _ in range(30):
        if path.exists():
            config = tomllib.loads(path.read_text())
            return config['skyvern']['configs'][0]['orgs'][0]['cred']
        time.sleep(1)
    raise FileNotFoundError(path)


def compose(*arguments: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        ['docker', 'compose', '-f', str(HERE / 'compose.yaml'), '--project-directory', str(HERE), *arguments],
        check=check,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )


def read_receipts(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def append_receipt(path: Path, receipt: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(descriptor, (json.dumps(receipt, sort_keys=True) + '\n').encode())
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def identity(receipt: dict) -> str:
    return f"{receipt['phase']}:{receipt['mutation']}:{receipt['repetition']}"


def complete_repetitions(receipts: list[dict]) -> set[int]:
    return paired_repetitions(receipts, require_exact=True)


def paired_repetitions(receipts: list[dict], require_exact: bool) -> set[int]:
    cells = {('warm', 'canonical'), *[('drift', mutation) for mutation in PROTOCOL['mutations']]}
    complete = set()
    for repetition in {receipt['repetition'] for receipt in receipts}:
        cold = any(receipt['repetition'] == repetition and receipt['phase'] == 'cold' and receipt['harness_success'] and receipt['exact_live_verification'] for receipt in receipts)
        eligible = [receipt for receipt in receipts if receipt['repetition'] == repetition and (not require_exact or (receipt['harness_success'] and receipt['exact_live_verification']))]
        observed = {(receipt['phase'], receipt['mutation']) for receipt in eligible}
        if cold and cells <= observed:
            complete.add(repetition)
    return complete


def atomic_json(path: Path, value) -> None:
    atomic_write(path, json.dumps(value, indent=2, sort_keys=True) + '\n')


def atomic_write(path: Path, text: str) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(text)
    temporary.replace(path)


if __name__ == '__main__':
    main()
