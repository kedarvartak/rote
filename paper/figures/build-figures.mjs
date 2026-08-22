// Build the paper's figures deterministically from the frozen T-report data.
// Outputs SVG (versioned) and prints each to PDF via headless Chromium for
// \includegraphics. Palette: categorical slot 1 (blue, Rote) and slot 2
// (orange, Browser Use); validated CVD-safe for the light print surface.
// Usage: node paper/figures/build-figures.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const BLUE = '#2a78d6', ORANGE = '#eb6834';
const INK = '#0b0b0b', MUTED = '#52514e', GRID = '#e4e3df', SURFACE = '#ffffff';
const FONT = 'font-family="Helvetica,Arial,sans-serif"';

function svgDoc(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${SURFACE}"/>${body}</svg>`;
}


// ---- Figure 0: architecture (paper-specific; the docs diagram carries repo
// status annotations that do not belong in a publication) ---------------------
function architecture() {
  const W = 720, H = 330;
  let g = '';
  const box = (x, y, w, h, fill, stroke, title, lines, dashed = false) => {
    g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dashed ? ' stroke-dasharray="6 4"' : ''}/>`;
    g += `<text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-size="12" font-weight="bold" fill="${INK}" ${FONT}>${title}</text>`;
    lines.forEach((t, i) => {
      g += `<text x="${x + w / 2}" y="${y + 38 + i * 15}" text-anchor="middle" font-size="10.5" fill="${MUTED}" ${FONT}>${t}</text>`;
    });
  };
  const arrow = (x1, y1, x2, y2, label, dashed = false) => {
    g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="1.5"${dashed ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#arr)"/>`;
    if (label) g += `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" font-size="10" fill="${MUTED}" ${FONT}>${label}</text>`;
  };
  g += `<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${INK}"/></marker></defs>`;
  // Left: the run loop
  g += `<rect x="16" y="16" width="200" height="252" rx="12" fill="#f0f5fc" stroke="#c9dcf3"/>`;
  g += `<text x="116" y="36" text-anchor="middle" font-size="12" font-weight="bold" fill="${INK}" ${FONT}>The loop (one run)</text>`;
  box(36, 48, 160, 56, '#ffffff', BLUE, 'Observe', ['distilled page, stable IDs,', 'diffed vs. grounded base']);
  box(36, 118, 160, 44, '#ffffff', BLUE, 'Decide', ['planner picks one action']);
  box(36, 176, 160, 56, '#ffffff', BLUE, 'Act + verify', ['settled, assertion-gated,', 'authoritative evidence']);
  arrow(116, 104, 116, 118);
  arrow(116, 162, 116, 176);
  g += `<path d="M 36 204 C 8 204 8 76 36 76" fill="none" stroke="${INK}" stroke-width="1.5" marker-end="url(#arr)"/>`;
  // Right: three tiers
  g += `<rect x="300" y="16" width="404" height="252" rx="12" fill="#eefaf4" stroke="#bfe8d5"/>`;
  g += `<text x="502" y="36" text-anchor="middle" font-size="12" font-weight="bold" fill="${INK}" ${FONT}>The memory (three tiers)</text>`;
  box(320, 48, 364, 62, '#ffffff', '#1baf7a', 'Tier 0 — working (within one run)', ['budget · observation eviction · diff', 'cache-stable layout · scheduled compaction']);
  box(320, 122, 364, 62, '#ffffff', '#1baf7a', 'Tier 1 — episodic (across runs of one task)', ['record → distill → playbook →', 'matcher → contract-gated replay']);
  box(320, 196, 364, 56, '#ffffff', '#1baf7a', 'Tier 2 — semantic (across tasks on one site)', ['value-free site memory → advisory brief']);
  arrow(216, 76, 300, 76, 'every step');
  arrow(216, 140, 320, 152, 'record');
  arrow(320, 166, 216, 196, 'verified replay', true);
  // Bottom: trust gate
  box(16, 284, 688, 34, '#fdf1f0', '#e34948', '', []);
  g += `<text x="360" y="300" text-anchor="middle" font-size="11.5" font-weight="bold" fill="${INK}" ${FONT}>Trust gate — precondition for every tier</text>`;
  g += `<text x="360" y="313" text-anchor="middle" font-size="10.5" fill="${MUTED}" ${FONT}>fingerprint (hard) · matcher fails closed · action contract before dispatch · authoritative outcome evidence</text>`;
  arrow(502, 252, 502, 284, '');
  arrow(116, 232, 116, 284, '');
  return svgDoc(W, H, g);
}

