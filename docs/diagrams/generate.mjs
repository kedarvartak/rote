import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const palette = {
  ink: '#172033', muted: '#5f6b7a', line: '#8b97a8', bg: '#f8fafc',
  blue: '#dbeafe', blueLine: '#2563eb', violet: '#ede9fe', violetLine: '#7c3aed',
  amber: '#fef3c7', amberLine: '#d97706', green: '#dcfce7', greenLine: '#16a34a',
  rose: '#ffe4e6', roseLine: '#e11d48', slate: '#e2e8f0', slateLine: '#64748b',
};

let seq = 0;
const id = (prefix) => `${prefix}-${++seq}`;
const box = (x, y, w, h, label, fill, stroke, options = {}) => ({
  kind: 'box', id: id('box'), x, y, w, h, label, fill, stroke,
  dashed: options.dashed ?? false, radius: options.radius ?? 14,
  fontSize: options.fontSize ?? 18, bold: options.bold ?? false,
});
const text = (x, y, w, label, options = {}) => ({
  kind: 'text', id: id('text'), x, y, w, h: options.h ?? 30, label,
  color: options.color ?? palette.ink, fontSize: options.fontSize ?? 18,
  bold: options.bold ?? false, align: options.align ?? 'left',
});
const arrow = (x1, y1, x2, y2, label = '', options = {}) => ({
  kind: 'arrow', id: id('arrow'), x1, y1, x2, y2, label,
  color: options.color ?? palette.line, dashed: options.dashed ?? false,
});

