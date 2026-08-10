import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnterpriseFixtureServer } from '../src/enterprise-oracle.js';

let server: EnterpriseFixtureServer;

beforeEach(async () => {
  server = new EnterpriseFixtureServer(resolve('../../fixtures/enterprise'));
  await server.start();
});

afterEach(async () => {
  await server.close();
});

describe('enterprise authoritative fixture server', () => {
  it('resets atomically and returns task-bound exact state outside the DOM', async () => {
    const reset = await fetch(server.url('/api/reset'), { method: 'POST' });
    expect(reset.status).toBe(200);
    const initial = await reset.json() as { generation: number; events: unknown[] };
    expect(initial).toEqual(expect.objectContaining({ generation: 1, events: [] }));

    const event = {
      event_id: 'grid-invoice-1042',
      task_id: 'grid-contract',
      kind: 'grid_activated',
      target_key: 'invoice-1042',
      payload: { decision: 'approved' },
    };
    expect((await fetch(server.url('/api/events'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    })).status).toBe(201);

    const exact = await (await fetch(server.url('/api/oracle?task_id=grid-contract&generation=1'))).json();
    expect(exact).toEqual({
      generation: 1,
      task_id: 'grid-contract',
      events: [{
        event_id: event.event_id,
        task_id: event.task_id,
        kind: event.kind,
        target_key: event.target_key,
        payload_sha256: 'dd0397dbad6f6b07c4fd7e228ee5afca39dce5b038bf2781c3d251114ca79cd9',
      }],
      spa_transition_count: 0,
    });
    expect(JSON.stringify(exact)).not.toContain('approved');
    expect(await (await fetch(server.url('/api/oracle?task_id=other-task&generation=1'))).json()).toEqual({
      generation: 1,
      task_id: 'other-task',
      events: [],
      spa_transition_count: 0,
    });
  });

  it('rejects stale generations, duplicate events, and malformed evidence', async () => {
    await fetch(server.url('/api/reset'), { method: 'POST' });
    await fetch(server.url('/api/reset'), { method: 'POST' });
    expect((await fetch(server.url('/api/oracle?task_id=grid-contract&generation=1'))).status).toBe(409);

    const event = { event_id: 'same-event', task_id: 'grid-contract', kind: 'grid_activated', target_key: 'invoice-1042', payload: {} };
    expect((await postEvent(event)).status).toBe(201);
    expect((await postEvent(event)).status).toBe(409);
    expect((await postEvent({ ...event, event_id: 'bad id' })).status).toBe(400);
  });

  it('serves byte-stable fixtures on distinct origins with injected oracle routing', async () => {
    const [first, second, cross] = await Promise.all([
      fetch(server.url('/frame-host.html')).then((response) => response.text()),
      fetch(server.url('/frame-host.html')).then((response) => response.text()),
      fetch(server.crossOriginUrl('/frame-level-one.html?scope=cross')).then((response) => response.text()),
    ]);

    expect(first).toBe(second);
    expect(first).toContain(server.crossOriginUrl(''));
    expect(first).not.toContain('{{CROSS_ORIGIN}}');
    expect(cross).toContain('Nested frame level one');
    expect(new URL(server.url('/')).origin).not.toBe(new URL(server.crossOriginUrl('/')).origin);
  });
});

function postEvent(value: unknown): Promise<Response> {
  return fetch(server.url('/api/events'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
}
