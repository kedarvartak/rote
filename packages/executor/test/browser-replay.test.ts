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
      company_name: 'Acme Tools',
      contact_email: 'ops@example.com',
      country: 'US',
    }, {
      toolCaller: new BrowserToolCaller(page),
      llmClient,
      envFingerprint: fakeEnvFingerprint(),
      taskSpec: 'Register Acme Tools',
      baseDir,
    });

    expect(result.outcome).toBe('success');
    expect(result.completedStepIds).toEqual([
      'open_registration', 'fill_company', 'fill_email', 'select_country', 'submit_registration',
    ]);
    expect(llmClient.callCount).toBe(0);
    expect(page.submitted).toBe(true);
  });
});

class StatefulB2Page implements BrowserReplayPage {
  url = 'about:blank';
  values = new Map<string, string>();
  submitted = false;

  async navigate(url: string): Promise<void> { this.url = url; }
  async fill(selector: string, value: string): Promise<void> { this.values.set(selector, value); }
  async select(selector: string, value: string): Promise<void> { this.values.set(selector, value); }
  async click(selector: string): Promise<void> {
    if (selector === '#registration-submit') {
      this.submitted = true;
      this.url = 'https://fixture.test/b2-vendor-form.html#complete';
    }
  }
  async capture() {
    const company = this.values.get('#company-name') ?? '';
    const email = this.values.get('#contact-email') ?? '';
    return {
      url: this.url,
      title: 'Vendor Registration',
      html: '',
      elements: [
        { tag: 'form', attributes: { id: 'registration-form', ...(this.submitted ? { hidden: 'true' } : {}) }, text: '', depth: 0 },
        { tag: 'input', attributes: { id: 'company-name', value: company }, text: '', depth: 1 },
        { tag: 'input', attributes: { id: 'contact-email', value: email }, text: '', depth: 1 },
        { tag: 'select', attributes: { id: 'country', value: this.values.get('#country') ?? 'US' }, text: '', depth: 1 },
        { tag: 'button', attributes: { id: 'registration-submit', ...(this.submitted ? { hidden: 'true' } : {}) }, text: 'Submit registration', depth: 1 },
        { tag: 'h2', attributes: { id: 'confirmation', ...(this.submitted ? {} : { hidden: 'true' }) }, text: 'Vendor registration complete', depth: 1 },
        { tag: 'p', attributes: { ...(this.submitted ? {} : { hidden: 'true' }) }, text: `Company: ${company}`, depth: 1 },
        { tag: 'p', attributes: { ...(this.submitted ? {} : { hidden: 'true' }) }, text: `Email: ${email}`, depth: 1 },
      ],
    };
  }
}
