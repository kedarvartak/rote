type Provider = 'codex' | 'claude-code' | 'openai' | 'anthropic';
type Settings = { provider: Provider; model: string; url: string; verify: string; steps: number };
type HistoryItem = { task: string; ok: boolean; at: string };
type Message = { article: HTMLElement; body: HTMLElement; name: HTMLSpanElement };
type ProgressMessage = Message & { stop: () => void };

const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing GUI element: ${selector}`);
  return element;
};

const settingsKey = 'rote.gui.settings.v1';
const historyKey = 'rote.gui.history.v1';
const defaults: Settings = { provider: 'codex', model: '', url: '', verify: '', steps: 20 };
const providerNames: Record<Provider, string> = {
  codex: 'Codex subscription',
  'claude-code': 'Claude Code subscription',
  openai: 'OpenAI API',
  anthropic: 'Anthropic API',
};

let running = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const elements = {
  form: $<HTMLFormElement>('#composer'),
  input: $<HTMLTextAreaElement>('#task-input'),
  send: $<HTMLButtonElement>('#send-button'),
  messages: $<HTMLDivElement>('#messages'),
  empty: $<HTMLDivElement>('#empty-state'),
  conversation: $<HTMLElement>('#conversation'),
  title: $<HTMLElement>('#task-title'),
  history: $<HTMLDivElement>('#history-list'),
  provider: $<HTMLInputElement>('#provider'),
  model: $<HTMLInputElement>('#model'),
  url: $<HTMLInputElement>('#start-url'),
  verify: $<HTMLInputElement>('#verify-text'),
  steps: $<HTMLInputElement>('#max-steps'),
  providerLabel: $<HTMLSpanElement>('#provider-label'),
  providerPicker: $<HTMLDivElement>('#provider-picker'),
  providerToggle: $<HTMLButtonElement>('#provider-toggle'),
  providerSelected: $<HTMLSpanElement>('#provider-selected'),
  providerOptions: $<HTMLDivElement>('#provider-options'),
  verifyHint: $<HTMLSpanElement>('#verify-hint'),
  toast: $<HTMLDivElement>('#toast'),
};

function load<T>(key: string, fallback: T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || 'null');
    return value && typeof value === 'object' ? { ...fallback, ...value } as T : fallback;
  } catch {
    return fallback;
  }
}

function settings(): Settings {
  const provider = elements.provider.value as Provider;
  return {
    provider: provider in providerNames ? provider : defaults.provider,
    model: elements.model.value.trim(),
    url: elements.url.value.trim(),
    verify: elements.verify.value.trim(),
    steps: Number(elements.steps.value),
  };
}

function saveSettings(): void {
  const value = settings();
  localStorage.setItem(settingsKey, JSON.stringify(value));
  elements.providerLabel.textContent = providerNames[value.provider];
  elements.verifyHint.textContent = value.verify ? `Success: “${value.verify}”` : 'Add a success check in settings';
  elements.verifyHint.classList.toggle('ready', Boolean(value.verify));
}

function setProvider(value: string): void {
  const provider = value in providerNames ? value as Provider : defaults.provider;
  elements.provider.value = provider;
  elements.providerSelected.textContent = providerNames[provider];
  elements.providerOptions.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach(option => {
    option.setAttribute('aria-selected', String(option.dataset.provider === provider));
  });
}

function closeProviderPicker(): void {
  elements.providerToggle.setAttribute('aria-expanded', 'false');
  elements.providerOptions.hidden = true;
}

function applySettings(): void {
  const value = { ...defaults, ...load<Partial<Settings>>(settingsKey, {}) };
  setProvider(value.provider);
  elements.model.value = value.model;
  elements.url.value = value.url;
  elements.verify.value = value.verify;
  elements.steps.value = String(value.steps);
  saveSettings();
}

function timeLabel(value: Date = new Date()): string {
  return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function addMessage(role: 'user' | 'assistant', text: string, state: '' | 'result' | 'failed' = ''): Message {
  const article = document.createElement('article');
  article.className = `message ${role} ${state}`.trim();
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? 'YOU' : 'AI';
  const content = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'message-head';
  const name = document.createElement('span');
  name.textContent = role === 'user' ? 'You' : state === 'failed' ? 'Agent · failed' : 'Agent';
  const time = document.createElement('time');
  time.textContent = timeLabel();
  head.append(name, time);
  const body = document.createElement('div');
  body.className = `message-body ${state === 'result' ? 'result' : ''}`.trim();
  body.textContent = text;
  content.append(head, body);
  article.append(avatar, content);
  elements.messages.append(article);
  elements.empty.hidden = true;
  elements.conversation.scrollTop = elements.conversation.scrollHeight;
  return { article, body, name };
}

function addProgress(): ProgressMessage {
  const message = addMessage('assistant', 'Starting a fresh browser…');
  message.body.className = 'message-body run-progress';
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  message.body.prepend(spinner);
  const stages = ['Starting a fresh browser…', 'Reading the page…', 'Working through the task…', 'Checking the expected result…'];
  let index = 0;
  const timer = setInterval(() => {
    index = Math.min(index + 1, stages.length - 1);
    const last = message.body.lastChild;
    if (last) last.textContent = stages[index] ?? '';
  }, 4200);
  return { ...message, stop: () => clearInterval(timer) };
}

function toast(text: string): void {
  if (toastTimer) clearTimeout(toastTimer);
  elements.toast.textContent = text;
  elements.toast.classList.add('show');
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2600);
}

function validate(value: Settings): string {
  if (!value.url) return 'Add a starting URL in run settings.';
  try { new URL(value.url); } catch { return 'Enter a complete starting URL.'; }
  if (!value.verify) return 'Add text that can confirm success.';
  if (!Number.isSafeInteger(value.steps) || value.steps < 1 || value.steps > 500) return 'Max steps must be between 1 and 500.';
  return '';
}

function remember(task: string, ok: boolean): void {
  const items = load<HistoryItem[]>(historyKey, []);
  items.unshift({ task, ok, at: new Date().toISOString() });
  localStorage.setItem(historyKey, JSON.stringify(items.slice(0, 12)));
  renderHistory();
}

function renderHistory(): void {
  const items = load<HistoryItem[]>(historyKey, []);
  elements.history.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-history';
    empty.textContent = 'Completed tasks will appear here.';
    elements.history.append(empty);
    return;
  }
  items.forEach(item => {
    const button = document.createElement('button');
    button.className = 'history-item';
    const title = document.createElement('strong');
    title.textContent = item.task;
    const meta = document.createElement('small');
    meta.textContent = `${item.ok ? 'Verified' : 'Failed'} · ${new Date(item.at).toLocaleDateString()}`;
    button.append(title, meta);
    button.addEventListener('click', () => { elements.input.value = item.task; resizeInput(); elements.input.focus(); closePanels(); });
    elements.history.append(button);
  });
}

function setRunning(value: boolean): void {
  running = value;
  elements.send.disabled = value;
  elements.input.disabled = value;
  elements.send.textContent = value ? '·' : '↑';
}

async function runTask(task: string): Promise<void> {
  const value = settings();
  const problem = validate(value);
  if (problem) { toast(problem); document.body.classList.add('inspector-open'); return; }
  setRunning(true);
  addMessage('user', task);
  elements.title.textContent = task;
  const progress = addProgress();
  elements.input.value = '';
  resizeInput();
  let ok = false;
  try {
    const response = await fetch('/api/run', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-rote-client': 'gui' },
      body: JSON.stringify({ task, ...value }),
    });
    const result = await response.json() as { ok?: unknown; output?: unknown; error?: unknown };
    progress.stop();
    progress.article.remove();
    ok = Boolean(result.ok);
    addMessage('assistant', String(result.ok ? result.output ?? '' : result.error ?? 'The task failed.'), result.ok ? 'result' : 'failed');
  } catch {
    progress.stop();
    progress.article.remove();
    addMessage('assistant', 'The local service stopped responding. Restart the GUI and try again.', 'failed');
  } finally {
    remember(task, ok);
    setRunning(false);
    elements.input.focus();
  }
}

function newTask(): void {
  if (running) { toast('Wait for the current task to finish.'); return; }
  elements.messages.replaceChildren();
  elements.empty.hidden = false;
  elements.title.textContent = 'New browser task';
  elements.input.value = '';
  resizeInput();
  elements.input.focus();
  closePanels();
}

function resizeInput(): void {
  elements.input.style.height = 'auto';
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 180)}px`;
}

