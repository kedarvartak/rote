import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlaybookYaml } from '@rote/core';

const fields = [
  ['company-name', 'company_name', 'Northwind Supply'],
  ['contact-email', 'contact_email', 'ap@northwind.test'],
  ['tax-id', 'tax_id', '84-1129930'],
  ['address-line1', 'address_line1', '18 Harbor Way'],
  ['city', 'city', 'Portland'],
  ['postal-code', 'postal_code', '97209'],
  ['country', 'country', 'US'],
  ['phone', 'phone', '503-555-0148'],
] as const;

describe('invariant: B2 success proves every requested field', () => {
  it('pins a composite live-page oracle containing every exact field value', async () => {
    const config = JSON.parse(await readFile(resolve('../../scripts/bench/headhead/tasks.json'), 'utf8')) as {
      protocol_id: string;
      tasks: Array<{ id: string; verify_text: string }>;
    };
    const b2 = config.tasks.find((task) => task.id === 'B2')!;

    expect(config.protocol_id).toBe('p1-g2-fixtures-v2-b2-exact');
    expect(b2.verify_text).not.toBe('Vendor registration complete');
    for (const [, key, value] of fields) expect(b2.verify_text).toContain(`${key}=${value}`);
  });

  it('requires all eight controls before rendering the exact summary', async () => {
    const html = await readFile(resolve('../../fixtures/sites/b2-vendor-form.html'), 'utf8');
    for (const [id, key] of fields) {
      expect(html).toMatch(new RegExp(`<(?:input|select) id="${id}"[^>]*required`));
      expect(html).toContain(`${key}=\${fields.${key}}`);
    }
    expect(html).toContain("Object.values(fields).some((value) => !value)");
  });

  it('confirms the historical Rote side entered all values while leaving Browser Use uncertified', async () => {
    const lines = (await readFile(resolve('../../docs/testing/data/T13-g2-rote-trajectories.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as { run_id: string; args: Record<string, unknown> })
      .filter((event) => event.run_id.includes('-b2-'));
    const runs = new Map<string, Map<string, unknown>>();
    for (const event of lines) {
      const values = runs.get(event.run_id) ?? new Map<string, unknown>();
      runs.set(event.run_id, values);
      if (event.args['kind'] === 'fill' || event.args['kind'] === 'select') {
        values.set(String(event.args['selector']), event.args['value']);
      }
    }
    expect(runs.size).toBe(18);
    for (const values of runs.values()) {
      for (const [id, , value] of fields) expect(values.get(`#${id}`)).toBe(value);
    }
  });

  it('binds and verifies every requested field in zero-model replay', async () => {
    const playbook = parsePlaybookYaml(
      await readFile(resolve('../../fixtures/playbooks/browser-b2-stateful.yaml'), 'utf8'),
    );
    expect(playbook.params.map((param) => param.name)).toEqual(['base_url', ...fields.map(([, key]) => key)]);
    expect(playbook.verify).toEqual([{
      text_visible: 'Vendor registration complete | company_name={{company_name}} | contact_email={{contact_email}} | tax_id={{tax_id}} | address_line1={{address_line1}} | city={{city}} | postal_code={{postal_code}} | country={{country}} | phone={{phone}}',
    }]);
  });
});
