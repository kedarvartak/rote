import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { captureStaticHtml } from '@rote/browser';
import { distillPage, stableNodeRef, StableNodeIdSchema, StableNodeIdV2Schema } from '../src/index.js';

function buttons(html: string) {
  return distillPage(captureStaticHtml('mem://identity-v2', html)).filter((node) => node.role === 'button');
}

function row(key: string, selector: string, wrapper = ''): string {
  return `<tr data-row-key="${key}"><th>${key}</th><td>${wrapper}<button aria-label="Approve invoice" data-rote-selector="${selector}">Approve</button></td></tr>`;
}

describe('stable target identity v2', () => {
  it('distinguishes repeated controls by stable container lineage', () => {
    const nodes = buttons(`<table><tbody>${row('invoice-1041', '#approve-1041')}${row('invoice-1042', '#approve-1042')}</tbody></table>`);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.id.hash).not.toBe(nodes[1]?.id.hash);
    expect(nodes.every((node) => StableNodeIdV2Schema.safeParse(node.id).success)).toBe(true);
    expect(nodes.every((node) => stableNodeRef(node.id).startsWith('v2:'))).toBe(true);
  });

  it('survives reorder, non-semantic insertion, remount, and selector rename', () => {
    const before = buttons(`<table><tbody>${row('invoice-1041', '#old')}${row('invoice-1042', '#other')}</tbody></table>`);
    const after = buttons(`<div>cosmetic wrapper</div><table><tbody>${row('invoice-1042', '#other-v2')}${row('invoice-1041', '#new', '<div class="layout-only">')}</tbody></table>`);
    const beforeByName = new Map(before.map((node) => [node.selectorHint, node.id]));
    const afterTarget = after.find((node) => node.selectorHint === '#new');

    expect(afterTarget?.id).toEqual(beforeByName.get('#old'));
  });

  it('is stable for arbitrary row reorder, generic insertion, and selector rename', () => {
    fc.assert(fc.property(
      fc.uniqueArray(fc.integer({ min: 1, max: 100_000 }), { minLength: 2, maxLength: 12 }),
      (keys) => {
        const before = buttons(`<table><tbody>${keys.map((key) => row(`invoice-${key}`, `#old-${key}`)).join('')}</tbody></table>`);
        const after = buttons(`<div>layout insertion</div><table><tbody>${[...keys].reverse().map((key) => row(`invoice-${key}`, `#new-${key}`, '<div>')).join('')}</tbody></table>`);
        const beforeByKey = new Map(keys.map((key, index) => [key, before[index]!.id]));
        const afterByKey = new Map([...keys].reverse().map((key, index) => [key, after[index]!.id]));
        expect(afterByKey).toEqual(beforeByKey);
      },
    ));
  });

  it('changes identity when a virtualized slot is rebound to a different logical row', () => {
    const first = buttons(`<section aria-label="Virtual approvals" data-row-key="invoice-2001"><button aria-label="Approve invoice">Approve</button></section>`)[0]!;
    const remountedSame = buttons(`<section aria-label="Virtual approvals" data-row-key="invoice-2001"><div><button id="new-node" aria-label="Approve invoice">Approve</button></div></section>`)[0]!;
    const rebound = buttons(`<section aria-label="Virtual approvals" data-row-key="invoice-2002"><button aria-label="Approve invoice">Approve</button></section>`)[0]!;

    expect(remountedSame.id).toEqual(first.id);
    expect(rebound.id.hash).not.toBe(first.id.hash);
  });

  it('keeps semantic identity through harmless id and machine-name renames', () => {
    const before = distillPage(captureStaticHtml('mem://rename', '<label for="old">Contact email</label><input id="old" name="legacy_email">'))[0]!;
    const after = distillPage(captureStaticHtml('mem://rename', '<label for="new">Contact email</label><input id="new" name="renamed_email">'))[0]!;

    expect(after.name).toBe('Contact email');
    expect(after.id).toEqual(before.id);
  });

  it('keeps historical v1 identities parseable without upgrading them in place', () => {
    const historical = { hash: 'aaaaaaaaaaaaaaaa' };

    expect(StableNodeIdSchema.parse(historical)).toEqual(historical);
    expect(stableNodeRef(historical)).toBe('aaaaaaaaaaaaaaaa');
  });
});
