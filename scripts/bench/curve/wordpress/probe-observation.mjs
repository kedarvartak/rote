import { readFileSync } from 'node:fs';
import { LaunchingCdpBrowserBackend } from '../../../../packages/browser/src/index.ts';
import { distillPage, renderObservation } from '../../../../packages/perception/src/index.ts';

const localEnv = Object.fromEntries(
  readFileSync(new URL('.env', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split('=', 2)),
);
const username = localEnv['ROTE_CURVE_WP_ADMIN_USER'];
const password = localEnv['ROTE_CURVE_WP_ADMIN_PASSWORD'];
if (!username || !password) throw new Error('run start.sh before the observation probe');

const repetitions = Number.parseInt(process.argv[2] ?? '15', 10);
if (!Number.isInteger(repetitions) || repetitions < 1) {
  throw new Error('usage: node probe-observation.mjs [positive-repetitions]');
}

const samples = [];
// One unmeasured session initializes WordPress's per-user admin state. Measured
// repetitions still each receive a fresh browser and page session.
for (let repetition = 0; repetition <= repetitions; repetition += 1) {
  const backend = new LaunchingCdpBrowserBackend();
  try {
    const page = await backend.openPage();
    await page.navigate('http://127.0.0.1:18081/wp-login.php');
    await page.fill('#user_login', username);
    await page.fill('#user_pass', password);
    await page.click('#wp-submit');
    await sleep(750);
    await page.navigate('http://127.0.0.1:18081/wp-admin/edit.php');
    // The admin footer/menu is enhanced after load; sample after that deterministic
    // client-side pass rather than racing it on the first cold browser session.
    await sleep(750);
    const captured = await page.capture();
    const nodes = distillPage(captured);
    const rendered = renderObservation(nodes, { maxChars: Number.MAX_SAFE_INTEGER });
    if (repetition === 0) continue;
    samples.push({
      repetition,
      url: captured.url,
      captured_elements: captured.elements.length,
      distilled_nodes: nodes.length,
      rendered_chars: rendered.text.length,
      approximate_tokens: rendered.approxTokens,
      actionable_nodes: nodes.filter((node) => node.interactive && node.selectorHint).length,
    });
  } finally {
    await backend.close();
  }
}

const tokenCounts = samples.map((sample) => sample.approximate_tokens);
console.log(JSON.stringify({
  schema_version: 1,
  units: { rendered_chars: 'characters', approximate_tokens: 'ceil(characters / 4)' },
  page: 'WordPress 6.8.2 /wp-admin/edit.php with 120 seeded posts and 100 rows per page',
  repetitions,
  unmeasured_warmup_sessions: 1,
  summary: {
    min_approximate_tokens: Math.min(...tokenCounts),
    max_approximate_tokens: Math.max(...tokenCounts),
    range_approximate_tokens: Math.max(...tokenCounts) - Math.min(...tokenCounts),
  },
  samples,
}, null, 2));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
