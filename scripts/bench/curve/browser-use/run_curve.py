"""Run Browser Use over the frozen P1 G1 WordPress curve protocol.

The runner records Browser Use's own TokenCost usage entries, one raw JSONL row
per provider call. It then invokes @rote/bench's reviewed normalization adapter
to produce the shared curve JSONL. Raw receipts remain alongside normalized rows.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shlex
import subprocess
from importlib import metadata
from pathlib import Path
from typing import Any, Iterable

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PROTOCOL_PATH = HERE.parent / "protocol.json"
WORDPRESS_ENV_PATH = HERE.parent / "wordpress" / ".env"
BENCH_CLI = ROOT / "packages" / "bench" / "bin" / "rote-bench.js"


def browser_use_version() -> str:
    """Returns the installed dependency version or fails before a paid run."""
    try:
        return metadata.version("browser-use")
    except metadata.PackageNotFoundError as error:
        raise SystemExit("browser-use is not installed; pip install -r requirements.txt") from error


def read_env(path: Path) -> dict[str, str]:
    """Reads the generated WordPress env file without exporting credentials."""
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator:
            raise RuntimeError(f"malformed env line in {path}: {line!r}")
        values[key] = value
    return values


def render_prompt(template: str, bindings: dict[str, str]) -> str:
    """Replaces declared bindings with Browser Use secret placeholders."""
    rendered = template
    for key in bindings:
        rendered = rendered.replace("{{" + key + "}}", f"<secret>{key}</secret>")
    if "{{" in rendered or "}}" in rendered:
        raise RuntimeError("protocol prompt contains an unbound placeholder")
    return rendered


def run_protocol_command(command: str) -> subprocess.CompletedProcess[str]:
    """Runs a frozen protocol command from the repository root."""
    return subprocess.run(command, cwd=ROOT, shell=True, check=False, text=True, capture_output=True)


def initial_navigation(protocol: dict[str, Any]) -> list[dict[str, dict[str, Any]]]:
    """Returns the unmeasured initial action matching Rote's pre-planning navigation."""
    return [{"navigate": {"url": protocol["page"]["initial_url"], "new_tab": False}}]


def action_kind(history_item: Any) -> str | None:
    """Returns the ordered Browser Use action names for one agent step."""
    output = getattr(history_item, "model_output", None)
    actions = getattr(output, "action", None) if output is not None else None
    if not actions:
        return None
    names: list[str] = []
    for action in actions:
        dumped = action.model_dump(exclude_none=True) if hasattr(action, "model_dump") else {}
        names.extend(str(key) for key in dumped)
    return "+".join(names) or None


def history_step_for_timestamp(history: Any, timestamp: float) -> tuple[int, float, str | None]:
    """Maps a provider receipt to its enclosing Browser Use agent step.

    Browser Use 0.13.4 timestamps both token receipts and step metadata with wall
    clock time. An unmapped receipt is a hard error: silently dropping an internal
    provider call would understate the competitor's cumulative curve.
    """
    for item in history.history:
        step = getattr(item, "metadata", None)
        if step is not None and step.step_start_time <= timestamp <= step.step_end_time:
            return int(step.step_number), float(step.duration_seconds * 1000), action_kind(item)
    raise RuntimeError(f"provider receipt at {timestamp} does not belong to a recorded Browser Use step")


def build_llm(provider: str, model: str) -> Any:
    """Constructs the protocol-pinned provider client lazily."""
    env_key = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}.get(provider)
    if env_key is None:
        raise RuntimeError(f"unsupported curve provider: {provider!r}")
    if not os.environ.get(env_key):
        raise RuntimeError(f"{env_key} is unset; refusing to start an unmeasurable run")
    if provider == "anthropic":
        try:
            from browser_use import ChatAnthropic
        except ImportError:  # pragma: no cover - compatibility layout
            from browser_use.llm import ChatAnthropic
        return ChatAnthropic(model=model)
    try:
        from browser_use import ChatOpenAI
    except ImportError:  # pragma: no cover - compatibility layout
        from browser_use.llm import ChatOpenAI
    return ChatOpenAI(model=model)


