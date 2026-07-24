"""Browser Use competitor runner for the Rote head-to-head launch gate.

Browser Use is a Python library, so it runs out-of-process and hands its results
to Rote as a sidecar of raw per-run rows (docs/03 "publish adapters + configs +
raw data"; the adapter imports the competitor as a dependency, never a fork).
This script drives Browser Use over the *same* frozen fixture tasks, from the
same `tasks.json` the Rote plan is written against, and writes:

  raw-runs.json   rows in the `CompetitorRawRun[]` shape that
                  `rote-bench competitor-records` maps into neutral records
  raw/<id>.json   per-run dump (usage, urls, errors, final result) kept for the
                  reproduction pack

It deliberately does *not* write the neutral records itself: the mapping and its
fairness provenance live in-repo, reviewable, in `headhead-assembler.ts`.

Usage:
    pip install -r requirements.txt
    node ../serve-fixtures.mjs 8080 &
    set -a; source ../../../../.env; set +a     # provider + API key
    python run_browser_use.py --out ./out       # --model defaults to tasks.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from dataclasses import asdict, dataclass
from importlib import metadata
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
TASKS_PATH = HERE.parent / "tasks.json"


@dataclass
class RawRun:
    """One Browser Use run in the `CompetitorRawRun` shape (headhead-assembler.ts)."""

    task: str
    outcome: str
    input_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    output_tokens: int
    duration_ms: int
    repetition: int
    phase: str = "cold"


def browser_use_version() -> str:
    try:
        return metadata.version("browser-use")
    except metadata.PackageNotFoundError as error:  # pragma: no cover - env problem
        raise SystemExit("browser-use is not installed; pip install -r requirements.txt") from error


def usage_from_agent(agent: Any, provider: str) -> tuple[int, int, int, int]:
    """Sums provider receipts into uncached/read/write/output buckets."""
    entries = getattr(agent.token_cost_service, "usage_history", None)
    if not entries:
        raise RuntimeError("Browser Use exposed no provider receipts; refusing to record zero usage")
    uncached = cache_read = cache_write = output = 0
    for index, entry in enumerate(entries, start=1):
        usage = entry.usage.model_dump(mode="json")
        prompt = usage.get("prompt_tokens")
        completion = usage.get("completion_tokens")
        if prompt is None or completion is None:
            raise RuntimeError(f"provider receipt {index} has no prompt/completion token counts")
        read = usage.get("prompt_cached_tokens") or 0
        one_hour_write = usage.get("prompt_cache_creation_1h_tokens") or 0
        if one_hour_write:
            raise RuntimeError(
                f"provider receipt {index} used 1-hour cache writes, which the neutral 5-minute price bucket cannot represent"
            )
        generic_write = usage.get("prompt_cache_creation_tokens") or 0
        five_minute_write = usage.get("prompt_cache_creation_5m_tokens") or 0
        if generic_write and five_minute_write:
            raise RuntimeError(f"provider receipt {index} reports overlapping cache-write buckets")
        write = generic_write or five_minute_write
        if provider == "openai":
            remainder = prompt - read - write
        elif provider == "anthropic":
            remainder = prompt
        else:  # pragma: no cover - argparse rejects this
            raise RuntimeError(f"unsupported provider {provider}")
        if remainder < 0:
            raise RuntimeError(f"provider receipt {index} cache buckets exceed prompt tokens")
        uncached += int(remainder)
        cache_read += int(read)
        cache_write += int(write)
        output += int(completion)
    return uncached, cache_read, cache_write, output


async def final_page_text(agent: Any) -> str | None:
    """Reads the live same-tab body text through Browser Use's public CDP session."""
    try:
        session = await agent.browser_session.get_or_create_cdp_session()
        result = await session.cdp_client.send.Runtime.evaluate(
            params={"expression": "document.body?.innerText ?? ''", "returnByValue": True},
            session_id=session.session_id,
        )
        value = result.get("result", {}).get("value")
        return value if isinstance(value, str) else None
    except Exception:  # noqa: BLE001 - classify_outcome fails loudly on None
        return None


