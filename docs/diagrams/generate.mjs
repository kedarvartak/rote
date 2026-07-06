import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const scenes = JSON.parse(await readFile(join(OUT, 'scenes.json'), 'utf8'));
const BG = '#ffffff';

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

function common(element) {
  const seed = hash(element.id);
  return {
    id: element.id,
    type: element.type,
    x: element.x,
    y: element.y,
    width: element.width ?? 0,
    height: element.height ?? 0,
    angle: 0,
    strokeColor: element.strokeColor ?? '#1e1e1e',
    backgroundColor: element.backgroundColor ?? 'transparent',
    fillStyle: element.fillStyle ?? 'solid',
    strokeWidth: element.strokeWidth ?? 2,
    strokeStyle: element.strokeStyle ?? 'solid',
    roughness: 1,
    opacity: element.opacity ?? 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: element.roundness ?? null,
    seed,
    version: 1,
    versionNonce: hash(`${element.id}-version`),
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
}

function textMetrics(value, fontSize, maxWidth) {
  const sourceLines = String(value).split('\n');
  const lines = [];
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.54)));
  for (const source of sourceLines) {
    if (!source) {
      lines.push('');
      continue;
    }
    const words = source.split(' ');
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return { lines, lineHeight: fontSize * 1.25 };
}

function toExcalidraw(scene) {
  const elements = [];
  for (const source of scene) {
    if (source.type === 'cameraUpdate') continue;
    const element = common(source);
    if (source.type === 'text') {
      const fontSize = source.fontSize ?? 18;
      const metrics = textMetrics(source.text, fontSize, 1000);
      elements.push({
        ...element,
        text: source.text,
        originalText: source.text,
        fontSize,
        fontFamily: 5,
        textAlign: 'left',
        verticalAlign: 'top',
        containerId: null,
        autoResize: true,
        lineHeight: 1.25,
        width: Math.max(...metrics.lines.map((line) => line.length), 1) * fontSize * 0.54,
        height: metrics.lines.length * metrics.lineHeight,
      });
      continue;
    }
    if (source.type === 'arrow') {
      elements.push({
        ...element,
        points: source.points,
        lastCommittedPoint: null,
        startBinding: source.startBinding ?? null,
        endBinding: source.endBinding ?? null,
        startArrowhead: source.startArrowhead ?? null,
        endArrowhead: source.endArrowhead ?? 'arrow',
        elbowed: false,
      });
    } else {
      const labelId = source.label ? `${source.id}-label` : null;
      elements.push({
        ...element,
        boundElements: labelId ? [{ id: labelId, type: 'text' }] : null,
      });
    }
    if (source.label) {
      const fontSize = source.label.fontSize ?? 18;
      const metrics = textMetrics(source.label.text, fontSize, Math.max(40, source.width - 24));
      const height = metrics.lines.length * metrics.lineHeight;
      elements.push({
        ...common({
          type: 'text',
          id: `${source.id}-label`,
          x: source.x + 12,
          y: source.y + (source.height - height) / 2,
          width: source.width - 24,
          height,
          strokeColor: '#1e1e1e',
        }),
        text: metrics.lines.join('\n'),
        originalText: source.label.text,
        fontSize,
        fontFamily: 5,
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: source.id,
        autoResize: false,
        lineHeight: 1.25,
      });
    }
  }
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://mcp.excalidraw.com',
    elements,
    appState: { gridSize: 20, viewBackgroundColor: BG },
    files: {},
  };
}

function svgText(x, y, width, height, value, fontSize, color = '#1e1e1e', centered = true) {
  const { lines, lineHeight } = textMetrics(value, fontSize, Math.max(40, width));
  const startY = centered
    ? y + (height - lines.length * lineHeight) / 2 + fontSize
    : y + fontSize;
  const textX = centered ? x + width / 2 : x;
  const anchor = centered ? 'middle' : 'start';
  return `<text x="${textX}" y="${startY}" text-anchor="${anchor}" fill="${color}" font-family="Virgil, Segoe Print, cursive" font-size="${fontSize}" font-weight="600">${lines.map((line, i) => `<tspan x="${textX}" dy="${i ? lineHeight : 0}">${esc(line)}</tspan>`).join('')}</text>`;
}

function svgShape(element) {
  const style = `fill="${element.backgroundColor ?? 'transparent'}" stroke="${element.strokeColor ?? '#1e1e1e'}" stroke-width="${element.strokeWidth ?? 2}"${element.strokeStyle === 'dashed' ? ' stroke-dasharray="10 7"' : ''} opacity="${(element.opacity ?? 100) / 100}" filter="url(#rough)"`;
  if (element.type === 'ellipse') {
    return `<ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" ${style}/>`;
  }
  if (element.type === 'diamond') {
    const points = [
      [element.x + element.width / 2, element.y],
      [element.x + element.width, element.y + element.height / 2],
      [element.x + element.width / 2, element.y + element.height],
      [element.x, element.y + element.height / 2],
    ].map((point) => point.join(',')).join(' ');
    return `<polygon points="${points}" ${style}/>`;
  }
  return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="14" ${style}/>`;
}

function arrowLabel(element) {
  if (!element.label) return '';
  const points = element.points;
  const first = points[0];
  const last = points.at(-1);
  const middle = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
  return svgText(element.x + middle[0] - 90, element.y + middle[1] - 32, 180, 24, element.label.text, element.label.fontSize ?? 14, element.strokeColor ?? '#1e1e1e');
}

function toSvg(scene) {
  const body = [];
  for (const element of scene) {
    if (element.type === 'cameraUpdate') continue;
    if (element.type === 'text') {
      body.push(svgText(element.x, element.y, 1000, 36, element.text, element.fontSize ?? 18, element.strokeColor, false));
      continue;
    }
    if (element.type === 'arrow') {
      const points = element.points.map(([x, y]) => `${element.x + x},${element.y + y}`).join(' ');
      body.push(`<polyline points="${points}" fill="none" stroke="${element.strokeColor ?? '#1e1e1e'}" stroke-width="${element.strokeWidth ?? 2.5}" stroke-linecap="round" stroke-linejoin="round"${element.strokeStyle === 'dashed' ? ' stroke-dasharray="9 7"' : ''} marker-end="url(#arrow)"/>${arrowLabel(element)}`);
      continue;
    }
    body.push(svgShape(element));
    if (element.label) body.push(svgText(element.x + 12, element.y + 8, element.width - 24, element.height - 16, element.label.text, element.label.fontSize ?? 18));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" role="img">
<defs>
  <filter id="rough" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="1" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="0.7"/></filter>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker>
</defs>
<rect width="1200" height="900" fill="${BG}"/>
${body.join('\n')}
</svg>\n`;
}

for (const [name, scene] of Object.entries(scenes)) {
  await writeFile(join(OUT, `${name}.excalidraw`), `${JSON.stringify(toExcalidraw(scene), null, 2)}\n`, 'utf8');
  await writeFile(join(OUT, `${name}.svg`), toSvg(scene), 'utf8');
}