def exact_set_guard_script(expected_titles: list[str]) -> str:
    """Builds the browser-side guard shared with Rote's pre-Apply invariant."""
    expected = json.dumps(expected_titles, separators=(",", ":"))
    return f"""
(() => {{
  if (window.__roteExactSetGuardInstalled) return;
  window.__roteExactSetGuardInstalled = true;
  const expected = {expected};
  document.addEventListener('click', (event) => {{
    const target = event.target;
    if (!(target instanceof Element) || !['doaction', 'doaction2'].includes(target.id)) return;
    const selected = [...document.querySelectorAll('#the-list input[name="post[]"]:checked')]
      .map((checkbox) => checkbox.closest('tr')?.querySelector('.row-title')?.textContent?.trim())
      .filter(Boolean);
    const missing = expected.filter((title) => !selected.includes(title));
    const extra = selected.filter((title) => !expected.includes(title));
    if (missing.length === 0 && extra.length === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    let notice = document.querySelector('#rote-exact-set-guard');
    if (!notice) {{
      notice = document.createElement('div');
      notice.id = 'rote-exact-set-guard';
      notice.setAttribute('role', 'alert');
      document.body.prepend(notice);
    }}
    notice.textContent = `Bulk Apply blocked: selected titles must exactly match the request. Missing: ${{missing.join(', ') || '(none)'}}. Extra: ${{extra.join(', ') || '(none)'}}.`;
  }}, true);
}})()
"""


async def install_exact_set_guard(agent: Any, expected_titles: list[str]) -> None:
    """Installs Browser Use's symmetric pre-Apply exact-selection guard."""
    session = await agent.browser_session.get_or_create_cdp_session()
    await session.cdp_client.send.Runtime.evaluate(
        params={"expression": exact_set_guard_script(expected_titles)}, session_id=session.session_id
    )


async def run_once(
    checkpoint: dict[str, Any],
    protocol: dict[str, Any],
    repetition: int,
    max_extra_steps: int,
) -> list[dict[str, Any]]:
    """Runs one reset/agent/verification cell and returns every provider receipt."""
    from browser_use import Agent, BrowserProfile

    reset = run_protocol_command(protocol["page"]["reset_command"])
    if reset.returncode != 0:
        raise RuntimeError(f"WordPress reset failed: {reset.stderr.strip()}")

    env = read_env(WORDPRESS_ENV_PATH)
    bindings = {
        "wp_admin_user": env["ROTE_CURVE_WP_ADMIN_USER"],
        "wp_admin_password": env["ROTE_CURVE_WP_ADMIN_PASSWORD"],
    }
    prompt = render_prompt(checkpoint["prompt_template"], bindings)
    task = prompt
    # The independent database command is the symmetric verifier. Browser Use's
    # optional LLM judge is disabled so neither harness pays an extra subjective
    # grading call, while all task-planning provider calls remain measured.
    agent = Agent(
        task=task,
        llm=build_llm(protocol["provider"], protocol["model"]),
        sensitive_data=bindings,
        initial_actions=initial_navigation(protocol),
        browser_profile=BrowserProfile(
            allowed_domains=["127.0.0.1"],
            window_size=protocol["page"]["viewport"],
            viewport=protocol["page"]["viewport"],
        ),
        use_judge=False,
        final_response_after_failure=False,
    )

    async def before_step(current_agent: Any) -> None:
        if checkpoint["operation_mode"] == "single_bulk":
            await install_exact_set_guard(current_agent, checkpoint["post_titles"])

    history = await agent.run(
        max_steps=checkpoint["target_steps"] + max_extra_steps,
        on_step_start=before_step,
    )

    expected_items = checkpoint["tag_names"] if checkpoint["operation_mode"] == "create_tag_each" else checkpoint["post_titles"]
    expected_json = shlex.quote(json.dumps(expected_items, separators=(",", ":")))
    verify_command = protocol["page"]["verify_command_template"].replace(
        "{{expected_post_titles_json}}", expected_json
    ).replace(
        "{{expected_tag_names_json}}", expected_json
    )
    verified = run_protocol_command(verify_command).returncode == 0
    concluded = history.is_successful()
    succeeded = concluded is True and verified

    usage_history = getattr(agent.token_cost_service, "usage_history", None)
    if not usage_history:
        raise RuntimeError("Browser Use exposed no per-call provider usage; refusing to record zero")

    run_id = f"browser-use-{checkpoint['id']}-r{repetition:02d}"
    rows: list[dict[str, Any]] = []
    for index, entry in enumerate(usage_history, start=1):
        if entry.model != protocol["model"]:
            raise RuntimeError(
                f"provider receipt {index} used {entry.model!r}, not pinned model {protocol['model']!r}"
            )
        step_index, duration_ms, kind = history_step_for_timestamp(history, entry.timestamp.timestamp())
        usage = entry.usage.model_dump(mode="json")
        if usage.get("prompt_tokens") is None or usage.get("completion_tokens") is None:
            raise RuntimeError(f"provider receipt {index} has no token counts")
        final = index == len(usage_history)
        rows.append(
            {
                "schema_version": 1,
                "protocol_id": protocol["protocol_id"],
                "task_id": checkpoint["id"],
                "browser_use_version": browser_use_version(),
                "provider": protocol["provider"],
                "model": protocol["model"],
                "run_id": run_id,
                "repetition": repetition,
                "target_steps": checkpoint["target_steps"],
                "call_index": index,
                "agent_step_index": step_index,
                "agent_step_duration_ms": duration_ms,
                "provider_usage": usage,
                **({"action_kind": kind} if kind else {}),
                "step_outcome": ("success" if succeeded else "failure") if final else "continued",
                **({"verification_passed": verified, "agent_concluded": concluded} if final else {}),
            }
        )
    return rows