// ---- Figure 1: T10 cumulative logical-input curve --------------------------
function tokenCurve() {
  const t = JSON.parse(readFileSync(join(repo, 'docs/testing/data/T10-g1-curve-summary.json'), 'utf8'));
  const cells = t.cells.map((c) => ({
    steps: c.target_steps,
    rote: c.subject.logical_input_tokens,
    base: c.baseline.logical_input_tokens,
  }));
  const W = 560, H = 360, L = 62, R = 118, T = 18, B = 44;
  const pw = W - L - R, ph = H - T - B;
  const xs = cells.map((c) => c.steps);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMax = 120000;
  const X = (s) => L + ((s - xMin) / (xMax - xMin)) * pw;
  const Y = (v) => T + ph - (v / yMax) * ph;
  let g = '';
  for (let v = 0; v <= yMax; v += 20000) {
    g += `<line x1="${L}" y1="${Y(v)}" x2="${L + pw}" y2="${Y(v)}" stroke="${GRID}" stroke-width="1"/>`;
    g += `<text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="${MUTED}" ${FONT}>${v / 1000}k</text>`;
  }
  for (const s of xs)
    g += `<text x="${X(s)}" y="${T + ph + 18}" text-anchor="middle" font-size="11" fill="${MUTED}" ${FONT}>${s}</text>`;
  g += `<text x="${L + pw / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="${INK}" ${FONT}>Task length (steps)</text>`;
  g += `<text x="14" y="${T + ph / 2}" transform="rotate(-90 14 ${T + ph / 2})" text-anchor="middle" font-size="12" fill="${INK}" ${FONT}>Cumulative logical input (tokens)</text>`;
  const series = [
    { key: 'base', color: ORANGE, label: 'Browser Use' },
    { key: 'rote', color: BLUE, label: 'Rote' },
  ];
  for (const { key, color, label } of series) {
    // 95% CI band (narrow; drawn under the line)
    const up = cells.map((c) => `${X(c.steps)},${Y(c[key].upper)}`).join(' ');
    const lo = cells.slice().reverse().map((c) => `${X(c.steps)},${Y(c[key].lower)}`).join(' ');
    g += `<polygon points="${up} ${lo}" fill="${color}" opacity="0.18"/>`;
    const pts = cells.map((c) => `${X(c.steps)},${Y(c[key].point)}`).join(' ');
    g += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>`;
    for (const c of cells)
      g += `<circle cx="${X(c.steps)}" cy="${Y(c[key].point)}" r="4" fill="${color}" stroke="${SURFACE}" stroke-width="2"/>`;
    const last = cells[cells.length - 1];
    g += `<text x="${X(last.steps) + 10}" y="${Y(last[key].point) + 4}" font-size="12" fill="${INK}" ${FONT}>${label}</text>`;
  }
  const pct = (t.slope.reduction.point * 100).toFixed(1);
  g += `<text x="${L + 6}" y="${T + 14}" font-size="11" fill="${MUTED}" ${FONT}>Slope reduction ${pct}% [${(t.slope.reduction.lower * 100).toFixed(1)}–${(t.slope.reduction.upper * 100).toFixed(1)}%]</text>`;
  return svgDoc(W, H, g);
}

// ---- Figure 2: T39 predictor calibration + coverage/precision --------------
function predictor() {
  const d = JSON.parse(readFileSync(join(repo, 'docs/testing/data/T39-predictor-simulation.json'), 'utf8'));
  const W = 640, H = 300, panelW = 250, L1 = 62, L2 = L1 + panelW + 90, T = 26, B = 46;
  const ph = H - T - B;
  let g = '';
  // Panel (a): reliability — mean confidence vs realized hit rate, y from 0.95
  const X1 = (v) => L1 + v * panelW;
  const Y1 = (v) => T + ph - ((v - 0.95) / 0.05) * ph;
  g += `<text x="${L1 + panelW / 2}" y="14" text-anchor="middle" font-size="12" fill="${INK}" ${FONT}>(a) Reliability (fixture corpus)</text>`;
  for (const v of [0.95, 0.96, 0.97, 0.98, 0.99, 1.0]) {
    g += `<line x1="${L1}" y1="${Y1(v)}" x2="${L1 + panelW}" y2="${Y1(v)}" stroke="${GRID}"/>`;
    g += `<text x="${L1 - 6}" y="${Y1(v) + 4}" text-anchor="end" font-size="10" fill="${MUTED}" ${FONT}>${v.toFixed(2)}</text>`;
  }
  for (const v of [0, 0.5, 1])
    g += `<text x="${X1(v)}" y="${T + ph + 16}" text-anchor="middle" font-size="10" fill="${MUTED}" ${FONT}>${v}</text>`;
  g += `<text x="${L1 + panelW / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${INK}" ${FONT}>Mean confidence in bucket</text>`;
  g += `<text x="${L1 - 44}" y="${T + ph / 2}" transform="rotate(-90 ${L1 - 44} ${T + ph / 2})" text-anchor="middle" font-size="11" fill="${INK}" ${FONT}>Realized hit rate</text>`;
  for (const b of d.calibration.filter((b) => b.steps > 0)) {
    g += `<circle cx="${X1(b.mean_confidence)}" cy="${Y1(b.hit_rate)}" r="5" fill="${BLUE}" stroke="${SURFACE}" stroke-width="2"/>`;
    g += `<text x="${X1(b.mean_confidence)}" y="${Y1(b.hit_rate) + 18}" text-anchor="middle" font-size="9" fill="${MUTED}" ${FONT}>n=${b.steps}</text>`;
  }
  // perfectly-calibrated reference: hit rate == confidence, only visible where conf>=0.95
  g += `<line x1="${X1(0.95)}" y1="${Y1(0.95)}" x2="${X1(1)}" y2="${Y1(1)}" stroke="${MUTED}" stroke-width="1" stroke-dasharray="4 3"/>`;
  g += `<text x="${X1(0.04)}" y="${Y1(0.9605)}" font-size="10" fill="${MUTED}" ${FONT}>under-calibrated: low scores</text>`;
  g += `<text x="${X1(0.04)}" y="${Y1(0.9605) + 12}" font-size="10" fill="${MUTED}" ${FONT}>already hit ≥ 98.7%</text>`;
  // Panel (b): coverage & precision vs threshold
  const X2 = (v) => L2 + ((v - 0.5) / 0.45) * panelW;
  const Y2 = (v) => T + ph - v * ph;
  g += `<text x="${L2 + panelW / 2}" y="14" text-anchor="middle" font-size="12" fill="${INK}" ${FONT}>(b) Acting threshold trade-off</text>`;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    g += `<line x1="${L2}" y1="${Y2(v)}" x2="${L2 + panelW}" y2="${Y2(v)}" stroke="${GRID}"/>`;
    g += `<text x="${L2 - 6}" y="${Y2(v) + 4}" text-anchor="end" font-size="10" fill="${MUTED}" ${FONT}>${v}</text>`;
  }
  for (const th of d.thresholds.map((t) => t.threshold))
    g += `<text x="${X2(th)}" y="${T + ph + 16}" text-anchor="middle" font-size="10" fill="${MUTED}" ${FONT}>${th}</text>`;
  g += `<text x="${L2 + panelW / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${INK}" ${FONT}>Confidence threshold</text>`;
  const prec = d.thresholds.map((t) => `${X2(t.threshold)},${Y2(t.precision)}`).join(' ');
  const cov = d.thresholds.map((t) => `${X2(t.threshold)},${Y2(t.coverage)}`).join(' ');
  g += `<polyline points="${prec}" fill="none" stroke="${BLUE}" stroke-width="2"/>`;
  g += `<polyline points="${cov}" fill="none" stroke="${ORANGE}" stroke-width="2"/>`;
  for (const t of d.thresholds) {
    g += `<circle cx="${X2(t.threshold)}" cy="${Y2(t.precision)}" r="4" fill="${BLUE}" stroke="${SURFACE}" stroke-width="2"/>`;
    g += `<circle cx="${X2(t.threshold)}" cy="${Y2(t.coverage)}" r="4" fill="${ORANGE}" stroke="${SURFACE}" stroke-width="2"/>`;
  }
  g += `<text x="${X2(0.75)}" y="${Y2(1) + 20}" text-anchor="middle" font-size="11" fill="${INK}" ${FONT}>precision</text>`;
  g += `<text x="${X2(0.75)}" y="${Y2(0.63) + 22}" text-anchor="middle" font-size="11" fill="${INK}" ${FONT}>coverage</text>`;
  return svgDoc(W, H, g);
}

// ---- Render SVG -> PDF via headless Chromium -------------------------------
function toPdf(svgPath, pdfPath, w, h) {
  const html = `<!doctype html><style>@page{size:${w}px ${h}px;margin:0}html,body{margin:0;padding:0}img{display:block}</style><img src="${svgPath}" width="${w}" height="${h}">`;
  const htmlPath = svgPath.replace(/\.svg$/, '.html');
  writeFileSync(htmlPath, html);
  const chrome = process.env.CHROME_BIN ?? 'chromium-browser';
  execFileSync(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--print-to-pdf=${pdfPath}`, '--no-pdf-header-footer', htmlPath,
  ], { stdio: 'pipe' });
}

mkdirSync(here, { recursive: true });
const figs = [
  ['fig-architecture', architecture(), 720, 330],
  ['fig-token-curve', tokenCurve(), 560, 360],
  ['fig-predictor', predictor(), 640, 300],
];
for (const [name, svg, w, h] of figs) {
  const svgPath = join(here, `${name}.svg`);
  writeFileSync(svgPath, svg);
  toPdf(svgPath, join(here, `${name}.pdf`), w, h);
  console.log(`${name}: svg + pdf written (${w}x${h})`);
}