const diagrams = [
  {
    name: 'architecture', width: 1320, height: 900,
    title: 'Rote architecture — efficient browser work that compounds',
    subtitle: 'Solid = implemented foundation · Dashed = planned harness capability',
    items: [
      box(50, 120, 240, 115, 'Entry surfaces\nCLI · SDK · MCP', palette.slate, palette.slateLine, { bold: true }),
      box(370, 105, 560, 145, 'AGENT CONTROL LOOP\nfingerprint → replay fast path → observe\ndecide → act → verify', palette.blue, palette.blueLine, { dashed: true, bold: true, fontSize: 20 }),
      box(1010, 120, 250, 115, 'Browser sessions\nlocal CDP · hosted', palette.slate, palette.slateLine, { bold: true }),
      arrow(290, 178, 370, 178), arrow(930, 178, 1010, 178),

      box(60, 330, 270, 190, 'PERCEPTION\n\nCapture DOM + a11y\nDistill + stable IDs\nDiff + token budget', palette.green, palette.greenLine, { bold: true }),
      box(370, 330, 270, 190, 'DECISION\n\nCache-stable context\nRoute model by step\nSkip model on replay', palette.violet, palette.violetLine, { dashed: true, bold: true }),
      box(680, 330, 270, 190, 'ACTION\n\nTyped browser actions\nSettledness + resolution\nExpect assertions', palette.amber, palette.amberLine, { dashed: true, bold: true }),
      box(990, 330, 270, 190, 'LEARNING\n\nRecord every run\nPlaybooks + site memory\nPrediction + drift', palette.rose, palette.roseLine, { dashed: true, bold: true }),
      arrow(195, 250, 195, 330), arrow(330, 425, 370, 425), arrow(640, 425, 680, 425), arrow(950, 425, 990, 425),
      arrow(1125, 330, 800, 260, 'memory feeds the next run', { dashed: true, color: palette.roseLine }),

      box(60, 635, 280, 130, '@rote/browser\n@rote/perception', palette.green, palette.greenLine, { bold: true }),
      box(385, 635, 280, 130, '@rote/core\nshared schemas + pure logic', palette.blue, palette.blueLine, { bold: true }),
      box(710, 635, 280, 130, '@rote/executor\n@rote/recorder', palette.amber, palette.amberLine, { bold: true }),
      box(1035, 635, 225, 130, '@rote/bench\n@rote/cli', palette.slate, palette.slateLine, { bold: true }),
      text(60, 585, 1200, 'IMPLEMENTED FOUNDATION', { align: 'center', bold: true, color: palette.greenLine, fontSize: 17 }),
      text(60, 800, 1200, 'Safety floor: assertion-gated replay · final verification · environment fingerprinting · append-only versions', { align: 'center', bold: true, fontSize: 18 }),
    ],
  },
  {
    name: 'package-map', width: 1320, height: 900,
    title: 'Package topology — implemented foundation and target composition',
    subtitle: 'Dependencies point toward @rote/core; @rote/agent composes the target harness',
    items: [
      text(55, 105, 560, 'IMPLEMENTED NOW', { bold: true, color: palette.greenLine, fontSize: 20 }),
      box(470, 145, 380, 105, '@rote/core\nZod schemas · transforms · serialization', palette.blue, palette.blueLine, { bold: true }),
      box(60, 320, 245, 100, '@rote/browser\ncapture boundary', palette.green, palette.greenLine, { bold: true }),
      box(365, 320, 245, 100, '@rote/perception\ndistill · stable IDs · render', palette.green, palette.greenLine, { bold: true }),
      box(670, 320, 245, 100, '@rote/recorder\nMCP proxy · run artifacts', palette.amber, palette.amberLine, { bold: true }),
      box(975, 320, 245, 100, '@rote/executor\nverified playbook replay', palette.amber, palette.amberLine, { bold: true }),
      box(365, 495, 245, 95, '@rote/cli\ninspect recorded runs', palette.slate, palette.slateLine, { bold: true }),
      box(670, 495, 245, 95, '@rote/bench\nrun · report · gate', palette.slate, palette.slateLine, { bold: true }),
      arrow(182, 320, 520, 250), arrow(487, 320, 600, 250), arrow(792, 320, 720, 250), arrow(1097, 320, 800, 250),
      arrow(487, 495, 730, 420), arrow(792, 495, 792, 420),

      text(55, 660, 560, 'TARGET COMPOSITION', { bold: true, color: palette.violetLine, fontSize: 20 }),
      box(45, 690, 825, 140, '', palette.bg, palette.line, { dashed: true }),
      box(60, 715, 180, 90, 'decision', palette.violet, palette.violetLine, { dashed: true, bold: true }),
      box(265, 715, 180, 90, 'action', palette.amber, palette.amberLine, { dashed: true, bold: true }),
      box(470, 715, 180, 90, 'memory', palette.rose, palette.roseLine, { dashed: true, bold: true }),
      box(675, 715, 180, 90, 'predictor', palette.rose, palette.roseLine, { dashed: true, bold: true }),
      box(880, 690, 190, 130, '@rote/agent\ncontrol loop +\nrecovery', palette.blue, palette.blueLine, { dashed: true, bold: true }),
      box(1095, 710, 165, 90, 'mcp-server', palette.slate, palette.slateLine, { dashed: true, bold: true }),
      arrow(870, 755, 880, 755, 'compose'), arrow(1070, 755, 1095, 755),
    ],
  },
  {
    name: 'perception-pipeline', width: 1320, height: 600,
    title: 'Perception pipeline — spend tokens only on decision-relevant change',
    subtitle: 'Current P1 foundation is solid; later filtering, diffs, and vision escalation are dashed',
    items: [
      box(50, 195, 170, 120, 'Browser\nDOM · a11y\nlayout', palette.slate, palette.slateLine, { bold: true }),
      box(270, 195, 180, 120, 'Capture\nnormalize page\nsnapshot', palette.green, palette.greenLine, { bold: true }),
      box(500, 195, 180, 120, 'Distill\ninteractive tree\n+ stable IDs', palette.green, palette.greenLine, { bold: true }),
      box(730, 195, 180, 120, 'Filter + diff\ntask relevance\nvs prior snapshot', palette.violet, palette.violetLine, { dashed: true, bold: true }),
      box(960, 195, 180, 120, 'Budgeted render\nfull → diff\n→ summary', palette.blue, palette.blueLine, { dashed: true, bold: true }),
      box(1175, 195, 105, 120, 'Agent\ncontext', palette.amber, palette.amberLine, { dashed: true, bold: true }),
      arrow(220, 255, 270, 255), arrow(450, 255, 500, 255), arrow(680, 255, 730, 255), arrow(910, 255, 960, 255), arrow(1140, 255, 1175, 255),
      box(730, 410, 410, 95, 'Selective vision escalation\nscreenshot + set-of-marks only when structure is insufficient', palette.rose, palette.roseLine, { dashed: true, bold: true, fontSize: 16 }),
      arrow(1060, 315, 980, 410, 'on demand', { dashed: true, color: palette.roseLine }),
      text(50, 370, 560, 'Pure center: distill and render are deterministic functions; CDP capture stays at the I/O edge.', { color: palette.muted, fontSize: 16 }),
    ],
  },
  {
    name: 'run-lifecycle', width: 1320, height: 650,
    title: 'Run lifecycle — cold exploration becomes verified browser memory',
    subtitle: 'The economic claim is measured at success parity; verification is the irreducible floor',
    items: [
      box(60, 170, 340, 300, 'COLD · RUN 1\n\nFrontier agent explores\nRecorder captures all calls\nSuccessful run is distilled\n\nOutput: trajectory → playbook v1', palette.blue, palette.blueLine, { bold: true, fontSize: 20 }),
      box(490, 170, 340, 300, 'WARM · RUN N\n\nFingerprint + task match\nExecutor replays essential DAG\nExpect + verify gates run\n\nOutput: confidence observation', palette.green, palette.greenLine, { bold: true, fontSize: 20 }),
      box(920, 170, 340, 300, 'DRIFT · RUN N+k\n\nAssertion detects change\nRetry or scoped repair\nFallback re-explores if needed\n\nOutput: patch → playbook vN+1', palette.amber, palette.amberLine, { bold: true, fontSize: 20 }),
      arrow(400, 320, 490, 320, 'learn'), arrow(830, 320, 920, 320, 'site changes'),
      text(60, 525, 1200, 'Model control: every step  →  slots/repair only  →  one failed step or full fallback', { align: 'center', bold: true, fontSize: 19 }),
      text(60, 570, 1200, 'Cost trends toward match + essential actions + verification — never toward unverified zero.', { align: 'center', color: palette.muted, fontSize: 17 }),
    ],
  },
  {
    name: 'repair-ladder', width: 1320, height: 760,
    title: 'Recovery ladder — escalate narrowly, never report unverified success',
    subtitle: 'Current executor supports retry and clean fallback; scoped repair and persisted patches are planned',
    items: [
      box(70, 150, 220, 95, 'Execute step k', palette.blue, palette.blueLine, { bold: true }),
      box(385, 145, 230, 105, 'expect passes?', palette.amber, palette.amberLine, { bold: true }),
      box(715, 150, 220, 95, 'Continue DAG', palette.green, palette.greenLine, { bold: true }),
      box(1030, 145, 220, 105, 'final verify[]\npasses?', palette.amber, palette.amberLine, { bold: true }),
      arrow(290, 198, 385, 198), arrow(615, 198, 715, 198, 'yes'), arrow(935, 198, 1030, 198),
      arrow(1140, 250, 1140, 325, 'no'),
      box(990, 325, 300, 90, 'Retry transient failure\nwithin fixed policy', palette.slate, palette.slateLine, { bold: true }),
      arrow(500, 250, 500, 325, 'no'),
      box(350, 325, 300, 90, 'Retry transient failure\nwithin fixed policy', palette.slate, palette.slateLine, { bold: true }),
      box(350, 475, 300, 100, 'Scoped repair\nnarrow context · patch one step', palette.violet, palette.violetLine, { dashed: true, bold: true }),
      box(775, 475, 300, 100, 'Full-agent fallback\nrecord successful replacement run', palette.rose, palette.roseLine, { bold: true }),
      arrow(500, 415, 500, 475, 'still fails'), arrow(650, 525, 775, 525, 'repair fails'), arrow(1140, 415, 925, 475, 'still fails'),
      box(775, 635, 300, 80, 'Re-distill + append vN+1', palette.blue, palette.blueLine, { dashed: true, bold: true }),
      arrow(925, 575, 925, 635),
      arrow(1140, 145, 1140, 90, 'yes → success', { color: palette.greenLine }),
      text(70, 675, 600, 'Invariant: a failed expectation or final verification can never become success.', { bold: true, fontSize: 17 }),
    ],
  },
];

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function svgText(item) {
  const lines = item.label.split('\n');
  const x = item.align === 'center' ? item.x + item.w / 2 : item.x;
  const anchor = item.align === 'center' ? 'middle' : 'start';
  const line = item.fontSize * 1.3;
  const start = item.y + (item.h - (lines.length - 1) * line) / 2;
  return `<text x="${x}" y="${start}" text-anchor="${anchor}" fill="${item.color}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${item.fontSize}" font-weight="${item.bold ? 700 : 500}">${lines.map((s, i) => `<tspan x="${x}" dy="${i ? line : 0}">${xml(s)}</tspan>`).join('')}</text>`;
}