def completed_run_ids(raw_path: Path, protocol: dict[str, Any], resume: bool) -> set[str]:
    """Validates prior raw receipts and returns atomically completed run ids."""
    if not raw_path.exists() or raw_path.stat().st_size == 0:
        return set()
    if not resume:
        raise RuntimeError(f"refusing to overwrite non-empty curve artifact {raw_path}; pass --resume")
    checkpoints = {checkpoint["id"]: checkpoint for checkpoint in protocol["checkpoints"]}
    rows_by_run: dict[str, list[dict[str, Any]]] = {}
    for line_number, line in enumerate(raw_path.read_text().splitlines(), start=1):
        if not line.strip():
            raise RuntimeError(f"raw curve line {line_number} is blank")
        try:
            row = json.loads(line)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"raw curve line {line_number} is invalid JSON") from error
        run_id = row.get("run_id")
        checkpoint = checkpoints.get(row.get("task_id"))
        repetition = row.get("repetition")
        if checkpoint is None or not isinstance(repetition, int) or repetition < 1:
            raise RuntimeError(f"raw curve line {line_number} has unknown task or repetition")
        expected_run_id = f"browser-use-{checkpoint['id']}-r{repetition:02d}"
        if run_id != expected_run_id:
            raise RuntimeError(f"raw curve line {line_number} has unexpected run id {run_id!r}")
        for field in ("protocol_id", "provider", "model"):
            if row.get(field) != protocol[field]:
                raise RuntimeError(f"raw curve line {line_number} mismatches protocol field {field}")
        rows_by_run.setdefault(run_id, []).append(row)

    completed: set[str] = set()
    for run_id, rows in rows_by_run.items():
        for index, row in enumerate(rows, start=1):
            if row.get("call_index") != index:
                raise RuntimeError(f"raw curve run {run_id} expected call {index}")
            expected_outcome = "continued" if index < len(rows) else row.get("step_outcome")
            if index < len(rows) and row.get("step_outcome") != expected_outcome:
                raise RuntimeError(f"raw curve run {run_id} has an early terminal outcome")
        final = rows[-1]
        if final.get("step_outcome") not in ("success", "failure"):
            raise RuntimeError(f"raw curve run {run_id} is incomplete; refusing ambiguous resume")
        if not isinstance(final.get("verification_passed"), bool):
            raise RuntimeError(f"raw curve run {run_id} has no final verification result")
        completed.add(run_id)
    return completed