function closePanels(): void {
  closeProviderPicker();
  document.body.classList.remove('sidebar-open', 'inspector-open');
}

elements.form.addEventListener('submit', event => {
  event.preventDefault();
  const task = elements.input.value.trim();
  if (task && !running) void runTask(task);
});
elements.input.addEventListener('input', resizeInput);
elements.input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); elements.form.requestSubmit(); }
});
for (const input of [elements.provider, elements.model, elements.url, elements.verify, elements.steps]) input.addEventListener('change', saveSettings);
elements.verify.addEventListener('input', saveSettings);
$<HTMLButtonElement>('#new-task').addEventListener('click', newTask);
$<HTMLButtonElement>('#clear-chat').addEventListener('click', newTask);
$<HTMLButtonElement>('#history-toggle').addEventListener('click', () => document.body.classList.add('sidebar-open'));
$<HTMLButtonElement>('#settings-toggle').addEventListener('click', () => document.body.classList.toggle('inspector-open'));
$<HTMLButtonElement>('#provider-shortcut').addEventListener('click', () => { document.body.classList.add('inspector-open'); elements.providerToggle.focus(); });
$<HTMLButtonElement>('#scrim').addEventListener('click', closePanels);
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => button.addEventListener('click', closePanels));
document.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  elements.input.value = button.dataset.prompt ?? '';
  resizeInput();
  elements.input.focus();
}));
elements.providerToggle.addEventListener('click', () => {
  const open = elements.providerToggle.getAttribute('aria-expanded') !== 'true';
  elements.providerToggle.setAttribute('aria-expanded', String(open));
  elements.providerOptions.hidden = !open;
});
elements.providerOptions.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach(option => option.addEventListener('click', () => {
  setProvider(option.dataset.provider ?? defaults.provider);
  closeProviderPicker();
  saveSettings();
  elements.providerToggle.focus();
}));
document.addEventListener('click', event => {
  if (event.target instanceof Node && !elements.providerPicker.contains(event.target)) closeProviderPicker();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeProviderPicker(); closePanels(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); newTask(); }
});

applySettings();
renderHistory();
elements.input.focus();
void fetch('/api/status').catch(() => toast('Local service unavailable.'));
