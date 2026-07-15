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
    ANTHROPIC_API_KEY=... python run_browser_use.py --out ./out --model claude-opus-4-8
"""

from __future__ import annotations

import argparse
import asyncio
import json
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
    output_tokens: int
    duration_ms: int
    repetition: int
    phase: str = "cold"


def browser_use_version() -> str:
    try:
        return metadata.version("browser-use")
    except metadata.PackageNotFoundError as error:  # pragma: no cover - env problem
        raise SystemExit("browser-use is not installed; pip install -r requirements.txt") from error


def usage_from_history(history: Any) -> tuple[int, int]:
    """Reads prompt/completion tokens out of a Browser Use run history.

    Browser Use has moved this field across releases, so several shapes are
    accepted. An unreadable shape is a hard error, never a zero: a competitor
    silently recorded as spending 0 tokens would hand Rote a fabricated win, and
    the launch gate cannot tell a real 0 from a missing field (Rote invariant 1,
    "never silently wrong").
    """
    usage = getattr(history, "usage", None)
    if usage is not None:
        prompt = _first_attr(usage, ("total_prompt_tokens", "prompt_tokens", "total_input_tokens", "input_tokens"))
        completion = _first_attr(usage, ("total_completion_tokens", "completion_tokens", "total_output_tokens", "output_tokens"))
        if prompt is not None and completion is not None:
            return int(prompt), int(completion)

    prompt_fn = getattr(history, "total_input_tokens", None)
    completion_fn = getattr(history, "total_output_tokens", None)
    if callable(prompt_fn) and callable(completion_fn):
        return int(prompt_fn()), int(completion_fn())

    raise RuntimeError(
        "cannot read token usage from this browser-use version "
        f"({browser_use_version()}); history exposes: {sorted(dir(history))}. "
        "Teach usage_from_history() the new shape — do not default to 0."
    )


def _first_attr(target: Any, names: tuple[str, ...]) -> Any:
    for name in names:
        value = getattr(target, name, None)
        if value is not None:
            return value
    return None


async def final_page_text(agent: Any) -> str | None:
    """Best-effort read of the live page's visible text after the run.

    The fixture pages reveal their confirmation state via JS, so this must read
    the live DOM rather than re-fetching the URL. Returns None when this
    browser-use version does not expose the session the same way — which
    `classify_outcome` treats as a hard error rather than as a lost run.
    """
    session = getattr(agent, "browser_session", None) or getattr(agent, "browser", None)
    if session is None:
        return None
    try:
        page_getter = getattr(session, "get_current_page", None)
        page = await page_getter() if callable(page_getter) else None
        if page is None:
            return None
        return await page.inner_text("body")
    except Exception:  # noqa: BLE001 - a failed probe must not fail the run
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


async def run_once(task: dict[str, Any], repetition: int, args: argparse.Namespace) -> tuple[RawRun, dict[str, Any]]:
    # Imported lazily so `--help` works without the dependency installed.
    from browser_use import Agent

    try:
        from browser_use import ChatAnthropic  # browser-use >= 0.13
    except ImportError:  # pragma: no cover - older layout
        from browser_use.llm import ChatAnthropic

    url = f"http://127.0.0.1:{args.port}/{task['path']}"
    agent = Agent(task=f"{task['prompt']}\nStart at {url}", llm=ChatAnthropic(model=args.model))

    started = time.monotonic()
    history = await agent.run(max_steps=args.max_steps)
    duration_ms = int((time.monotonic() - started) * 1000)

    page_text = await final_page_text(agent)
    input_tokens, output_tokens = usage_from_history(history)
    outcome = classify_outcome(history, page_text, task["verify_text"])

    run = RawRun(
        task=task["id"],
        outcome=outcome,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        duration_ms=duration_ms,
        repetition=repetition,
    )
    dump = {
        **asdict(run),
        "url": url,
        "browser_use_version": browser_use_version(),
        "model": args.model,
        "is_successful": _call_safely(history, "is_successful"),
        "final_result": _call_safely(history, "final_result"),
        "urls": _call_safely(history, "urls"),
        "errors": _call_safely(history, "errors"),
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
    parser.add_argument("--model", required=True, help="model id; must match the Rote runs exactly")
    parser.add_argument("--port", type=int, default=tasks_config["fixture_port"], help="fixture server port")
    parser.add_argument("--repetitions", type=int, default=tasks_config["repetitions"], help="runs per task (gate needs >= 15 successes)")
    parser.add_argument("--max-steps", type=int, default=25, help="Browser Use step ceiling per run")
    parser.add_argument("--task", action="append", dest="only", help="limit to a task id; repeatable")
    args = parser.parse_args()

    tasks = [t for t in tasks_config["tasks"] if not args.only or t["id"] in args.only]
    raw_dir = args.out / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    runs: list[RawRun] = []
    for task in tasks:
        for repetition in range(args.repetitions):
            run, dump = await run_once(task, repetition, args)
            # Written per run, not at the end: a crash mid-matrix must not lose the
            # runs already paid for.
            (raw_dir / f"{task['id'].lower()}-{repetition}.json").write_text(json.dumps(dump, indent=2) + "\n")
            runs.append(run)
            print(f"{task['id']} rep {repetition}: {run.outcome} {run.input_tokens}+{run.output_tokens} tokens in {run.duration_ms}ms")

    out_path = args.out / "raw-runs.json"
    out_path.write_text(json.dumps([asdict(r) for r in runs], indent=2) + "\n")
    print(f"\nwrote {out_path} ({len(runs)} runs, browser-use {browser_use_version()})")


if __name__ == "__main__":
    asyncio.run(main())
