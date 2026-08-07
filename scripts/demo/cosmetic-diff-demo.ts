/**
 * Cosmetic-drift demo: why a full visual redesign costs Rote ~6 tokens.
 *
 * Runs the production perception pipeline (distillPage → renderAdaptiveObservation)
 * on three versions of one page — original, fully restyled, restyled-plus-real-change —
 * and prints exactly what the planner would see at each step. No mocks, no fixtures
 * prepared offline: edit the HTML below and rerun to try your own drift.
 *
 *   npx tsx scripts/demo/cosmetic-diff-demo.ts
 *
 * The claim being demonstrated (docs/02-architecture.md "Tier 0 — working memory"):
 * the distiller discards styling before the diff runs, so cosmetic drift produces a
 * zero-delta diff by construction, while a real change surfaces as exactly one line.
 */
import { captureStaticHtml } from '@rote/browser';
import { distillPage, renderAdaptiveObservation } from '@rote/perception';

// Act 1 — the page a run was grounded against.
const v1 = captureStaticHtml('mem://demo', `
  <h2>Vendor registration</h2>
  <label for="company">Company name</label><input id="company" name="company" />
  <label for="country">Country</label><select id="country" name="country"><option>India</option></select>
  <button id="submit" class="btn">Submit registration</button>
  <p>All fields are required.</p>
`);

// Act 2 — same page after a full cosmetic redesign: new classes everywhere,
// inline colors/fonts, and a translucent button (opacity:0.85 — the value shape
// that vanished from observations before #138's parse fix).
const v2 = captureStaticHtml('mem://demo', `
  <h2 class="font-display text-3xl tracking-tight">Vendor registration</h2>
  <label for="company" class="text-slate-500 uppercase text-xs">Company name</label><input id="company" name="company" class="rounded-xl ring-2 ring-indigo-500 shadow-lg" style="font-family:Inter;color:#334155" />
  <label for="country" class="text-slate-500 uppercase text-xs">Country</label><select id="country" name="country" class="rounded-xl bg-slate-50"><option>India</option></select>
  <button id="submit" class="bg-indigo-600 text-white rounded-full px-6 shadow-xl" style="opacity:0.85; letter-spacing:0.02em">Submit registration</button>
  <p style="color:#94a3b8; font-size:12px">All fields are required.</p>
`);

// Act 3 — a real change hiding inside another restyle: a new required field.
// (Appended last: the static fixture parser's depth heuristic counts open tags,
// so mid-document insertion would fake identity churn the CDP backend never sees.)
const v3 = captureStaticHtml('mem://demo', `
  <h2 class="font-serif">Vendor registration</h2>
  <label for="company">Company name</label><input id="company" name="company" class="input-v3" />
  <label for="country">Country</label><select id="country" name="country" class="select-v3"><option>India</option></select>
  <button id="submit" style="background:teal">Submit registration</button>
  <p>All fields are required.</p>
  <label for="tax">Tax ID</label><input id="tax" name="tax" class="input-v3" />
`);

const [n1, n2, n3] = [v1, v2, v3].map((page) => distillPage(page));
// A tight budget makes the demo behave like a real long page: the first grounded
// snapshot is paid explicitly (bootstrap), every later step must earn diff mode.
const BUDGET = 150;
const full = renderAdaptiveObservation(n1!, { maxChars: BUDGET });
console.log(`=== Step 1: grounded observation (mode=${full.mode}, the diff base) ===`);
console.log(full.text);
console.log(`[${full.text.length} chars, ~${full.approxTokens} tokens]\n`);

const restyle = renderAdaptiveObservation(n2!, { maxChars: BUDGET, previousNodes: n1! });
console.log(`=== Step 2: after the full cosmetic redesign (mode=${restyle.mode}) ===`);
console.log(restyle.text);
console.log(`[${restyle.text.length} chars, ~${restyle.approxTokens} tokens — identical stable IDs: ${n1!.every((n, i) => n.id.hash === n2![i]?.id.hash)}]\n`);

const real = renderAdaptiveObservation(n3!, { maxChars: BUDGET, previousNodes: n1! });
console.log('=== Step 3: a real change (new required field) inside another restyle ===');
console.log(`(mode=${real.mode})`);
console.log(real.text);
console.log(`[~${real.approxTokens} tokens — the restyle is silent, the new control is not]`);