function renderSvg(diagram) {
  const body = diagram.items.map((item) => {
    if (item.kind === 'box') {
      const shape = `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="${item.radius}" fill="${item.fill}" stroke="${item.stroke}" stroke-width="2.5"${item.dashed ? ' stroke-dasharray="10 7"' : ''}/>`;
      return `${shape}${svgText({ ...item, color: palette.ink, align: 'center' })}`;
    }
    if (item.kind === 'text') return svgText(item);
    const mx = (item.x1 + item.x2) / 2;
    const my = (item.y1 + item.y2) / 2 - 9;
    return `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="${item.color}" stroke-width="2.5"${item.dashed ? ' stroke-dasharray="8 6"' : ''} marker-end="url(#arrow)"/>${item.label ? `<text x="${mx}" y="${my}" text-anchor="middle" fill="${item.color}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="14" font-weight="650">${xml(item.label)}</text>` : ''}`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${diagram.width}" height="${diagram.height}" viewBox="0 0 ${diagram.width} ${diagram.height}" role="img" aria-labelledby="title desc">
<title id="title">${xml(diagram.title)}</title><desc id="desc">${xml(diagram.subtitle)}</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>
<rect width="100%" height="100%" fill="${palette.bg}"/>
<text x="50%" y="52" text-anchor="middle" fill="${palette.ink}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="28" font-weight="750">${xml(diagram.title)}</text>
<text x="50%" y="82" text-anchor="middle" fill="${palette.muted}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="15">${xml(diagram.subtitle)}</text>
${body}
</svg>\n`;
}

function excalidrawElement(item) {
  const common = { id: item.id, x: item.x ?? item.x1, y: item.y ?? item.y1, angle: 0, strokeColor: item.stroke ?? item.color ?? palette.ink, backgroundColor: item.fill ?? 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: item.dashed ? 'dashed' : 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, index: null, roundness: null, seed: seq * 997 + 17, version: 1, versionNonce: seq * 991 + 13, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false };
  if (item.kind === 'box') return { ...common, type: 'rectangle', width: item.w, height: item.h, roundness: { type: 3 } };
  if (item.kind === 'arrow') return { ...common, type: 'arrow', width: item.x2 - item.x1, height: item.y2 - item.y1, points: [[0, 0], [item.x2 - item.x1, item.y2 - item.y1]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow', elbowed: false };
  return { ...common, type: 'text', width: item.w, height: item.h, text: item.label, fontSize: item.fontSize, fontFamily: 5, textAlign: item.align, verticalAlign: 'middle', containerId: null, originalText: item.label, autoResize: true, lineHeight: 1.25 };
}

function renderExcalidraw(diagram) {
  const titleItems = [
    text(50, 25, diagram.width - 100, diagram.title, { align: 'center', bold: true, fontSize: 28, h: 40 }),
    text(50, 68, diagram.width - 100, diagram.subtitle, { align: 'center', color: palette.muted, fontSize: 15, h: 24 }),
  ];
  const elements = [...titleItems, ...diagram.items].flatMap((item) => {
    if (item.kind !== 'box') return [excalidrawElement(item)];
    const label = text(item.x + 12, item.y + 8, item.w - 24, item.label, { align: 'center', fontSize: item.fontSize, bold: item.bold, h: item.h - 16 });
    return [excalidrawElement(item), excalidrawElement(label)];
  });
  return `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements, appState: { gridSize: 20, viewBackgroundColor: palette.bg }, files: {} }, null, 2)}\n`;
}

for (const diagram of diagrams) {
  await writeFile(join(OUT, `${diagram.name}.svg`), renderSvg(diagram), 'utf8');
  await writeFile(join(OUT, `${diagram.name}.excalidraw`), renderExcalidraw(diagram), 'utf8');
}
