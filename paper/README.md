# Paper draft — ICLR 2027 submission

Target venue: **ICLR 2027** (top-tier ML, CFP open). Deadlines (AoE): abstract
**Sep 18 2026**, paper **Sep 25 2026**. Double blind; ≤9 pages main text at
submission; references/appendix unlimited. Official style files unpacked here from
`https://media.iclr.cc/Conferences/ICLR2027/iclr-2027-style-files.zip`.

| File | What |
|---|---|
| `rote.tex` | The Rote draft — section skeleton with each section mapped to the `docs/testing/T*.md` evidence it should cite |
| `rote.bib` | References (empty; fill) |
| `figures/build-figures.mjs` | Regenerates every figure (SVG + PDF) deterministically from `docs/testing/data/*.json`; needs Chromium (`node figures/build-figures.mjs`) |
| `iclr2027_conference.{sty,bst,tex,bib}`, `math_commands.tex`, `fancyhdr.sty`, `natbib.sty` | Untouched official template; `iclr2027_conference.tex` is the formatting-instructions sample |

Build (needs TeX Live; or upload the folder to Overleaf):

```
cd paper && pdflatex rote && bibtex rote && pdflatex rote && pdflatex rote
```

Rules to keep in mind while writing (from the author guidelines): no author names
or identifying links until `\iclrfinalcopy`; AI-use statement is required;
reproducibility statement strongly encouraged; figures go through `graphicx`
(export `docs/diagrams/*.svg` to PDF).

Fallback if the billed exit-gate campaign is not done by Sep 20: submit the same
draft to the non-archival NeurIPS 2026 TTCL workshop (deadline Aug 30 2026) and
retarget the main paper to MLSys 2027 (deadline Oct 30 2026, CFP not yet posted).

## Scripts

| Command | What |
|---|---|
| `node scripts/verify-bib.mjs` | Checks every non-`@misc` bib entry against DBLP (title + year exactly, venue reported for a human) and writes `bib-verification.json`. Exits non-zero on any disagreement. Verified results are cached, so DBLP's aggressive rate limiting cannot turn a transient failure into an apparent mismatch. |
| `node scripts/build-artifact.mjs` | Stages the anonymized artifact the reproducibility statement promises (packages, fixtures, bench/demo scripts, every frozen test record and its raw data), **redacts identifying strings in the staged copy only**, re-scans, and fails if anything survives. Writes `MANIFEST.json` with a per-file digest and an overall artifact digest. |
| `node figures/build-figures.mjs` | Regenerates every figure from the frozen data (needs Chromium). |

## Campaign-contingent claims

The provider-billed exit campaign has not run. Every sentence whose truth depends on it
lives inside `\campaignresult{...}`, defined empty at the top of `rote.tex`, and the
standing caveat is `\campaignpending`. The paper as compiled therefore claims only what
has been collected — so the **abstract deadline can be met without asserting a result the
campaign might contradict** — and folding the numbers in later is an edit in one place.

## Pre-submission checklist

- [x] Verify every `rote.bib` entry against DBLP — 15/15 agree (`bib-verification.json`).
- [x] Abstract and body free of unresolved TODOs; campaign-contingent text isolated in a macro.
- [x] Anonymized artifact builds with a clean anonymity scan.
- [ ] Fill `\campaignresult` once the billed campaign publishes (§6.3, §1, abstract).
- [ ] Re-run `node figures/build-figures.mjs` if any frozen data set changed.
- [ ] Final read for double-blind hygiene in any newly added prose.
