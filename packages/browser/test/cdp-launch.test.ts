import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { waitForDevtoolsEndpoint } from '../src/cdp-backend.js';

// The CI flake this hardens against: Chrome's "DevTools listening" stderr line
// arriving late (cold runner) or split across stream chunks. Neither may fail
// the launch; a genuine hang must still fail with a diagnosable error.

function fakeChild(): { child: ChildProcess; stderr: PassThrough } {
  const stderr = new PassThrough();
  const child = new EventEmitter() as unknown as ChildProcess;
  Object.defineProperty(child, 'stderr', { value: stderr });
  return { child, stderr };
}

describe('waitForDevtoolsEndpoint', () => {
  it('matches the endpoint line even when it is split across stderr chunks', async () => {
    const { child, stderr } = fakeChild();
    const pending = waitForDevtoolsEndpoint(child, 1000);
    stderr.write('DevTools listen');
    stderr.write('ing on ws://127.0.0.1:9333/devtools/browser/abc\n');
    await expect(pending).resolves.toBe('http://127.0.0.1:9333');
  });

  it('matches when the line is preceded by unrelated warnings in the same buffer', async () => {
    const { child, stderr } = fakeChild();
    const pending = waitForDevtoolsEndpoint(child, 1000);
    stderr.write('[warn] GPU process something\n[warn] dbus error\n');
    stderr.write('DevTools listening on ws://127.0.0.1:9444/devtools/browser/def\n');
    await expect(pending).resolves.toBe('http://127.0.0.1:9444');
  });

  it('times out with the stderr tail in the error so a hang is diagnosable', async () => {
    const { child, stderr } = fakeChild();
    const pending = waitForDevtoolsEndpoint(child, 50);
    stderr.write('some chrome complaint about sandboxing\n');
    await expect(pending).rejects.toThrow(/timed out waiting for Chrome DevTools endpoint after 50 ms; stderr tail: some chrome complaint/);
  });

  it('fails fast when Chrome exits before the endpoint appears', async () => {
    const { child } = fakeChild();
    const pending = waitForDevtoolsEndpoint(child, 1000);
    (child as unknown as EventEmitter).emit('exit', 127);
    await expect(pending).rejects.toThrow(/Chrome exited before DevTools endpoint was ready: 127/);
  });
});
