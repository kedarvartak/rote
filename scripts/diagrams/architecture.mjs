// Regenerates docs/diagrams/architecture.svg deterministically.
// Run: node scripts/diagrams/architecture.mjs
// Update the STATUS lines when docs/02 §Status changes — a stale diagram is a bug
// (CLAUDE.md, Docs practices).
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INK = '#1a1a1a', MUTED = '#5b5955', BLUE = '#2a78d6', GREEN = '#1baf7a', RED = '#e34948';
const FONT = 'font-family="Helvetica,Arial,sans-serif"';

const STATUS = {
  synced: '2026-08-22 (T41/#168)',
  tier0: 'built · P1 certified (T10/T11/T25), SPA-endurance certified (T34)',
  tier1: 'built · zero-LLM replay certified (T36/T40/T41); billed T0 curve pending',
  tier2: 'built · value-free store + brief + settle priors; billed T2 utility pending',
};

let g = '';
const box = (x, y, w, h, stroke, title, lines, status) => {
  g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#ffffff" stroke="${stroke}" stroke-width="1.6"/>`;
  g += `<text x="${x + w / 2}" y="${y + 22}" text-anchor="middle" font-size="14" font-weight="bold" fill="${INK}" ${FONT}>${title}</text>`;
  lines.forEach((t, i) => { g += `<text x="${x + w / 2}" y="${y + 42 + i * 17}" text-anchor="middle" font-size="12" fill="${MUTED}" ${FONT}>${t}</text>`; });
  if (status) g += `<text x="${x + w / 2}" y="${y + h - 10}" text-anchor="middle" font-size="11" font-style="italic" fill="${GREEN}" ${FONT}>${status}</text>`;
};
const arrow = (x1, y1, x2, y2, label, dashed) => {
  g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="1.6"${dashed ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#arr)"/>`;
  if (label) g += `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 7}" text-anchor="middle" font-size="11" fill="${MUTED}" ${FONT}>${label}</text>`;
};

g += `<defs><marker id="arr" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${INK}"/></marker></defs>`;
g += `<text x="490" y="34" text-anchor="middle" font-size="19" font-weight="bold" fill="${INK}" ${FONT}>Rote: the memory manager for browser agents</text>`;
g += `<text x="490" y="54" text-anchor="middle" font-size="12" fill="${MUTED}" ${FONT}>the context window is a managed resource: a budget, an eviction policy, a layout contract, a trust gate</text>`;

g += `<rect x="30" y="80" width="270" height="360" rx="14" fill="#f0f5fc" stroke="#c9dcf3"/>`;
g += `<text x="165" y="104" text-anchor="middle" font-size="14" font-weight="bold" fill="${INK}" ${FONT}>THE LOOP (one run)</text>`;
box(55, 118, 220, 74, BLUE, 'Observe', ['distilled page, stable IDs,', 'diffed vs. grounded base']);
box(55, 212, 220, 68, BLUE, 'Decide', ['planner picks one action;', 'routine/frontier routed']);
box(55, 300, 220, 74, BLUE, 'Act + verify', ['settled, assertion-gated,', 'authoritative evidence']);
arrow(165, 192, 165, 212); arrow(165, 280, 165, 300);
g += `<path d="M 55 337 C 18 337 18 155 55 155" fill="none" stroke="${INK}" stroke-width="1.6" marker-end="url(#arr)"/>`;
g += `<text x="36" y="246" text-anchor="middle" font-size="10" fill="${MUTED}" ${FONT} transform="rotate(-90 36 246)">next step</text>`;

g += `<rect x="380" y="80" width="580" height="360" rx="14" fill="#eefaf4" stroke="#bfe8d5"/>`;
g += `<text x="670" y="104" text-anchor="middle" font-size="14" font-weight="bold" fill="${INK}" ${FONT}>THE MEMORY (three tiers)</text>`;
box(405, 118, 530, 92, GREEN, 'TIER 0 — WORKING (within one run)', ['evict observations · diff · budget · cache-stable layout · compaction'], STATUS.tier0);
box(405, 226, 530, 92, GREEN, 'TIER 1 — EPISODIC (across runs of a task)', ['record → distill → playbook → matcher → contract-gated replay'], STATUS.tier1);
box(405, 334, 530, 92, GREEN, 'TIER 2 — SEMANTIC (across tasks on a site)', ['site brief · selector maps · settle priors · quirks — advisory only'], STATUS.tier2);
arrow(300, 160, 405, 160, 'every step');
arrow(300, 246, 405, 272, 'record');
arrow(405, 300, 300, 330, 'verified replay', true);

g += `<rect x="30" y="466" width="930" height="64" rx="12" fill="#fdf1f0" stroke="${RED}" stroke-width="1.6"/>`;
g += `<text x="495" y="492" text-anchor="middle" font-size="13.5" font-weight="bold" fill="${INK}" ${FONT}>TRUST GATE — the precondition for every tier (invariant 1)</text>`;
g += `<text x="495" y="512" text-anchor="middle" font-size="12" fill="${MUTED}" ${FONT}>fingerprint (hard) · matcher fails closed · action contract before dispatch · authoritative outcome evidence — memory re-enters only through assertions</text>`;
arrow(165, 374, 165, 466, ''); arrow(670, 426, 670, 466, '');
g += `<text x="42" y="556" font-size="11" fill="${MUTED}" ${FONT}>design vs reality: docs/02 §Status is authoritative · regenerate with scripts/diagrams/architecture.mjs · statuses last synced ${STATUS.synced}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="990" height="570" viewBox="0 0 990 570"><rect width="990" height="570" fill="#ffffff"/>${g}</svg>`;
const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'diagrams', 'architecture.svg');
writeFileSync(out, svg + '\n');
console.log(`wrote ${out} (${svg.length} bytes)`);
