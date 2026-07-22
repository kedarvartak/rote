# WordPress curve portal

Deterministic local target selected by `docs/testing/T2-measurement-page-selection.md`
for P1's cumulative-token curve. It runs the real WordPress 6.8.2 administration UI,
deletes stock/non-benchmark posts, seeds exactly 120 published procurement-style posts, and configures the post table to show 100
rows. A mounted must-use plugin mirrors WordPress's existing screen-reader checkbox text
onto each input's `aria-label`, avoiding numeric-ID inference by either harness. Images are
pinned by immutable digest; no WordPress source is copied into Rote.

## Requirements

- Docker with Compose
- Local Chrome/Chromium for the observation probe
- About 1 GB of free image storage on first pull

## Start and seed

```bash
scripts/bench/curve/wordpress/start.sh --reset
```

The portal is then available at `http://127.0.0.1:18081/wp-admin/edit.php`. `start.sh`
generates local database and administrator credentials in this directory's ignored
`.env` file on first use; the observation probe reads the same file. No credential is
checked into the repository.

`--reset` deletes this benchmark stack's named volumes. Without it, `start.sh` is
idempotent, removes every non-benchmark post, restores all benchmark posts to their
published state, and fails the exact corpus gate on any extra/missing/title/status drift.

Reset task state between measured repetitions without restarting the stack:

```bash
scripts/bench/curve/wordpress/reset-state.sh
```

Stop and remove all local state:

```bash
cd scripts/bench/curve/wordpress
docker compose down --volumes
```

## Validate observation size and stability

```bash
node --import tsx/esm scripts/bench/curve/wordpress/probe-observation.mjs 15 \
  > observation-stability.json
```

The probe uses one unmeasured session to initialize WordPress's per-user admin state,
then opens a fresh Chrome instance for each of the 15 measured repetitions. It signs in,
captures the 100-row post list through Rote's real CDP backend, distills it, and reports
characters plus the explicitly approximate `ceil(chars / 4)` token estimate. It does not
call an LLM.

## Candidate task and ground truth

The E1.2 protocol will parameterize one operation by task length:

1. Sign in.
2. On the 100-row post list, select *k* named `Rote curve post NNN` checkboxes.
3. Choose `Move to Trash` from the bulk-action select.
4. Apply it.

Varying *k* yields a controllable 10–25 action range while every checkbox interaction
starts from the same ~12K-token real administration page. `verify-corpus.sh` first requires exactly titles 001–120 with published status. The
independent result verifier reads WordPress's database through WP-CLI and requires the exact trashed title set—not merely
the right count:

```bash
scripts/bench/curve/wordpress/verify-trash-posts.sh '["Rote curve post 120"]'
```

The curve protocol owns the exact step-count cells and task wording; this environment
fixes the page, seed, reset contract, and ground-truth boundary.
