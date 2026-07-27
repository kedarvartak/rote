import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePlaybookYaml } from '@rote/core';
import { BrowserToolCaller, runPlaybook, type BrowserReplayPage } from '../src/index.js';
import { FakeLlmClient, completion } from './helpers/fake-llm-client.js';
import { fakeEnvFingerprint } from './helpers/fixtures.js';

let baseDir: string | undefined;

afterEach(async () => {
  if (baseDir) await rm(baseDir, { recursive: true, force: true });
  baseDir = undefined;
});

describe('verified browser replay', () => {
  it('replays the stateful B2 playbook with zero LLM calls and passes final verification', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-browser-replay-'));
    const playbook = parsePlaybookYaml(
      await readFile(resolve('../../fixtures/playbooks/browser-b2-stateful.yaml'), 'utf8'),
    );
    const page = new StatefulB2Page();
    const llmClient = new FakeLlmClient(() => completion('unused'));

    const result = await runPlaybook(playbook, {
      base_url: 'https://fixture.test',
      initial_url: 'https://fixture.test/b2-vendor-form.html',
      company_name: 'Acme Tools',
      contact_email: 'ops@example.com',
      tax_id: '84-1129930',
      address_line1: '18 Harbor Way',
      city: 'Portland',
      postal_code: '97209',
      country: 'US',
      phone: '503-555-0148',
    }, {
      toolCaller: new BrowserToolCaller(page),
      llmClient,
      envFingerprint: fakeEnvFingerprint(),
      taskSpec: 'Register Acme Tools',
      baseDir,
    });

    expect(result.outcome).toBe('success');
    expect(result.completedStepIds).toEqual([
      'open_registration', 'fill_company', 'fill_email', 'fill_tax_id', 'fill_address',
      'fill_city', 'fill_postal_code', 'select_country', 'fill_phone', 'submit_registration',
    ]);
    expect(llmClient.callCount).toBe(0);
    expect(page.submitted).toBe(true);
  });
});

const REQUIRED_SELECTORS = [
  '#company-name', '#contact-email', '#tax-id', '#address-line1',
  '#city', '#postal-code', '#country', '#phone',
];

class StatefulB2Page implements BrowserReplayPage {
  url = 'about:blank';
  values = new Map<string, string>();
  submitted = false;

  async navigate(url: string): Promise<void> { this.url = url; }
  async fill(selector: string, value: string): Promise<void> { this.values.set(selector, value); }
  async select(selector: string, value: string): Promise<void> { this.values.set(selector, value); }
  async click(selector: string): Promise<void> {
    if (selector === '#registration-submit' && REQUIRED_SELECTORS.every((required) => this.values.get(required))) {
      this.submitted = true;
      this.url = 'https://fixture.test/b2-vendor-form.html#complete';
    }
  }
  async capture() {
    const company = this.values.get('#company-name') ?? '';
    const email = this.values.get('#contact-email') ?? '';
    const summary = `Vendor registration complete | company_name=${company} | contact_email=${email} | tax_id=${this.values.get('#tax-id') ?? ''} | address_line1=${this.values.get('#address-line1') ?? ''} | city=${this.values.get('#city') ?? ''} | postal_code=${this.values.get('#postal-code') ?? ''} | country=${this.values.get('#country') ?? ''} | phone=${this.values.get('#phone') ?? ''}`;
    return {
      url: this.url,
      title: 'Vendor Registration',
      html: '',
      elements: [
        { tag: 'form', attributes: { id: 'registration-form', ...(this.submitted ? { hidden: 'true' } : {}) }, text: '', depth: 0 },
        { tag: 'input', attributes: { id: 'company-name', 'aria-label': 'Company name', value: company }, text: '', depth: 1 },
        { tag: 'input', attributes: { id: 'contact-email', 'aria-label': 'Contact email', value: email }, text: '', depth: 1 },
        { tag: 'input', attributes: { id: 'tax-id', 'aria-label': 'Tax ID', value: this.values.get('#tax-id') ?? '' }, text: '', depth: 1 },
        { tag: 'input', attributes: { id: 'address-line1', 'aria-label': 'Address line 1', value: this.values.get('#address-line1') ?? '' }, text: '', depth: 1 },
        { tag: 'input', attributes: { id: 'city', 'aria-label': 'City', value: this.values.get('#city') ?? '' }, text: '', depth: 1 },
        { tag: 'input', attributes: { id: 'postal-code', 'aria-label': 'Postal code', value: this.values.get('#postal-code') ?? '' }, text: '', depth: 1 },
        { tag: 'select', attributes: { id: 'country', 'aria-label': 'Country', value: this.values.get('#country') ?? '' }, text: '', depth: 1 },
        { tag: 'input', attributes: { id: 'phone', 'aria-label': 'Phone', value: this.values.get('#phone') ?? '' }, text: '', depth: 1 },
        { tag: 'button', attributes: { id: 'registration-submit', ...(this.submitted ? { hidden: 'true' } : {}) }, text: 'Submit registration', depth: 1 },
        { tag: 'h2', attributes: { id: 'confirmation', ...(this.submitted ? {} : { hidden: 'true' }) }, text: 'Vendor registration complete', depth: 1 },
        { tag: 'p', attributes: { ...(this.submitted ? {} : { hidden: 'true' }) }, text: `Company: ${company}`, depth: 1 },
        { tag: 'p', attributes: { ...(this.submitted ? {} : { hidden: 'true' }) }, text: `Email: ${email}`, depth: 1 },
        { tag: 'p', attributes: { ...(this.submitted ? {} : { hidden: 'true' }) }, text: summary, depth: 1 },
      ],
    };
  }
}