def classify_outcome(history: Any, page_text: str | None, verify_text: str) -> str:
    """Grades one Browser Use run as success/failure/abandoned (Rote's OutcomeSchema).

    Browser Use is held to exactly the standard Rote holds itself to: a run counts
    as success only if the agent concluded it was done *and* the live page shows
    the same `verify_text` Rote's own run must see (`--verify-text`). Trusting the
    agent's self-report alone would grade the competitor more leniently than Rote,
    which would make the gate's success-parity check meaningless — and parity is
    the only thing stopping Rote from "winning" by being cheap and wrong.

    An agent that claims success the page does not corroborate is a failure, not a
    judgement call; that is the exact case Rote exists to prevent, and it would be
    dishonest to score it differently here than in our own executor. An agent that
    never concluded (`None`, e.g. it hit `max_steps`) is abandoned — which is what
    Rote's own agent loop yields in the same situation.
    """
    if page_text is None:
        # Cannot grade the run. Not "abandoned": every non-success outcome stays in
        # the success-rate denominator (competitor.ts summarizeHarnessRuns), so a
        # broken page probe — our bug, in our accessor — would silently convert into
        # the competitor losing success rate on every run. Fail on the first one
        # instead, while it is still cheap to fix (cf. usage_from_history).
        raise RuntimeError(
            "could not read the final page text, so this run cannot be verified the "
            "way Rote verifies its own runs. Fix final_page_text() for this "
            "browser-use version — do not grade an unverifiable run."
        )

    concluded_done = history.is_successful()
    if concluded_done is None:
        return "abandoned"
    return "success" if concluded_done and verify_text in page_text else "failure"


def build_llm(provider: str, model: str) -> Any:
    """Constructs the Browser Use chat client for `provider`.

    Both providers are supported because fairness requires the *same* model on
    both sides (docs/03), and which model that is depends on whose key the
    operator has — not on anything about Browser Use.
    """
    if provider == "anthropic":
        try:
            from browser_use import ChatAnthropic  # browser-use >= 0.13
        except ImportError:  # pragma: no cover - older layout
            from browser_use.llm import ChatAnthropic
        return ChatAnthropic(model=model)
    if provider == "openai":
        try:
            from browser_use import ChatOpenAI  # browser-use >= 0.13
        except ImportError:  # pragma: no cover - older layout
            from browser_use.llm import ChatOpenAI
        return ChatOpenAI(model=model)
    raise SystemExit(f'--provider must be "openai" or "anthropic", got {provider!r}')


async def run_once(task: dict[str, Any], repetition: int, args: argparse.Namespace) -> tuple[RawRun, dict[str, Any]]:
    # Imported lazily so `--help` works without the dependency installed.
    from browser_use import Agent, BrowserProfile

    url = f"http://127.0.0.1:{args.port}/{task['path']}"
    agent = Agent(
        task=task["prompt"],
        llm=build_llm(args.provider, args.model),
        initial_actions=[{"navigate": {"url": url, "new_tab": False}}],
        browser_profile=BrowserProfile(
            allowed_domains=["127.0.0.1"],
            window_size=args.viewport,
            viewport=args.viewport,
        ),
        use_judge=False,
        final_response_after_failure=False,
    )

    page_text: str | None = None

    async def capture_live_text(current_agent: Any) -> None:
        nonlocal page_text
        captured = await final_page_text(current_agent)
        if captured is not None:
            page_text = captured

    started = time.monotonic()
    history = await agent.run(max_steps=args.max_steps, on_step_end=capture_live_text)
    duration_ms = int((time.monotonic() - started) * 1000)

    input_tokens, cache_read_tokens, cache_write_tokens, output_tokens = usage_from_agent(agent, args.provider)
    outcome = classify_outcome(history, page_text, task["verify_text"])

    run = RawRun(
        task=task["id"],
        outcome=outcome,
        input_tokens=input_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
        output_tokens=output_tokens,
        duration_ms=duration_ms,
        repetition=repetition,
    )
    dump = {
        **asdict(run),
        "url": url,
        "browser_use_version": browser_use_version(),
        "provider": args.provider,
        "model": args.model,
        "is_successful": _call_safely(history, "is_successful"),
        "final_result": _call_safely(history, "final_result"),
        "urls": _call_safely(history, "urls"),
        "errors": _call_safely(history, "errors"),
        "provider_receipts": [
            {"model": entry.model, "usage": entry.usage.model_dump(mode="json")}
            for entry in agent.token_cost_service.usage_history
        ],
        "verify_text_visible": None if page_text is None else task["verify_text"] in page_text,
    }
    return run, dump


def _call_safely(history: Any, name: str) -> Any:
    method = getattr(history, name, None)
    if not callable(method):
        return None
    try:
        return json.loads(json.dumps(method(), default=str))
    except Exception:  # noqa: BLE001 - the dump is diagnostic, not load-bearing
        return None


