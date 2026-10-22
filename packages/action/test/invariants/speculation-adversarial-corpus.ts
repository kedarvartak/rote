import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { captureStaticHtml } from '@rote/browser';
import { distillPage } from '@rote/perception';
import type { ActionContract } from '@rote/core';
import { deriveActionContract } from '../../src/action-contract-gate.js';
import type { SpeculationInput, SpeculationReason } from '../../src/speculation-fence.js';

// The adversarial corpus for P3 issue #192: "the adversarial suite demonstrates
// zero speculated server-mutating calls for forms, downloads, uploads,
// drag/drop, redirects, cross-origin navigation, stale contexts, contract
// mismatch, and ambiguous targets."
//
// Cases marked `frozen_fixture` derive their contract from the real fixture HTML
// through the same capture → distill → derive path a live run uses, so they
// describe controls that actually exist rather than contracts imagined to be
// dangerous. The rest are constructed, because no frozen fixture exercises them
// yet; each says so, so a reader can tell evidence from illustration.

/** The nine categories #192 requires the suite to cover. */
export const ADVERSARIAL_CATEGORIES = [
  'form',
  'download',
  'upload',
  'drag_drop',
  'redirect',
  'cross_origin_nav',
  'stale_context',
  'contract_mismatch',
  'ambiguous_target',
] as const;
export type AdversarialCategory = (typeof ADVERSARIAL_CATEGORIES)[number];

export interface AdversarialCase {
  id: string;
  category: AdversarialCategory;
  origin: 'frozen_fixture' | 'constructed';
  /** Why this must never be speculated, in one line. */
  hazard: string;
  input: SpeculationInput;
  expectedReason: SpeculationReason;
}

/** Digest of a page the caller has affirmed is same-origin and not a download. */
const SAME_ORIGIN = '1'.repeat(16);
const DOWNLOAD = '2'.repeat(16);
const OFFSITE = '3'.repeat(16);

async function fixtureContract(file: string, selector: string, verb: ActionContract['verb'] = 'click'): Promise<ActionContract> {
  const html = await readFile(resolve(`../../fixtures/sites/${file}`), 'utf8');
  const nodes = distillPage(captureStaticHtml(`http://127.0.0.1:8080/${file}`, html));
  const node = nodes.find((candidate) => candidate.selectorHint === selector);
  if (!node) throw new Error(`fixture ${file} has no ${selector}; the corpus must describe controls that exist`);
  return deriveActionContract({ verb, node });
}

function constructed(overrides: Partial<ActionContract> & { affordance?: Partial<ActionContract['affordance']> }): ActionContract {
  const { affordance, ...rest } = overrides;
  return {
    version: 1,
    verb: 'click',
    target: { role: 'button', name: 'Continue' },
    affordance: { control: 'button', enter_behavior: 'none', draggable: false, ...affordance },
    safety: 'potentially_mutating',
    preconditions: { visible: true, enabled: true },
    ...rest,
  } as ActionContract;
}

const destinations = { knownSameOriginDestinations: [SAME_ORIGIN], downloadDestinations: [DOWNLOAD] };

