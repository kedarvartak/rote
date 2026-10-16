import { afterEach, describe, expect, it } from 'vitest';
import { createGuiServer, type GuiServer } from './gui-server.js';

const servers: GuiServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });

describe('local GUI server', () => {
  it('serves the workspace with restrictive browser headers', async () => {
    const gui = await createGuiServer(async () => '', { openBrowser: false });
    servers.push(gui);
    const response = await fetch(gui.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await response.text()).toContain('What can I help you do?');
  });

  it('runs through the existing CLI path and restores the provider', async () => {
    process.env['ROTE_LLM_PROVIDER'] = 'openai';
    let received: string[] = [];
    let provider = '';
    const gui = await createGuiServer(async argv => {
      received = argv;
      provider = process.env['ROTE_LLM_PROVIDER'] ?? '';
      return 'success: verified';
    }, { openBrowser: false });
    servers.push(gui);
    const response = await fetch(`${gui.url}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rote-client': 'gui' },
      body: JSON.stringify({ task: 'Check status', url: 'https://example.com', verify: 'Ready', provider: 'codex', model: '', steps: 20 }),
    });
    expect(await response.json()).toEqual({ ok: true, output: 'success: verified' });
    expect(received).toEqual(['run', 'Check status', '--url', 'https://example.com', '--verify-text', 'Ready', '--max-steps', '20']);
    expect(provider).toBe('codex');
    expect(process.env['ROTE_LLM_PROVIDER']).toBe('openai');
    delete process.env['ROTE_LLM_PROVIDER'];
  });

  it('rejects cross-site shaped requests and invalid runs before execution', async () => {
    process.env['ROTE_LLM_PROVIDER'] = 'anthropic';
    let calls = 0;
    const gui = await createGuiServer(async () => { calls++; return ''; }, { openBrowser: false });
    servers.push(gui);
    const crossSite = await fetch(`${gui.url}/api/run`, { method: 'POST', body: '{}' });
    expect(crossSite.status).toBe(415);
    const invalid = await fetch(`${gui.url}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rote-client': 'gui' },
      body: JSON.stringify({ task: 'Do it', url: 'file:///tmp/private', verify: 'Done', provider: 'codex', steps: 20 }),
    });
    expect(await invalid.json()).toEqual({ ok: false, error: 'Starting URL must use http, https, or data.' });
    expect(calls).toBe(0);
    expect(process.env['ROTE_LLM_PROVIDER']).toBe('anthropic');
    delete process.env['ROTE_LLM_PROVIDER'];
  });
});