def pending_runs(
    checkpoints: Iterable[dict[str, Any]], repetitions: Iterable[int], completed: set[str], max_new_runs: int | None
) -> list[tuple[dict[str, Any], int]]:
    """Plans the next ordered Browser Use runs without repeating completed side effects."""
    pending = [
        (checkpoint, repetition)
        for checkpoint in checkpoints
        for repetition in repetitions
        if f"browser-use-{checkpoint['id']}-r{repetition:02d}" not in completed
    ]
    return pending if max_new_runs is None else pending[:max_new_runs]


async def main() -> None:
    protocol = json.loads(PROTOCOL_PATH.read_text())
    parser = argparse.ArgumentParser(description="Capture Browser Use provider usage for the P1 G1 curve")
    parser.add_argument("--out", type=Path, required=True, help="output directory")
    parser.add_argument("--checkpoint", action="append", help="limit to a checkpoint id; repeatable")
    parser.add_argument("--repetitions", type=int, help="override the target repetition count")
    parser.add_argument("--repetition", type=int, help="run only this repetition (permits paired one-run collection)")
    parser.add_argument("--resume", action="store_true", help="validate and append to an existing raw artifact")
    parser.add_argument("--max-new-runs", type=int, help="stop after this many new atomic browser sessions")
    parser.add_argument("--max-extra-steps", type=int, default=10, help="retry allowance above target interaction complexity")
    args = parser.parse_args()

    if args.repetitions is not None and args.repetitions < 1:
        raise SystemExit("--repetitions must be positive")
    if args.repetitions is not None and args.repetition is not None:
        raise SystemExit("--repetition and --repetitions are mutually exclusive")
    if args.repetition is not None and args.repetition < 1:
        raise SystemExit("--repetition must be positive")
    if args.max_new_runs is not None and args.max_new_runs < 1:
        raise SystemExit("--max-new-runs must be positive")
    if args.max_extra_steps < 0:
        raise SystemExit("--max-extra-steps cannot be negative")

    checkpoints = [
        checkpoint for checkpoint in protocol["checkpoints"]
        if not args.checkpoint or checkpoint["id"] in args.checkpoint
    ]
    if not checkpoints:
        raise SystemExit("no protocol checkpoints selected")

    args.out.mkdir(parents=True, exist_ok=True)
    raw_path = args.out / "browser-use-raw-calls.jsonl"
    records_path = args.out / "browser-use-curve.jsonl"
    completed = completed_run_ids(raw_path, protocol, args.resume)
    repetitions = [args.repetition] if args.repetition is not None else range(1, (args.repetitions or protocol["repetitions_per_harness"]) + 1)
    plan = pending_runs(checkpoints, repetitions, completed, args.max_new_runs)
    raw_path.touch(exist_ok=True)

    with raw_path.open("a") as raw_file:
        for checkpoint, repetition in plan:
            rows = await run_once(checkpoint, protocol, repetition, args.max_extra_steps)
            for row in rows:
                raw_file.write(json.dumps(row, separators=(",", ":")) + "\n")
            raw_file.flush()
            os.fsync(raw_file.fileno())
            print(f"{checkpoint['id']} repetition {repetition}: {len(rows)} provider calls, {rows[-1]['step_outcome']}")

    subprocess.run(
        ["node", str(BENCH_CLI), "curve-browser-use-records", str(raw_path), "--out", str(records_path)],
        cwd=ROOT,
        check=True,
    )
    print(f"browser-use {browser_use_version()}; raw receipts: {raw_path}; normalized records: {records_path}")


if __name__ == "__main__":
    asyncio.run(main())