/** Builds the corpus. Async because fixture-derived cases read the frozen HTML. */
export async function adversarialCorpus(): Promise<AdversarialCase[]> {
  const b2Submit = await fixtureContract('b2-vendor-form.html', '#registration-submit');
  const purgeSubmit = await fixtureContract('drift/b2-contract-destructive.html', '#registration-submit');
  const offboardSubmit = await fixtureContract('b6-vendor-offboarding.html', '#registration-submit');
  const textareaFill = await fixtureContract('drift/b2-contract-textarea.html', '#company-name', 'fill');

  return [
    {
      id: 'b2-registration-submit',
      category: 'form',
      origin: 'frozen_fixture',
      hazard: 'submitting the vendor form registers a vendor nobody asked to register',
      input: { contract: b2Submit, ...destinations },
      expectedReason: 'submit_control',
    },
    {
      id: 'b2-purge-submit-post',
      category: 'form',
      origin: 'frozen_fixture',
      hazard: 'the same-looking control posts a purge; this is the control the action-contract gate was built for',
      input: { contract: purgeSubmit, ...destinations },
      expectedReason: 'form_method_mutating',
    },
    {
      id: 'b6-offboarding-submit',
      category: 'form',
      origin: 'frozen_fixture',
      // B6's form posts, so the form-method rule catches it one step before the
      // submit-control rule would have. Two independent rules refuse it.
      hazard: 'B6 looks like B2 and offboards a vendor instead of registering one',
      input: { contract: offboardSubmit, ...destinations },
      expectedReason: 'form_method_mutating',
    },
    {
      id: 'download-link',
      category: 'download',
      origin: 'constructed',
      hazard: 'a speculated download writes a file and can bill an egress-metered endpoint',
      input: { contract: constructed({ affordance: { control: 'link', destination_hash: DOWNLOAD } }), ...destinations },
      expectedReason: 'download_destination',
    },
    {
      id: 'file-upload',
      category: 'upload',
      origin: 'constructed',
      hazard: 'an upload transfers bytes to a server; its entire purpose is the side effect',
      input: { contract: constructed({ verb: 'upload', safety: 'mutating', affordance: { control: 'file' } }), ...destinations },
      expectedReason: 'mutating_verb',
    },
    {
      id: 'drag-and-drop',
      category: 'drag_drop',
      origin: 'constructed',
      hazard: 'a drag commits a reordering or a transfer the user never confirmed',
      input: { contract: constructed({ verb: 'dragAndDrop', safety: 'mutating', affordance: { control: 'generic', draggable: true } }), ...destinations },
      expectedReason: 'mutating_verb',
    },
    {
      id: 'redirect-to-unknown-destination',
      category: 'redirect',
      origin: 'constructed',
      hazard: 'a link whose destination the caller never affirmed may redirect anywhere, including off-site',
      input: { contract: constructed({ affordance: { control: 'link', destination_hash: OFFSITE } }), ...destinations },
      expectedReason: 'cross_origin_destination',
    },
    {
      id: 'link-without-destination',
      category: 'redirect',
      origin: 'constructed',
      hazard: 'a control with no derivable destination is unknowable, and unknown is not safe',
      input: { contract: constructed({ affordance: { control: 'link' } }), ...destinations },
      expectedReason: 'unknown_destination',
    },
    {
      id: 'cross-origin-navigation',
      category: 'cross_origin_nav',
      origin: 'constructed',
      hazard: 'navigating off-origin leaves the environment the fingerprint gate proved',
      input: { contract: constructed({ verb: 'navigate', safety: 'navigation', affordance: { control: 'generic', destination_hash: OFFSITE } }), ...destinations },
      expectedReason: 'cross_origin_destination',
    },
    {
      id: 'stale-document-generation',
      category: 'stale_context',
      origin: 'constructed',
      hazard: 'the document remounted; this contract describes a control that may no longer be there',
      input: {
        contract: constructed({ verb: 'hover', safety: 'read' }),
        recordedDocumentGeneration: 7,
        currentDocumentGeneration: 8,
        ...destinations,
      },
      expectedReason: 'stale_document',
    },
    {
      id: 'contract-drifted-textarea',
      category: 'contract_mismatch',
      origin: 'frozen_fixture',
      hazard: 'the live control is a textarea where the recording saw a single-line input; behaviour changed under the same identity',
      input: { contract: textareaFill, contractMismatch: true, ...destinations },
      expectedReason: 'contract_mismatch',
    },
    {
      id: 'ambiguous-target',
      category: 'ambiguous_target',
      origin: 'constructed',
      hazard: 'resolution left more than one candidate, so the action might land on the wrong control',
      input: { contract: constructed({ verb: 'hover', safety: 'read' }), targetAmbiguous: true, ...destinations },
      expectedReason: 'ambiguous_target',
    },
  ];
}
