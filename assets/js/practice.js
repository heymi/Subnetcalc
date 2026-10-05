// Subnetting practice page: one question, instant check, seeded so a link repeats the set.
import {
  DIFFICULTIES,
  QUESTION_TYPES,
  formatStats,
  grade,
  makeQuestion,
  readStats,
  recordAnswer,
  worksheetHtml,
} from './practice-core.js';
import { esc } from './ui.js';

const form = document.querySelector('[data-practice]');
if (form) init(form);

function storage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  let seed = p.get('seed') || '';
  if (!/^[a-z0-9]{1,12}$/i.test(seed)) seed = Math.floor(Math.random() * 36 ** 6).toString(36);
  const index = Math.max(0, Number.parseInt(p.get('n') || '0', 10) || 0);
  const difficulty = DIFFICULTIES.includes(p.get('d')) ? p.get('d') : 'easy';
  const requested = (p.get('t') || '').split(',').filter((t) => QUESTION_TYPES.includes(t));
  const types = requested.length ? requested : [...QUESTION_TYPES];
  return { seed, index, difficulty, types, timer: p.get('timer') === '1' };
}

function writeUrl(state) {
  const p = new URLSearchParams();
  p.set('seed', state.seed);
  p.set('n', String(state.index));
  p.set('d', state.difficulty);
  if (state.types.length !== QUESTION_TYPES.length) p.set('t', state.types.join(','));
  if (state.timer) p.set('timer', '1');
  const url = `${location.pathname}?${p}`.replace(/%2C/g, ',');
  if (location.search !== `?${p}`) history.replaceState({ practice: true }, '', url);
  const share = form.querySelector('[data-share-practice]');
  if (share) share.dataset.copy = location.href;
}

function init(root) {
  const state = readUrl();
  let question = null;
  let graded = false;
  let started = 0;
  let clock = 0;

  const prompt = root.querySelector('#practice-prompt');
  const fields = root.querySelector('#practice-fields');
  const result = root.querySelector('#practice-result');
  const steps = root.querySelector('#practice-steps');
  const score = root.querySelector('#practice-score');
  const time = root.querySelector('#practice-time');
  const meta = document.querySelector('#practice-meta');
  const diff = root.querySelector('#practice-diff');
  const timerBox = root.querySelector('#practice-timer');

  function showStats() {
    score.textContent = formatStats(readStats(storage()));
  }

  function stopClock() {
    if (clock) clearInterval(clock);
    clock = 0;
  }

  function tick() {
    if (!state.timer) {
      time.hidden = true;
      return;
    }
    time.hidden = false;
    time.textContent = `${((performance.now() - started) / 1000).toFixed(1)} s`;
  }

  function render() {
    writeUrl(state);
    question = makeQuestion(state);
    graded = false;
    started = performance.now();
    stopClock();
    if (state.timer) clock = setInterval(tick, 100);
    tick();
    prompt.textContent = question.prompt;
    meta.textContent = `${state.difficulty} · question ${state.index + 1} · seed ${state.seed}`;
    fields.innerHTML = question.fields
      .map(
        (f, i) => `<div data-field="${f.name}">
        <label class="field-label" for="ans-${f.name}">${esc(f.label)}</label>
        <input class="input" id="ans-${f.name}" name="${f.name}" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(f.placeholder)}" ${i === 0 ? 'data-primary-input' : ''}>
      </div>`,
      )
      .join('');
    result.textContent = '';
    result.className = 'practice-result';
    steps.innerHTML = '';
    fields.querySelector('input')?.focus();
  }

  function answers() {
    const out = {};
    for (const f of question.fields) out[f.name] = fields.querySelector(`[name="${f.name}"]`).value;
    return out;
  }

  function submit() {
    const marked = grade(question, answers());
    if (marked.blank) {
      result.textContent = 'Enter an answer first.';
      result.className = 'practice-result';
      return;
    }
    for (const f of question.fields) {
      fields.querySelector(`[data-field="${f.name}"]`).classList.toggle('is-ok', marked.fields[f.name].pass);
      fields.querySelector(`[data-field="${f.name}"]`).classList.toggle('is-bad', !marked.fields[f.name].pass);
    }
    if (marked.ok) {
      result.textContent = 'Correct.';
      result.className = 'practice-result is-ok';
    } else {
      const expect = question.fields.map((f) => `${f.label}: ${question.answers[f.name]}`).join(' · ');
      result.textContent = `Not quite. ${expect}`;
      result.className = 'practice-result is-bad';
    }
    steps.innerHTML = `<ol class="steps">${question.explain.map((line) => `<li><span>${esc(line)}</span></li>`).join('')}</ol>`;
    if (!graded) {
      graded = true;
      stopClock();
      tick();
      showStats();
      score.textContent = formatStats(recordAnswer(storage(), marked.ok));
    }
  }

  function go(next) {
    state.index = Math.max(0, next);
    render();
  }

  diff.value = state.difficulty;
  timerBox.checked = state.timer;
  for (const box of root.querySelectorAll('[data-type]')) box.checked = state.types.includes(box.dataset.type);
  showStats();
  render();

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  root.querySelector('[data-next]').addEventListener('click', () => go(state.index + 1));
  root.querySelector('[data-worksheet]').addEventListener('click', () => {
    const qs = Array.from({ length: 10 }, (_, i) => makeQuestion({ ...state, index: state.index + i }));
    document.querySelector('#worksheet').innerHTML = worksheetHtml(qs, state);
    document.body.classList.add('print-worksheet');
    window.print();
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('print-worksheet'));

  diff.addEventListener('change', () => {
    state.difficulty = diff.value;
    state.index = 0;
    render();
  });
  timerBox.addEventListener('change', () => {
    state.timer = timerBox.checked;
    render();
  });
  root.querySelector('[data-types]').addEventListener('change', (e) => {
    const box = e.target.closest('[data-type]');
    if (!box) return;
    const on = [...root.querySelectorAll('[data-type]:checked')].map((el) => el.dataset.type);
    if (!on.length) {
      box.checked = true;
      return;
    }
    state.types = on;
    state.index = 0;
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'n' && e.key !== 'N') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (typing) return;
    e.preventDefault();
    go(state.index + 1);
  });

  window.addEventListener('popstate', () => {
    const next = readUrl();
    Object.assign(state, next);
    diff.value = state.difficulty;
    timerBox.checked = state.timer;
    for (const box of root.querySelectorAll('[data-type]')) box.checked = state.types.includes(box.dataset.type);
    render();
  });
}
