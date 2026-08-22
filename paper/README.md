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

## Pre-submission checklist

- Verify every `rote.bib` entry's venue/year/authors against DBLP before submission.
- Replace the abstract's and §6.3's `[TODO billed]` blocks with the billed campaign numbers.
- Write §1, §7 Limitations, §8 Conclusion, reproducibility + AI-use statements.
- Re-run `node figures/build-figures.mjs` if any frozen data set changed.
