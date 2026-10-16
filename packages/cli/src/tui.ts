import { emitKeypressEvents, type Key } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { characters, columns as displayColumns, clipColumns, wrapColumns } from './terminal-layout.js';

type Message = { role: string; text: string };
const providers = ['codex', 'claude-code', 'openai', 'anthropic'];
const esc = '\x1b[';
const reset = esc + '0m';
const muted = esc + '90m';
const accent = esc + '36m';

// Remove terminal control sequences from page, model, and pasted content.
function plain(text: string): string {
  // Control bytes from browser/model output must never move the terminal cursor.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '');
}

function wrap(text: string, width: number): string[] {
  return wrapColumns(plain(text), width);
}

/** Opens a responsive chat terminal; browser tasks still use the verified CLI path. */
export async function startTui(runTask: (argv: string[]) => Promise<string>): Promise<void> {
  const messages: Message[] = [];
  const history: string[] = [];
  let historyIndex = 0;
  let input = '';
  let cursor = 0;
  let scroll = 0;
  let provider = process.env['ROTE_LLM_PROVIDER'] ?? 'codex';
  let model = '';
  let url = '';
  let verify = '';
  let limit = 20;
  let pending = '';
  let collecting: 'url' | 'verify' | undefined;
  let running = false;
  let started = 0;
  let quitting = false;
  let closed = false;
  let tick = 0;
  let renderQueued = false;
  const oldRaw = stdin.isRaw;
  const color = !process.env['NO_COLOR'];
  const paint = (value: string, style: string): string => color ? style + value + reset : value;
  let finish: () => void = () => {};
  const done = new Promise<void>(resolve => { finish = resolve; });

  function add(role: string, text: string): void {
    messages.push({ role, text: plain(text) });
    scroll = 0;
  }

  function queueRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    setImmediate(() => { renderQueued = false; render(); });
  }

  function render(): void {
    if (closed) return;
    const columns = stdout.columns || 80;
    const rows = stdout.rows || 24;
    if (columns < 32 || rows < 16) {
      stdout.write(esc + '?25l' + esc + '2J' + esc + 'H' + 'Resize terminal to 32 × 16.'.slice(0, Math.max(1, columns - 1)));
      return;
    }
    const width = Math.max(12, Math.min(88, columns - 6));
    const left = Math.max(1, Math.floor((columns - width) / 2));
    const clip = (value: string): string => clipColumns(plain(value), width);
    const lines: string[] = Array.from({ length: rows }, () => '');
    const put = (row: number, value: string): void => { if (row >= 0 && row < rows) lines[row] = ' '.repeat(left) + value; };
    put(1, paint('›_ rote', esc + '1m') + paint(clipColumns('  /  browser workspace', width - 7), muted));
    put(2, paint(clip(provider + '  ·  ' + (model || 'default model') + '  ·  ' + limit + ' steps'), muted));
    const composerTop = rows - 7;
    const available = Math.max(1, composerTop - 5);
    const transcript: string[] = [];
    if (!messages.length) {
      transcript.push('', paint('What would you like to do?', esc + '1m'), '',
        paint(clip('Describe a browser task below. Rote will ask for any missing details.'), muted), '',
        paint(clip('/help  commands     /provider  switch model provider'), muted),
        paint(clip('/demo  set up a local practice page'), muted));
    } else {
      for (const message of messages) {
        transcript.push(paint(message.role, message.role === 'you' ? accent : esc + '1m'));
        transcript.push(...wrap(message.text, width - 2).map(line => '  ' + line), '');
      }
    }
    const maxScroll = Math.max(0, transcript.length - available);
    scroll = Math.max(0, Math.min(scroll, maxScroll));
    const end = transcript.length - scroll;
    const visibleTranscript = messages.length ? transcript.slice(Math.max(0, end - available), end) : transcript.slice(0, available);
    visibleTranscript.forEach((line, index) => put(4 + index, line));
    const status = running
      ? (quitting ? 'Finishing current run before exit' : ['·', '•', '●', '•'][tick % 4] + ' Running') + '  ·  ' + Math.floor((Date.now() - started) / 1000) + 's'
      : collecting === 'url' ? 'Starting URL  ·  Esc to cancel'
        : collecting === 'verify' ? 'Text that must be visible when the task succeeds  ·  Esc to cancel'
          : scroll ? 'Earlier messages  ·  PgDn to return' : url ? '↗ ' + url : 'Ready  ·  type a task or /help';
    put(composerTop - 1, paint(clip(status), muted));
    put(composerTop, paint('─'.repeat(width), muted));
    const inputWidth = width - 4;
    const chars = characters(input);
    let start = 0;
    while (displayColumns(chars.slice(start, cursor).join('')) >= inputWidth) start++;
    const visible = clipColumns(chars.slice(start).join(''), inputWidth);
    put(composerTop + 2, paint('› ', accent) + (visible || paint(clipColumns(running ? 'Run in progress…' : 'Ask Rote to do something…', inputWidth), muted)));
    put(composerTop + 4, paint('─'.repeat(width), muted));
    put(rows - 1, paint(clip('Enter send   ↑↓ history   PgUp/PgDn scroll   /help   Ctrl+C exit'), muted));
    const cursorRow = composerTop + 3;
    const cursorColumn = left + 3 + displayColumns(chars.slice(start, cursor).join(''));
    stdout.write(esc + '?25l' + esc + 'H' + lines.map(line => line + esc + 'K').join('\r\n')
      + esc + cursorRow + ';' + cursorColumn + 'H' + (running ? '' : esc + '?25h'));
  }

  function exit(): void {
    if (running) {
      quitting = true;
      render();
      return;
    }
    finish();
  }

  async function execute(task: string): Promise<void> {
    running = true;
    started = Date.now();
    add('rote', 'Running in Chrome. Success requires visible text: “' + verify + '”.');
    render();
    const previous = process.env['ROTE_LLM_PROVIDER'];
    process.env['ROTE_LLM_PROVIDER'] = provider;
    try {
      const output = await runTask(['run', task, '--url', url, '--verify-text', verify,
        '--max-steps', String(limit), ...(model ? ['--model', model] : [])]);
      add('rote · verified', output);
    } catch (error) {
      add('rote · failed', error instanceof Error ? error.message : String(error));
    } finally {
      if (previous === undefined) delete process.env['ROTE_LLM_PROVIDER'];
      else process.env['ROTE_LLM_PROVIDER'] = previous;
      running = false;
      if (quitting) finish();
      else render();
    }
  }

  function setUrl(value: string): void {
    try { new URL(value); } catch { throw new Error('Enter a complete URL, such as https://example.com.'); }
    url = value;
  }

  async function submit(): Promise<void> {
    const value = input.trim();
    if (!value || running) return;
    history.push(value);
    historyIndex = history.length;
    input = '';
    cursor = 0;
    try {
      if (value.startsWith('/')) {
        const [command] = value.split(/\s+/);
        const arg = value.slice(command!.length).trim();
        switch (command) {
          case '/quit': exit(); return;
          case '/clear': messages.length = 0; pending = ''; collecting = undefined; break;
          case '/help':
            add('commands', '/provider codex | claude-code | openai | anthropic\n/model <name> (or default)\n/url <starting URL>\n/verify <success text>\n/steps <positive integer>\n/demo  configure a local practice page\n/clear  clear conversation\n/quit  exit\n\nEach task starts a new browser run. Settings persist for this session.');
            break;
          case '/provider':
            if (!arg) add('providers', providers.map(p => (p === provider ? '● ' : '  ') + p).join('\n') + '\n\nUse /provider <name> to select.');
            else if (providers.includes(arg)) { provider = arg; model = ''; add('rote', 'Provider set to ' + provider + '.'); }
            else throw new Error('Choose: ' + providers.join(', '));
            break;
          case '/model': model = arg === 'default' ? '' : arg; add('rote', 'Model: ' + (model || 'provider default')); break;
          case '/url': setUrl(arg); add('rote', 'Starting URL set to ' + url); break;
          case '/verify': if (!arg) throw new Error('Use /verify followed by the success text.'); verify = arg; add('rote', 'Success text set to “' + verify + '”.'); break;
          case '/steps': if (!/^[1-9]\d*$/.test(arg) || !Number.isSafeInteger(Number(arg))) throw new Error('Use /steps followed by a positive whole number.'); limit = Number(arg); break;
          case '/demo':
            url = 'data:text/html,<h1>Rote ready</h1>';
            verify = 'Rote ready';
            add('rote', 'Practice page configured. Type “Confirm the page is ready” to run it. This uses your selected model provider.');
            break;
          default: throw new Error('Unknown command. Type /help to see the available commands.');
        }
      } else {
        if (collecting === 'url') { setUrl(value); collecting = undefined; }
        else if (collecting === 'verify') { verify = value; collecting = undefined; }
        else { pending = value; add('you', value); }
        if (!url) { collecting = 'url'; add('rote', 'Which URL should I start from?'); }
        else if (!verify) { collecting = 'verify'; add('rote', 'What text should be visible on the page to confirm success?'); }
        else { const task = pending; pending = ''; await execute(task); }
      }
    } catch (error) {
      add('rote', error instanceof Error ? error.message : String(error));
    }
    render();
  }

  function onKey(text: string | undefined, key: Key): void {
    if (key.ctrl && (key.name === 'c' || key.name === 'd')) { exit(); return; }
    if (key.name === 'pageup') { scroll += 5; render(); return; }
    if (key.name === 'pagedown') { scroll -= 5; render(); return; }
    if (running) return;
    const chars = characters(input);
    if (key.name === 'return') { void submit(); return; }
    if (key.name === 'escape') { input = ''; cursor = 0; pending = ''; collecting = undefined; }
    else if (key.name === 'left') cursor = Math.max(0, cursor - 1);
    else if (key.name === 'right') cursor = Math.min(chars.length, cursor + 1);
    else if (key.name === 'home' || (key.ctrl && key.name === 'a')) cursor = 0;
    else if (key.name === 'end' || (key.ctrl && key.name === 'e')) cursor = chars.length;
    else if (key.name === 'backspace') { if (cursor) chars.splice(--cursor, 1); input = chars.join(''); }
    else if (key.name === 'delete') { chars.splice(cursor, 1); input = chars.join(''); }
    else if (key.ctrl && key.name === 'u') { input = ''; cursor = 0; }
    else if (key.name === 'up' || key.name === 'down') {
      historyIndex = Math.max(0, Math.min(history.length, historyIndex + (key.name === 'up' ? -1 : 1)));
      input = history[historyIndex] ?? ''; cursor = characters(input).length;
    } else if (text && !key.ctrl && !key.meta) {
      const inserted = plain(text).replace(/\n/g, ' ');
      const prefix = chars.slice(0, cursor).join('') + inserted;
      input = prefix + chars.slice(cursor).join('');
      cursor = characters(prefix).length;
    }
    queueRender();
  }

  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('keypress', onKey);
  stdout.on('resize', render);
  process.on('SIGINT', exit);
  stdout.write(esc + '?1049h' + esc + '2J');
  const timer = setInterval(() => { if (running) { tick++; render(); } }, 250);
  render();
  try { await done; } finally {
    closed = true;
    clearInterval(timer);
    stdin.removeListener('keypress', onKey);
    stdout.removeListener('resize', render);
    process.removeListener('SIGINT', exit);
    stdin.setRawMode(oldRaw ?? false);
    stdin.pause();
    stdout.write(reset + esc + '?25h' + esc + '?1049l');
  }
}
