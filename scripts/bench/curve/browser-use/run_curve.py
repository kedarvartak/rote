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
from typing import Any

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
    task = f"{prompt}\nStart at {protocol['page']['initial_url']}"
    # The independent database command is the symmetric verifier. Browser Use's
    # optional LLM judge is disabled so neither harness pays an extra subjective
    # grading call, while all task-planning provider calls remain measured.
    agent = Agent(
        task=task,
        llm=build_llm(protocol["provider"], protocol["model"]),
        sensitive_data=bindings,
        browser_profile=BrowserProfile(
            allowed_domains=["127.0.0.1"],
            window_size=protocol["page"]["viewport"],
            viewport=protocol["page"]["viewport"],
        ),
        use_judge=False,
        final_response_after_failure=False,
    )
    history = await agent.run(max_steps=checkpoint["target_steps"] + max_extra_steps)

    verify_command = protocol["page"]["verify_command_template"].replace(
        "{{expected_post_titles_json}}",
        shlex.quote(json.dumps(checkpoint["post_titles"], separators=(",", ":"))),
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


async def main() -> None:
    protocol = json.loads(PROTOCOL_PATH.read_text())
    parser = argparse.ArgumentParser(description="Capture Browser Use provider usage for the P1 G1 curve")
    parser.add_argument("--out", type=Path, required=True, help="output directory")
    parser.add_argument("--checkpoint", action="append", help="limit to a checkpoint id; repeatable")
    parser.add_argument("--repetitions", type=int, help="override repetitions for a probe run")
    parser.add_argument("--max-extra-steps", type=int, default=5, help="retry allowance above target interaction complexity")
    args = parser.parse_args()

    if args.repetitions is not None and args.repetitions < 1:
        raise SystemExit("--repetitions must be positive")
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
    raw_path.write_text("")
    repetitions = args.repetitions or protocol["repetitions_per_harness"]

    with raw_path.open("a") as raw_file:
        for checkpoint in checkpoints:
            for repetition in range(1, repetitions + 1):
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
