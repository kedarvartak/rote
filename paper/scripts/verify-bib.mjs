// Checks every @inproceedings/@article entry in rote.bib against DBLP, because
// the bibliography was written from memory and a wrong venue or year is the
// cheapest kind of reviewer-visible error. Software (@misc) entries are skipped:
// DBLP does not index repositories, and their claim is a URL, not a publication.
//
// Usage: node paper/scripts/verify-bib.mjs [--json]
// Exit code is 1 when any entry disagrees with DBLP or could not be checked.
//
// Verified findings are merged into `paper/bib-verification.json` and reused on
// the next run. DBLP rate-limits aggressively and drops connections, and a
// transient failure must not look like a corrected entry — so a run only ever
// upgrades the report, never downgrades a previously verified entry to an error.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BIB = fileURLToPath(new URL('../rote.bib', import.meta.url));
const REPORT = fileURLToPath(new URL('../bib-verification.json', import.meta.url));
const DBLP = 'https://dblp.org/search/publ/api';

/** Splits the .bib into entries without a full parser: fields we check are single-line. */
function parseEntries(text) {
  const entries = [];
  const blocks = text.split(/^@/m).slice(1);
  for (const block of blocks) {
    const type = block.slice(0, block.indexOf('{')).trim().toLowerCase();
    const key = block.slice(block.indexOf('{') + 1, block.indexOf(',')).trim();
    const field = (name) => {
      const match = new RegExp(`^\\s*${name}\\s*=\\s*\\{([\\s\\S]*?)\\},?\\s*$`, 'mi').exec(block);
      return match ? match[1].replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() : undefined;
    };
    entries.push({ type, key, title: field('title'), year: field('year'), booktitle: field('booktitle'), journal: field('journal') });
  }
  return entries;
}

// DBLP titles carry HTML entities and a trailing period; decode before stripping
// so "&amp;" does not survive as the literal word "amp" and fake a mismatch.
const normalize = (value) => (value ?? '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** DBLP rate-limits hard (429/503) and drops connections; back off rather than reporting a false mismatch. */
async function fetchWithBackoff(url, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      if (response.status !== 429 && response.status !== 503) throw new Error(`dblp ${response.status}`);
      lastError = new Error(`dblp ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(2000 * attempt);
  }
  throw lastError ?? new Error('dblp unreachable');
}

async function lookup(title) {
  const url = `${DBLP}?q=${encodeURIComponent(title)}&format=json&h=5`;
  const response = await fetchWithBackoff(url);
  const body = await response.json();
  const hits = body?.result?.hits?.hit ?? [];
  const wanted = normalize(title);
  // Prefer an exact title match; DBLP ranks loosely and the top hit can be a
  // different paper that merely shares words.
  const exact = hits.find((hit) => normalize(hit.info?.title) === wanted);
  return (exact ?? hits[0])?.info;
}

const text = await readFile(BIB, 'utf8');
const entries = parseEntries(text).filter((entry) => entry.type !== 'misc' && entry.title);

/** Previously verified findings, keyed by bib key; only `ok`/`check` results are trusted. */
let previous = {};
try {
  const prior = JSON.parse(await readFile(REPORT, 'utf8'));
  for (const finding of prior.findings ?? []) {
    // Only clean results are reused; a 'check' is re-queried so a fix is seen.
    if (finding.status === 'ok') previous[finding.key] = finding;
  }
} catch {
  previous = {};
}

const findings = [];

for (const entry of entries) {
  // A title edit invalidates a cached finding; anything else reuses it.
  const cached = previous[entry.key];
  if (cached && normalize(cached.dblp_title ?? '') === normalize(entry.title) && cached.claimed_year === entry.year) {
    findings.push(cached);
    continue;
  }
  let info;
  try {
    info = await lookup(entry.title);
  } catch (error) {
    findings.push({ key: entry.key, status: 'lookup_failed', detail: String(error) });
    continue;
  }
  if (!info) {
    findings.push({ key: entry.key, status: 'not_found', detail: entry.title });
    continue;
  }
  const titleMatches = normalize(info.title) === normalize(entry.title);
  const dblpYear = String(info.year ?? '');
  const dblpVenue = String(info.venue ?? '');
  const claimedVenue = entry.booktitle ?? entry.journal ?? '';
  // A venue "match" is deliberately loose: bib entries spell venues out while
  // DBLP abbreviates, so this reports the pair for a human rather than judging.
  findings.push({
    key: entry.key,
    status: titleMatches && dblpYear === entry.year ? 'ok' : 'check',
    title_matches: titleMatches,
    claimed_year: entry.year,
    dblp_year: dblpYear,
    claimed_venue: claimedVenue,
    dblp_venue: dblpVenue,
    dblp_title: info.title,
  });
  await sleep(1500); // be polite to dblp
}

await writeFile(REPORT, `${JSON.stringify({
  checked_at_utc_date: new Date().toISOString().slice(0, 10),
  source: 'https://dblp.org/search/publ/api',
  note: 'Title and year are compared exactly; venue strings are reported for a human because bib entries spell venues out and DBLP abbreviates. @misc software entries are not indexed by DBLP and are excluded.',
  findings,
}, null, 2)}\n`, 'utf8');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  for (const finding of findings) {
    if (finding.status === 'ok') {
      console.log(`ok      ${finding.key} (${finding.dblp_year}, ${finding.dblp_venue})`);
    } else if (finding.status === 'check') {
      console.log(`CHECK   ${finding.key}: claimed ${finding.claimed_year} "${finding.claimed_venue}" | dblp ${finding.dblp_year} "${finding.dblp_venue}"${finding.title_matches ? '' : ` | dblp title: "${finding.dblp_title}"`}`);
    } else {
      console.log(`${finding.status.toUpperCase()} ${finding.key}: ${finding.detail}`);
    }
  }
}
const bad = findings.filter((finding) => finding.status !== 'ok');
console.log(`\n${findings.length - bad.length}/${findings.length} entries agree with DBLP on title and year.`);
process.exit(bad.length > 0 ? 1 : 0);
