/* global document, localStorage, fetch, setInterval, clearInterval, clearTimeout */
const $ = (selector) => document.querySelector(selector);
const settingsKey = 'rote.gui.settings.v1';
const historyKey = 'rote.gui.history.v1';
const defaults = { provider: 'codex', model: '', url: '', verify: '', steps: 20 };
let running = false;
let toastTimer;

const elements = {
  form: $('#composer'), input: $('#task-input'), send: $('#send-button'), messages: $('#messages'),
  empty: $('#empty-state'), conversation: $('#conversation'), title: $('#task-title'), history: $('#history-list'),
  provider: $('#provider'), model: $('#model'), url: $('#start-url'), verify: $('#verify-text'), steps: $('#max-steps'),
  providerLabel: $('#provider-label'), verifyHint: $('#verify-hint'), toast: $('#toast'),
};

function load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return fallback; }
}

function settings() {
  return {
    provider: elements.provider.value, model: elements.model.value.trim(), url: elements.url.value.trim(),
    verify: elements.verify.value.trim(), steps: Number(elements.steps.value),
  };
}

function saveSettings() {
  const value = settings();
  localStorage.setItem(settingsKey, JSON.stringify(value));
  const names = { codex: 'Codex', 'claude-code': 'Claude Code', openai: 'OpenAI', anthropic: 'Anthropic' };
  elements.providerLabel.textContent = names[value.provider] || value.provider;
  elements.verifyHint.textContent = value.verify ? `Success: “${value.verify}”` : 'Add a success check in settings';
  elements.verifyHint.classList.toggle('ready', Boolean(value.verify));
}

function applySettings() {
  const value = load(settingsKey, defaults);
  elements.provider.value = value.provider;
  elements.model.value = value.model;
  elements.url.value = value.url;
  elements.verify.value = value.verify;
  elements.steps.value = value.steps;
  saveSettings();
}

function timeLabel(value = new Date()) {
  return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function addMessage(role, text, state = '') {
  const article = document.createElement('article');
  article.className = `message ${role} ${state}`.trim();
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? 'YOU' : 'R';
  const content = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'message-head';
  const name = document.createElement('span');
  name.textContent = role === 'user' ? 'You' : state === 'failed' ? 'Rote · failed' : 'Rote';
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

function addProgress() {
  const message = addMessage('assistant', 'Starting a fresh browser…');
  message.body.className = 'message-body run-progress';
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  message.body.prepend(spinner);
  const stages = ['Starting a fresh browser…', 'Reading the page…', 'Working through the task…', 'Checking the expected result…'];
  let index = 0;
  const timer = setInterval(() => {
    index = Math.min(index + 1, stages.length - 1);
    message.body.lastChild.textContent = stages[index];
  }, 4200);
  return { ...message, stop: () => clearInterval(timer) };
}

function toast(text) {
  clearTimeout(toastTimer);
  elements.toast.textContent = text;
  elements.toast.classList.add('show');
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2600);
}

function validate(value) {
  if (!value.url) return 'Add a starting URL in run settings.';
  try { new URL(value.url); } catch { return 'Enter a complete starting URL.'; }
  if (!value.verify) return 'Add text Rote can use to confirm success.';
  if (!Number.isSafeInteger(value.steps) || value.steps < 1 || value.steps > 500) return 'Max steps must be between 1 and 500.';
  return '';
}

function remember(task, ok) {
  let items;
  try { items = JSON.parse(localStorage.getItem(historyKey) || '[]'); } catch { items = []; }
  items.unshift({ task, ok, at: new Date().toISOString() });
  localStorage.setItem(historyKey, JSON.stringify(items.slice(0, 12)));
  renderHistory();
}

function renderHistory() {
  let items;
  try { items = JSON.parse(localStorage.getItem(historyKey) || '[]'); } catch { items = []; }
  elements.history.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-history';
    empty.textContent = 'Completed tasks will appear here.';
    elements.history.append(empty);
    return;
  }
  items.forEach((item) => {
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

function setRunning(value) {
  running = value;
  elements.send.disabled = value;
  elements.input.disabled = value;
  elements.send.textContent = value ? '·' : '↑';
}

async function runTask(task) {
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
    const result = await response.json();
    progress.stop();
    progress.article.remove();
    ok = Boolean(result.ok);
    addMessage('assistant', result.ok ? result.output : result.error, result.ok ? 'result' : 'failed');
  } catch {
    progress.stop();
    progress.article.remove();
    addMessage('assistant', 'The local Rote service stopped responding. Restart `rote gui` and try again.', 'failed');
  } finally {
    remember(task, ok);
    setRunning(false);
    elements.input.focus();
  }
}

function newTask() {
  if (running) { toast('Wait for the current task to finish.'); return; }
  elements.messages.replaceChildren();
  elements.empty.hidden = false;
  elements.title.textContent = 'New browser task';
  elements.input.value = '';
  resizeInput();
  elements.input.focus();
  closePanels();
}

function resizeInput() {
  elements.input.style.height = 'auto';
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 180)}px`;
}

function closePanels() { document.body.classList.remove('sidebar-open', 'inspector-open'); }

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const task = elements.input.value.trim();
  if (task && !running) void runTask(task);
});
elements.input.addEventListener('input', resizeInput);
elements.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); elements.form.requestSubmit(); }
});
for (const input of [elements.provider, elements.model, elements.url, elements.verify, elements.steps]) input.addEventListener('change', saveSettings);
elements.verify.addEventListener('input', saveSettings);
$('#new-task').addEventListener('click', newTask);
$('#clear-chat').addEventListener('click', newTask);
$('#history-toggle').addEventListener('click', () => document.body.classList.add('sidebar-open'));
$('#settings-toggle').addEventListener('click', () => document.body.classList.toggle('inspector-open'));
$('#provider-shortcut').addEventListener('click', () => { document.body.classList.add('inspector-open'); elements.provider.focus(); });
$('#scrim').addEventListener('click', closePanels);
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closePanels));
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  elements.input.value = button.dataset.prompt;
  resizeInput();
  elements.input.focus();
}));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePanels();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); newTask(); }
});

applySettings();
renderHistory();
elements.input.focus();
fetch('/api/status').catch(() => toast('Local service unavailable.'));