async def main() -> None:
    tasks_config = json.loads(TASKS_PATH.read_text())
    parser = argparse.ArgumentParser(description="Run Browser Use over the Rote head-to-head fixture tasks")
    parser.add_argument("--out", type=Path, required=True, help="output directory for raw-runs.json and raw/")
    # Defaults to the model tasks.json pins for both harnesses, so the fair thing
    # is what happens when you pass nothing. Overriding it is possible but makes
    # the comparison unfair unless you change the Rote plan to match.
    parser.add_argument("--model", default=tasks_config["model"], help="model id; must match the Rote runs exactly")
    parser.add_argument(
        "--provider",
        default=os.environ.get("ROTE_LLM_PROVIDER", "openai"),
        choices=["anthropic", "openai"],
        help="which provider serves --model; reads ROTE_LLM_PROVIDER by default",
    )
    parser.add_argument("--port", type=int, default=tasks_config["fixture_port"], help="fixture server port")
    parser.add_argument("--repetitions", type=int, default=tasks_config["repetitions"], help="runs per task (gate needs >= 15 successes)")
    parser.add_argument("--repetition", type=int, help="run one exact 1-based repetition for paired collection")
    parser.add_argument("--resume", action="store_true", help="retain completed attempts and skip their task/repetition ids")
    parser.add_argument("--max-new-runs", type=int, help="maximum new atomic browser sessions")
    parser.add_argument("--max-steps", type=int, default=25, help="Browser Use step ceiling per run")
    parser.add_argument("--task", action="append", dest="only", help="limit to a task id; repeatable")
    args = parser.parse_args()
    args.viewport = tasks_config["viewport"]
    if args.repetition is not None and args.repetition < 1:
        raise SystemExit("--repetition must be positive")
    if args.max_new_runs is not None and args.max_new_runs < 1:
        raise SystemExit("--max-new-runs must be positive")

    tasks = [t for t in tasks_config["tasks"] if not args.only or t["id"] in args.only]
    raw_dir = args.out / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.out / "raw-runs.json"
    if out_path.exists() and not args.resume:
        raise SystemExit(f"{out_path} already exists; pass --resume or choose a new output")
    existing = json.loads(out_path.read_text()) if out_path.exists() else []
    runs = [RawRun(**row) for row in existing]
    completed = {(run.task, run.repetition) for run in runs}
    if len(completed) != len(runs):
        raise RuntimeError("raw-runs.json contains duplicate task/repetition attempts")
    # A crash may land the per-attempt dump just before the aggregate rename.
    # Recover that completed attempt instead of paying for and overwriting it.
    recovered = False
    for dump_path in sorted(raw_dir.glob("*.json")):
        dump = json.loads(dump_path.read_text())
        identity = (dump.get("task"), dump.get("repetition"))
        if identity in completed:
            continue
        row = RawRun(**{field: dump[field] for field in RawRun.__dataclass_fields__})
        runs.append(row)
        completed.add(identity)
        recovered = True
    if recovered:
        temporary = out_path.with_suffix(".tmp")
        temporary.write_text(json.dumps([asdict(item) for item in runs], indent=2) + "\n")
        temporary.replace(out_path)
    repetitions = [args.repetition] if args.repetition is not None else range(1, args.repetitions + 1)
    plan = [(task, repetition) for task in tasks for repetition in repetitions if (task["id"], repetition) not in completed]
    if args.max_new_runs is not None:
        plan = plan[:args.max_new_runs]

    for task, repetition in plan:
        run, dump = await run_once(task, repetition, args)
        # Each completed attempt is durable before another paid browser session starts.
        (raw_dir / f"{task['id'].lower()}-{repetition:02d}.json").write_text(json.dumps(dump, indent=2) + "\n")
        runs.append(run)
        temporary = out_path.with_suffix(".tmp")
        temporary.write_text(json.dumps([asdict(item) for item in runs], indent=2) + "\n")
        temporary.replace(out_path)
        logical = run.input_tokens + run.cache_read_tokens + run.cache_write_tokens
        print(f"{task['id']} rep {repetition}: {run.outcome} logical={logical} output={run.output_tokens} in {run.duration_ms}ms")

    print(f"\nwrote {out_path} ({len(runs)} runs, browser-use {browser_use_version()})")


if __name__ == "__main__":
    asyncio.run(main())
