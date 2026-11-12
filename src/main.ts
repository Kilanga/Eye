import './styles.css';
import { HybridAI, type OnDeviceStatus } from './ai/models';
import { analyze } from './core/analyze';
import { guessQuery, runQuery, type QueryAnswer } from './core/ask';
import { clearSnapshot, compareSnapshots, loadSnapshot, saveSnapshot, takeSnapshot, type Comparison, type Snapshot } from './core/followup';
import { importCsv } from './core/import/csv';
import { importOfx } from './core/import/ofx';
import { chunkLines, guessYear, parseWithLayout } from './core/import/statement-text';
import {
  defaultQuestions,
  LOCAL_LETTER_TEMPLATE,
  templateExplanation,
  type Answer,
  type InterviewQuestion,
} from './core/interview';
import { OutboundLedger } from './core/ledger';
import { fillTemplate, listPlaceholders } from './core/letter';
import { buildDraftPlan, finalisePlan, toCloudSteps, type DraftPlan, type FinalPlan } from './core/plan';
import { buildCloudProfile, type CloudProfile } from './core/profile';
import { getRulePack } from './core/rules';
import type { Account, CategorySource, CountryCode, DataOrigin, Transaction, UserInputs } from './core/types';
import { accountToCsv, DEMO_PERSONAS } from './demo/generate';
import { initFirebase } from './firebase';
import { runPipeline, type PipelineResult } from './pipeline';

// ---------------------------------------------------------------------------- setup

const ledger = new OutboundLedger();
const app = initFirebase();
const ai = app ? new HybridAI(app, ledger) : null;

interface State {
  country: CountryCode;
  accounts: Account[];
  methods: Record<string, string>;
  inputs: UserInputs;
  result?: PipelineResult;
  profile?: CloudProfile;
  draft?: DraftPlan;
  plan?: FinalPlan;
  device: OnDeviceStatus;
  asOf?: string;
  previous: Snapshot | null;
  comparison?: Comparison | null;
  questions: InterviewQuestion[];
  questionsBy?: string;
  explanation?: { text: string; by: string };
  letter?: { template: string; by: string };
  letterValues: Record<string, string>;
  answer?: QueryAnswer & { by: string };
}

const state: State = {
  country: 'US',
  accounts: [],
  methods: {},
  inputs: { projectedHousingPayment: 0 },
  device: 'no-api',
  previous: loadSnapshot(),
  questions: [],
  letterValues: {},
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pack = () => getRulePack(state.country);
const money = (n: number, digits = 0) =>
  new Intl.NumberFormat(pack().locale, { style: 'currency', currency: pack().currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const origin = (): DataOrigin => (state.accounts.some((a) => a.origin === 'user') ? 'user' : 'demo');
const allTxs = () => state.accounts.flatMap((a) => a.transactions);
const labels = () => allTxs().map((t) => t.rawLabel);
const show = (sel: string, on: boolean) => $(sel).classList.toggle('hidden', !on);

const EYE = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M2 16c4-7 9-10 14-10s10 3 14 10c-4 7-9 10-14 10S6 23 2 16z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="16" cy="16" r="5.5" fill="var(--accent)"/><path d="M13.6 18.4l4.8-4.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`;

// ---------------------------------------------------------------------------- page

document.querySelector('#app')!.innerHTML = `
<div class="topbar"><div class="topbar-inner">
  <a class="brand" href="#top">${EYE}<span>Underwriter's Eye</span></a>
  <nav class="steps" aria-label="Steps">
    <a href="#statements">Statements</a><a href="#lender">Lender's view</a><a href="#plan-card">Plan</a>
    <a href="#explain">Explain</a><a href="#ask">Ask</a><a href="#privacy">Privacy</a>
  </nav>
  <div class="pills"><span class="pill" id="pill-device">On-device model</span><span class="pill" id="pill-cloud"></span><span class="pill" id="pill-bytes">0 bytes left this device</span></div>
</div></div>

<div class="hero" id="top">
  <h1>See your bank statements the way a lender will, before you apply.</h1>
  <p>Gemini Nano reads every line on your device. Your country's lending rules turn it into a traffic-light report, a 90-day plan, and an explanation letter. Only about ten rounded numbers ever reach the cloud.</p>
  <span class="promise">${EYE.replace('viewBox', 'width="18" height="18" viewBox')} Your statements never leave this device.</span>
</div>

<section class="card" id="statements">
  <h2><span class="num">1</span>Your statements</h2>
  <p class="lead">CSV, OFX or PDF, one file per account. Add every account: lenders see transfers between them.</p>
  <div class="row">
    <label>Lending rules<select id="country"><option value="US">United States</option><option value="FR">France</option></select></label>
    <label id="gross-label">Gross monthly income<input type="number" id="gross" min="0" step="50" placeholder="e.g. 6400" /></label>
    <label>Target monthly housing payment<input type="number" id="housing" min="0" step="50" placeholder="e.g. 1850" /></label>
    <button class="ghost" id="prepare">Prepare private mode</button>
  </div>
  <p class="note" id="rules-note"></p>
  <div class="progress hidden" id="dl-progress"><div></div></div>
  <div class="drop" id="drop" style="margin-top:14px">
    <strong>Drop your statement files here</strong>
    <span class="note">or</span> <label class="inline" style="display:inline-flex"><input type="file" id="files" multiple accept=".csv,.ofx,.qfx,.txt,.pdf" /></label>
    <div class="note">Read in this browser. Nothing is uploaded.</div>
  </div>
  <div class="samples">
    ${DEMO_PERSONAS.map((p, i) => {
      const d = p();
      return `<button class="persona" data-demo="${i}"><strong>${esc(d.title)}</strong><span>${esc(d.description)}</span></button>`;
    }).join('')}
  </div>
  <p class="note">No statements at hand? Download Maya's synthetic files and import them like real ones:
    <button class="quiet small" data-sample="csv">Checking (CSV)</button>
    <button class="quiet small" data-sample="pdf">Checking (PDF)</button>
    <button class="quiet small" data-sample="pdf-compact">Checking (PDF, unusual layout)</button></p>
  <ul class="accounts" id="accounts"></ul>
  <div class="row"><button id="analyze" disabled>Analyse on this device</button><button class="quiet" id="clear-accounts">Remove statements</button></div>
  <div class="progress hidden" id="an-progress"><div></div></div>
  <div id="import-notes"></div>
</section>

<section class="card hidden" id="lender">
  <h2><span class="num">2</span>What your lender will see</h2>
  <div id="who-read"></div>
  <div id="pipeline-notes"></div>
  <div id="compare" class="hidden"><h3>Since your last scan</h3><p class="note" id="compare-note"></p><ul class="compare" id="compare-list"></ul></div>
  <ul class="checks" id="checks"></ul>
  <div id="obligations"></div>
  <h3>What if?</h3>
  <div class="sim">
    <label>Target housing payment <span id="sim-h-v"></span><input type="range" id="sim-h" /></label>
    <label>Debt payments cleared <span id="sim-d-v"></span><input type="range" id="sim-d" /></label>
    <div class="sim-out"><span class="note" id="sim-label"></span><b id="sim-ratio"></b><span class="dot" id="sim-dot"></span><br /><button class="small ghost" id="sim-apply">Use this target</button></div>
  </div>
  <details style="margin-top:14px"><summary class="note">Every line and who read it</summary><div class="scroll" style="margin-top:8px"><table id="lines"></table></div></details>
</section>

<section class="card hidden" id="plan-card">
  <h2><span class="num">3</span>Your 90-day plan</h2>
  <p class="lead">Steps and figures are computed on this device. Rescan around day 30 and day 60 to watch the lights change.</p>
  <div id="plan"></div>
  <div class="row" style="margin-top:12px"><button class="ghost" id="polish">Polish the wording with Gemini</button><span class="note" id="polish-note"></span></div>
</section>

<section class="card hidden" id="explain">
  <h2><span class="num">4</span>Explain it to the lender</h2>
  <p class="lead">An underwriter will ask about every orange or red light. Answer here; your answers stay on this device and Gemini Nano turns them into a paragraph for your letter.</p>
  <div class="row"><button id="get-questions">Get the underwriter's questions</button><span class="note" id="questions-note"></span></div>
  <div id="questions"></div>
  <div class="row hidden" id="explain-actions" style="margin-top:12px"><button id="write-explanation">Write my explanation on this device</button><span class="note" id="explanation-note"></span></div>
  <div id="explanation"></div>
  <div id="letter-block" class="hidden">
    <h3>Your letter</h3>
    <div class="row" id="letter-fields"></div>
    <div class="letter" id="letter-text" style="margin-top:12px"></div>
    <div class="row" style="margin-top:10px"><button class="ghost small" id="copy-letter">Copy</button><button class="ghost small" id="download-letter">Download .txt</button><span class="note" id="letter-note"></span></div>
  </div>
</section>

<section class="card hidden" id="ask">
  <h2><span class="num">5</span>Ask your statements</h2>
  <p class="lead">Gemini Nano turns your question into a query on this device; the totals are computed by code, never guessed.</p>
  <div class="row"><input type="text" id="question" class="grow" placeholder="How much did I spend on fees?" /><button id="ask-btn">Ask</button></div>
  <div class="chips">${['How much did I pay in bank fees?', 'What was my largest deposit?', 'How much do I spend on groceries per month?', 'How many gambling transactions?']
    .map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`)
    .join('')}</div>
  <div id="answer"></div>
</section>

<section class="card" id="privacy">
  <h2><span class="num">6</span>What left this device</h2>
  <div class="flow">
    <div class="side here"><h4>Stays on this device</h4><ul id="stays"><li>Nothing imported yet</li></ul></div>
    <div class="arrow" aria-hidden="true">&rarr;</div>
    <div class="side there"><h4>Can be sent to Gemini in the cloud</h4><ul id="leaves"><li>Nothing yet</li></ul></div>
  </div>
  <details><summary class="note">The exact summary, as it would be sent</summary><pre id="payload">{}</pre></details>
  <h3>Outbound ledger</h3>
  <p class="note">Every request that left this device, byte for byte, with the answer source reported by Firebase.</p>
  <div class="scroll"><table><thead><tr><th>Time</th><th>What</th><th>Bytes</th><th>Answered</th><th>Payload</th></tr></thead><tbody id="ledger"></tbody></table></div>
  <div class="row" style="margin-top:14px">
    <label class="inline"><input type="checkbox" id="keep" /> Keep the summary (numbers and lights, no statements) in this browser for a follow-up scan</label>
    <button class="quiet small" id="erase">Erase everything</button>
  </div>
</section>
<footer>Educational tool, not financial or legal advice. Thresholds and sources are listed in the project README. All sample people, banks and merchants are fictional.</footer>
`;

// ---------------------------------------------------------------------------- rendering

function renderPills(): void {
  const labelsFor: Record<OnDeviceStatus, string> = {
    available: 'Gemini Nano ready',
    downloadable: 'Gemini Nano not downloaded',
    downloading: 'Gemini Nano downloading',
    unavailable: 'Gemini Nano unavailable',
    'no-api': 'No on-device model',
  };
  const d = $('#pill-device');
  d.textContent = labelsFor[state.device];
  d.className = `pill ${state.device === 'available' ? 'on' : 'warn'}`;
  const c = $('#pill-cloud');
  const online = navigator.onLine;
  c.textContent = !ai ? 'Offline demo mode' : online ? 'Cloud: Firebase AI Logic' : 'Cloud: offline';
  c.className = `pill ${ai && online ? 'on' : 'warn'}`;
  const bytes = ledger.list().reduce((s, e) => s + e.bytes, 0);
  $('#pill-bytes').textContent = `${bytes.toLocaleString('en-US')} bytes left this device`;
  ($('#prepare') as HTMLButtonElement).disabled = !ai || state.device === 'available' || state.device === 'no-api';
  $('#prepare').textContent = state.device === 'available' ? 'Private mode ready' : 'Prepare private mode';
}

function renderRules(): void {
  const p = pack();
  $('#rules-note').textContent = `${p.displayName}: ${p.statementMonths} months of statements, ${p.debtRatio.label} comfortable up to ${Math.round(p.debtRatio.comfort * 100)}%, limit around ${Math.round(p.debtRatio.max * 100)}%${p.incomeBasis === 'gross' ? ', on gross income' : ', on net income'}.`;
  show('#gross-label', p.incomeBasis === 'gross');
}

function renderAccounts(): void {
  $('#accounts').innerHTML = state.accounts
    .map(
      (a) =>
        `<li><span><strong>${esc(a.name)}</strong> &middot; ${a.transactions.length} lines</span><span class="note">${esc(state.methods[a.id] ?? (a.origin === 'demo' ? 'synthetic sample' : ''))}</span></li>`,
    )
    .join('');
  ($('#analyze') as HTMLButtonElement).disabled = state.accounts.length === 0;
}

const SOURCE_NAMES: Record<CategorySource, [string, string]> = {
  rule: ['Rules (code)', 'c-rule'],
  on_device: ['Gemini Nano, on device', 'c-device'],
  in_cloud: ['Cloud (synthetic data only)', 'c-cloud'],
  unclassified: ['Unread', 'c-none'],
};

function renderWhoRead(): void {
  const s = state.result!.sources;
  const total = Object.values(s).reduce((a, b) => a + b, 0) || 1;
  const keys = Object.keys(SOURCE_NAMES) as CategorySource[];
  $('#who-read').innerHTML = `<p class="note" style="margin:0">Who read your ${total} lines</p>
    <div class="split" role="img" aria-label="${keys.map((k) => `${SOURCE_NAMES[k][0]} ${s[k]}`).join(', ')}">${keys
      .map((k) => (s[k] ? `<div class="${SOURCE_NAMES[k][1]}" style="width:${(s[k] / total) * 100}%"></div>` : ''))
      .join('')}</div>
    <div class="legend">${keys.map((k) => `<span><i class="${SOURCE_NAMES[k][1]}"></i>${SOURCE_NAMES[k][0]}: ${s[k]}</span>`).join('')}</div>`;
  $('#pipeline-notes').innerHTML = state.result!.notes.map((n) => `<div class="notice">${esc(n)}</div>`).join('');
}

function txRow(t: Transaction): string {
  const [name, cls] = SOURCE_NAMES[t.categorySource ?? 'unclassified'];
  return `<tr><td>${t.date}</td><td>${esc(t.rawLabel)}</td><td class="num">${money(t.amount, 2)}</td><td>${esc((t.category ?? 'other').replace(/_/g, ' '))}</td><td><span class="src"><i class="${cls}"></i>${name}</span></td></tr>`;
}

function renderChecks(): void {
  const a = state.result!;
  const byId = new Map(allTxs().map((t) => [t.id, t]));
  const stepFor = new Map((state.plan?.steps ?? []).map((st) => [st.checkId, st]));
  const words = { ok: 'Fine', watch: 'Watch', alert: 'Fix first' };
  $('#checks').innerHTML = a.checks
    .map((c) => {
      const txs = c.transactionIds.map((id) => byId.get(id)).filter((t): t is Transaction => !!t);
      const step = stepFor.get(c.id);
      return `<li class="check ${c.status}"><span class="dot ${c.status}"></span><div><strong>${esc(c.title)}</strong><p>${esc(c.detail)}</p></div><span class="status-word ${c.status}">${words[c.status]}</span>
        ${txs.length ? `<details><summary>${txs.length} line(s), only on this device</summary><table>${txs.slice(0, 40).map(txRow).join('')}</table></details>` : ''}
        ${step ? `<div class="plan-link">Plan, week ${step.week}: ${esc(step.action)}</div>` : ''}</li>`;
    })
    .join('');
  $('#lines').innerHTML = `<thead><tr><th>Date</th><th>Label</th><th>Amount</th><th>Category</th><th>Read by</th></tr></thead><tbody>${allTxs()
    .slice()
    .sort((x, y) => x.date.localeCompare(y.date))
    .map(txRow)
    .join('')}</tbody>`;

  const obs = a.obligations;
  $('#obligations').innerHTML = obs.length
    ? `<h3>Recurring payments a lender may count as debt</h3>${obs
        .map((o) => {
          const d = state.inputs.obligationDecisions?.[o.key];
          return `<div class="obligation"><span><strong>${esc(o.exampleLabel)}</strong> &middot; ${money(o.monthlyAmount, 2)} a month for ${o.months} months${
            d ? ` &middot; <em>${d === 'debt' ? 'counted as debt' : 'not debt'}</em>` : o.confidence === 'high' ? ' &middot; <em>looks like credit, counted</em>' : ''
          }</span><span><button class="small ghost" data-ob="${esc(o.key)}" data-d="debt">It is credit</button> <button class="small quiet" data-ob="${esc(o.key)}" data-d="not_debt">Not credit</button></span></div>`;
        })
        .join('')}`
    : '';
}

function renderComparison(): void {
  const c = state.comparison;
  show('#compare', !!c);
  if (!c) return;
  const title = (id: string) => state.result?.checks.find((x) => x.id === id)?.title ?? id;
  $('#compare-note').textContent = `${c.daysBetween} day(s) later: ${c.improved} light(s) better, ${c.worsened} worse. ${pack().debtRatio.label}: ${c.debtRatioPct.before}% to ${c.debtRatioPct.after}%.`;
  $('#compare-list').innerHTML = c.checks
    .map(
      (x) =>
        `<li>${x.before ? `<span class="dot ${x.before}"></span>&rarr;` : ''}<span class="dot ${x.after}"></span>${esc(title(x.id))} <span class="trend ${x.trend}">${x.trend}</span></li>`,
    )
    .join('');
}

function setupSimulator(): void {
  const m = state.result!.metrics;
  const h = $<HTMLInputElement>('#sim-h');
  const d = $<HTMLInputElement>('#sim-d');
  h.min = '0';
  h.max = String(Math.max(500, Math.round((state.inputs.projectedHousingPayment * 2) / 50) * 50));
  h.step = '25';
  h.value = String(state.inputs.projectedHousingPayment);
  d.min = '0';
  d.max = String(Math.ceil(m.monthlyDebtPayments));
  d.step = '5';
  d.value = '0';
  updateSimulator();
}

function updateSimulator(): void {
  const m = state.result!.metrics;
  const p = pack();
  const h = Number($<HTMLInputElement>('#sim-h').value);
  const d = Number($<HTMLInputElement>('#sim-d').value);
  const ratio = m.incomeBase > 0 ? (m.monthlyDebtPayments - d + h) / m.incomeBase : Infinity;
  const status = ratio <= p.debtRatio.comfort ? 'ok' : ratio <= p.debtRatio.max ? 'watch' : 'alert';
  $('#sim-h-v').textContent = money(h);
  $('#sim-d-v').textContent = money(d);
  $('#sim-label').textContent = p.debtRatio.label;
  $('#sim-ratio').textContent = Number.isFinite(ratio) ? `${(ratio * 100).toFixed(1)}%` : 'n/a';
  $('#sim-dot').className = `dot ${status}`;
}

function renderPlan(): void {
  const p = state.plan;
  show('#plan-card', !!p);
  if (!p) return;
  const by = p.steps.some((s) => s.wording === 'cloud') ? 'Wording by Gemini in the cloud; every figure computed and filled in on this device.' : 'Built entirely on this device.';
  $('#plan').innerHTML = `<p><strong>${esc(p.summary)}</strong></p><p class="note">${by}</p>
    <table><thead><tr><th>Week</th><th>Action</th><th>Why it matters to the lender</th></tr></thead><tbody>${p.steps
      .map((x) => `<tr><td>${x.week}</td><td><span class="dot ${x.status}" style="width:10px;height:10px;margin:0 6px 0 0"></span>${esc(x.action)}</td><td>${esc(x.why)}</td></tr>`)
      .join('')}
    <tr class="milestone"><td>${p.cleanFromWeek}-12</td><td>Keep every statement clean: these are the months the lender will read.</td><td>Rescan around day 30 and day 60.</td></tr>
    <tr class="milestone"><td>13</td><td>Rescan, check every light, then apply.</td><td></td></tr></tbody></table>`;
  ($('#polish') as HTMLButtonElement).disabled = !ai || !p.steps.length;
  $('#polish-note').textContent = ai ? 'Sends the summary and the step names only (see Privacy).' : 'Needs a Firebase config.';
}

function renderQuestions(): void {
  $('#questions').innerHTML = state.questions
    .map(
      (q, i) =>
        `<label style="margin-top:12px">${esc(q.question)} <span class="note">(${esc(q.checkId.replace(/_/g, ' '))})</span><textarea data-answer="${i}" placeholder="Your answer stays on this device"></textarea></label>`,
    )
    .join('');
  show('#explain-actions', state.questions.length > 0);
  $('#questions-note').textContent = state.questionsBy ?? '';
}

function answers(): Answer[] {
  return state.questions.map((q, i) => ({ ...q, answer: $<HTMLTextAreaElement>(`[data-answer="${i}"]`)?.value ?? '' }));
}

function flaggedTxs(): Transaction[] {
  const ids = new Set(state.result!.checks.filter((c) => c.status !== 'ok').flatMap((c) => c.transactionIds));
  return allTxs().filter((t) => ids.has(t.id));
}

function prefillLetter(): void {
  const txs = flaggedTxs();
  const deposit = txs.filter((t) => t.amount > 0).sort((a, b) => b.amount - a.amount)[0];
  const fees = txs.filter((t) => t.category === 'overdraft_fee' || t.category === 'nsf_fee');
  const v = state.letterValues;
  v.date ||= new Date().toLocaleDateString(pack().locale, { year: 'numeric', month: 'long', day: 'numeric' });
  if (deposit) {
    v.deposit_amount ||= money(deposit.amount, 2);
    v.deposit_date ||= deposit.date;
  }
  if (fees.length) v.overdraft_dates ||= fees.map((t) => t.date).join(', ');
  if (state.explanation) v.explanation = state.explanation.text;
}

function renderLetter(): void {
  const l = state.letter;
  show('#letter-block', !!l);
  if (!l) return;
  prefillLetter();
  const keys = listPlaceholders(l.template).filter((k) => k !== 'explanation');
  $('#letter-fields').innerHTML = keys
    .map((k) => `<label>${esc(k.replace(/_/g, ' '))}<input type="text" data-ph="${esc(k)}" value="${esc(state.letterValues[k] ?? '')}" /></label>`)
    .join('');
  $('#letter-note').textContent = `${l.by} Names, dates and amounts were filled in on this device.`;
  updateLetter();
}

function updateLetter(): void {
  $$<HTMLInputElement>('[data-ph]').forEach((i) => (state.letterValues[i.dataset.ph!] = i.value));
  const { text, missing } = fillTemplate(state.letter!.template, state.letterValues);
  $('#letter-text').textContent = text;
  if (missing.length) $('#letter-note').textContent = `Still to fill: ${missing.join(', ').replace(/_/g, ' ')}.`;
}

function renderAnswer(): void {
  const a = state.answer;
  $('#answer').innerHTML = a
    ? `<div class="answer"><b>${esc(a.sentence)}</b><p class="note">Understood as: ${esc(a.understood)} &middot; ${esc(a.by)}</p>${
        a.transactions.length ? `<div class="scroll"><table>${a.transactions.slice(0, 20).map(txRow).join('')}</table></div>` : ''
      }</div>`
    : '';
}

function renderPrivacy(): void {
  const txs = allTxs();
  $('#stays').innerHTML = txs.length
    ? [
        `${txs.length} transactions with their labels, dates and exact amounts`,
        `${state.accounts.length} account name(s)`,
        'Your answers to the underwriter and your explanation paragraph',
        'Names, dates and amounts in your letter',
        'Your questions about your statements',
      ]
        .map((x) => `<li>${esc(x)}</li>`)
        .join('')
    : '<li>Nothing imported yet</li>';
  const n = state.profile ? Object.keys(state.profile).length - 1 : 0;
  $('#leaves').innerHTML = state.profile
    ? [
        `${n} rounded numbers: income and payment in buckets, ratio in whole percent, event counts`,
        `${state.profile.checks.length} light colours (green, orange, red)`,
        'The names of the plan steps, never their figures',
        'Only when you click a cloud button, and only after a privacy check in code',
      ]
        .map((x) => `<li>${esc(x)}</li>`)
        .join('')
    : '<li>Nothing yet</li>';
  $('#payload').textContent = state.profile
    ? JSON.stringify({ ...state.profile, steps: state.draft ? toCloudSteps(state.draft) : [] }, null, 2)
    : '{}';
}

function renderLedger(): void {
  const rows = ledger.list();
  $('#ledger').innerHTML = rows.length
    ? rows
        .map(
          (e) =>
            `<tr><td>${e.at.slice(11, 19)}</td><td>${esc(e.kind.replace(/_/g, ' '))}</td><td class="num">${e.bytes}</td><td>${esc(e.inferenceSource ?? (e.kind.startsWith('demo') ? 'synthetic data' : '...'))}</td><td><code>${esc(e.payload)}</code></td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="note">Nothing has left this device.</td></tr>';
  renderPills();
}

function setProgress(sel: string, ratio: number | null): void {
  const el = $(sel);
  el.classList.toggle('hidden', ratio === null);
  (el.firstElementChild as HTMLElement).style.width = `${Math.round((ratio ?? 0) * 100)}%`;
}

function notice(sel: string, msg: string): void {
  $(sel).innerHTML = msg ? `<div class="notice">${esc(msg)}</div>` : '';
}

// ---------------------------------------------------------------------------- flows

function readInputs(): void {
  const gross = Number($<HTMLInputElement>('#gross').value);
  state.inputs = {
    ...state.inputs,
    projectedHousingPayment: Number($<HTMLInputElement>('#housing').value) || 0,
    grossMonthlyIncome: pack().incomeBasis === 'gross' && gross > 0 ? gross : undefined,
  };
}

/** After the full pipeline: plan, follow-up comparison, interview reset. */
function afterAnalysis(newScan: boolean): void {
  const a = state.result!;
  state.profile = buildCloudProfile(a, state.inputs.projectedHousingPayment);
  state.draft = buildDraftPlan(a, pack(), state.inputs);
  state.plan = finalisePlan(state.draft);
  if (newScan) {
    const snap = takeSnapshot(state.profile, state.asOf ? new Date(`${state.asOf}T12:00:00Z`) : new Date());
    state.comparison = state.previous ? compareSnapshots(state.previous, snap) : null;
    state.previous = snap;
    if ($<HTMLInputElement>('#keep').checked) saveSnapshot(snap);
    state.questions = [];
    state.questionsBy = undefined;
    state.explanation = undefined;
    state.letter = undefined;
    state.letterValues = {};
    state.answer = undefined;
    $('#explanation').innerHTML = '';
  }
  show('#lender', true);
  show('#explain', true);
  show('#ask', true);
  renderWhoRead();
  renderComparison();
  renderPlan();
  renderChecks();
  setupSimulator();
  renderQuestions();
  renderLetter();
  renderAnswer();
  renderPrivacy();
}

/** Recomputes the lender's view after a decision, without reading the lines again. */
function reanalyse(): void {
  const prev = state.result!;
  state.result = { ...analyze(state.accounts, pack(), state.inputs), sources: prev.sources, notes: prev.notes };
  afterAnalysis(false);
}

async function importFile(file: File, i: number): Promise<Account> {
  const p = pack();
  const id = `user-${Date.now()}-${i}`;
  const opts = { accountId: id, currency: p.currency, country: state.country };
  let transactions: Transaction[];
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const { readPdfInBrowser } = await import('./core/import/pdf');
    const lines = await readPdfInBrowser(await file.arrayBuffer());
    const byLayout = parseWithLayout(lines, opts, new Date().getFullYear());
    if (byLayout.method === 'layout' && byLayout.unreadLines <= byLayout.transactions.length * 0.1) {
      transactions = byLayout.transactions;
      state.methods[id] = `PDF read by layout rules, ${transactions.length} lines`;
    } else if (ai && state.device === 'available') {
      transactions = await ai.readStatementChunks(chunkLines(lines), opts, guessYear(lines, new Date().getFullYear()), (d, t) =>
        setProgress('#an-progress', d / t),
      );
      state.methods[id] = `PDF read by Gemini Nano on this device, ${transactions.length} lines checked against the page`;
    } else {
      throw new Error('this PDF layout is not a classic table: prepare private mode (Gemini Nano) and import it again.');
    }
  } else {
    const text = await file.text();
    const ofx = /<OFX>|OFXHEADER/i.test(text);
    transactions = ofx ? importOfx(text, opts).transactions : importCsv(text, opts).transactions;
    state.methods[id] = `${ofx ? 'OFX' : 'CSV'}, ${transactions.length} lines`;
  }
  if (!transactions.length) throw new Error('no transaction found.');
  return { id, name: file.name, currency: p.currency, country: state.country, origin: 'user', transactions };
}

async function importFiles(files: File[]): Promise<void> {
  if (state.accounts.some((a) => a.origin === 'demo')) state.accounts = [];
  state.asOf = undefined;
  const errors: string[] = [];
  for (const [i, f] of files.entries()) {
    try {
      state.accounts.push(await importFile(f, i));
    } catch (err) {
      errors.push(`${f.name}: ${(err as Error).message}`);
    } finally {
      setProgress('#an-progress', null);
    }
  }
  notice('#import-notes', errors.join(' '));
  renderAccounts();
  renderPrivacy();
}

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------- events

$('#country').addEventListener('change', (e) => {
  state.country = (e.target as HTMLSelectElement).value as CountryCode;
  renderRules();
});

$('#prepare').addEventListener('click', async () => {
  if (!ai) return;
  try {
    setProgress('#dl-progress', 0);
    await ai.prepareOnDevice((p) => setProgress('#dl-progress', p));
  } catch (err) {
    notice('#import-notes', `Gemini Nano could not start: ${(err as Error).message}`);
  } finally {
    state.device = await HybridAI.onDeviceStatus();
    setProgress('#dl-progress', null);
    renderPills();
  }
});

$$('[data-demo]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const p = DEMO_PERSONAS[Number(btn.dataset.demo)]();
    state.country = p.country;
    $<HTMLSelectElement>('#country').value = p.country;
    state.accounts = p.accounts;
    state.methods = {};
    state.asOf = p.asOf;
    state.inputs = { projectedHousingPayment: p.projectedHousingPayment };
    $<HTMLInputElement>('#gross').value = p.grossMonthlyIncome ? String(p.grossMonthlyIncome) : '';
    $<HTMLInputElement>('#housing').value = String(p.projectedHousingPayment);
    notice('#import-notes', '');
    renderRules();
    renderAccounts();
    renderPrivacy();
    $('#analyze').focus();
  }),
);

$$('[data-sample]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const acc = DEMO_PERSONAS[0]().accounts[0];
    const kind = btn.dataset.sample!;
    if (kind === 'csv') return download('maya-checking-sample.csv', accountToCsv(acc), 'text/csv');
    const { accountToPdf } = await import('./demo/statement-pdf');
    const bytes = await accountToPdf(acc, 'Maya (synthetic sample)', kind === 'pdf-compact' ? 'compact' : 'classic');
    download(kind === 'pdf' ? 'maya-checking-sample.pdf' : 'maya-checking-sample-unusual.pdf', bytes as BlobPart, 'application/pdf');
  }),
);

$('#files').addEventListener('change', (e) => importFiles([...((e.target as HTMLInputElement).files ?? [])]));
const drop = $('#drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  importFiles([...(e.dataTransfer?.files ?? [])]);
});

$('#clear-accounts').addEventListener('click', () => {
  state.accounts = [];
  state.methods = {};
  renderAccounts();
  renderPrivacy();
});

$('#analyze').addEventListener('click', async () => {
  readInputs();
  try {
    setProgress('#an-progress', 0.05);
    state.result = await runPipeline(state.accounts, pack(), state.inputs, ai, (p) =>
      setProgress('#an-progress', p.total ? (p.done ?? 0) / p.total : p.stage === 'analysis' ? 1 : 0.2),
    );
    afterAnalysis(true);
    $('#lender').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    notice('#import-notes', `Analysis stopped: ${(err as Error).message}`);
  } finally {
    setProgress('#an-progress', null);
  }
});

$('#obligations').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ob]');
  if (!b) return;
  state.inputs.obligationDecisions = { ...state.inputs.obligationDecisions, [b.dataset.ob!]: b.dataset.d as 'debt' | 'not_debt' };
  reanalyse();
});

$('#sim-h').addEventListener('input', updateSimulator);
$('#sim-d').addEventListener('input', updateSimulator);
$('#sim-apply').addEventListener('click', () => {
  const h = Number($<HTMLInputElement>('#sim-h').value);
  $<HTMLInputElement>('#housing').value = String(h);
  state.inputs.projectedHousingPayment = h;
  reanalyse();
});

$('#polish').addEventListener('click', async () => {
  if (!ai || !state.profile || !state.draft) return;
  const b = $<HTMLButtonElement>('#polish');
  b.disabled = true;
  try {
    state.plan = await ai.generatePlan(state.profile, state.draft, labels());
    renderPlan();
    renderChecks();
  } catch (err) {
    $('#polish-note').textContent = `Kept the local wording: ${(err as Error).message}`;
  } finally {
    b.disabled = false;
  }
});

$('#get-questions').addEventListener('click', async () => {
  if (!state.result || !state.profile) return;
  const b = $<HTMLButtonElement>('#get-questions');
  b.disabled = true;
  state.questions = [];
  state.questionsBy = undefined;
  try {
    if (ai && navigator.onLine) {
      state.questions = await ai.interviewQuestions(state.profile, labels());
      state.questionsBy = 'Asked by Gemini in the cloud, from the summary only.';
    }
  } catch (err) {
    state.questionsBy = `Cloud unavailable (${(err as Error).message}); standard questions used.`;
  }
  if (!state.questions.length) {
    state.questions = defaultQuestions(state.result.checks);
    state.questionsBy ??= 'Standard questions (no cloud).';
  }
  b.disabled = false;
  renderQuestions();
});

$('#write-explanation').addEventListener('click', async () => {
  const ans = answers();
  if (!ans.some((a) => a.answer.trim())) {
    $('#explanation-note').textContent = 'Answer at least one question first.';
    return;
  }
  const b = $<HTMLButtonElement>('#write-explanation');
  b.disabled = true;
  let by = 'Written from your answers (no on-device model).';
  let text = templateExplanation(ans);
  try {
    if (ai && (origin() === 'demo' || state.device === 'available')) {
      const r = await ai.writeExplanation(ans, flaggedTxs(), pack().currency, origin());
      text = r.text;
      by =
        r.by === 'on_device'
          ? 'Written by Gemini Nano on this device.'
          : r.by === 'in_cloud'
            ? 'Written in the cloud (synthetic sample only).'
            : 'The model added facts you did not give, so your own answers were used instead.';
    }
  } catch (err) {
    by = `On-device model unavailable (${(err as Error).message}); written from your answers.`;
  }
  state.explanation = { text, by };
  $('#explanation').innerHTML = `<h3>Your explanation</h3><textarea id="explanation-text" style="min-height:120px">${esc(text)}</textarea><p class="note">${esc(by)} Edit it freely.</p>`;
  $('#explanation-text').addEventListener('input', (e) => {
    state.explanation!.text = (e.target as HTMLTextAreaElement).value;
    state.letterValues.explanation = state.explanation!.text;
    if (state.letter) updateLetter();
  });
  // Letter template: from the cloud when possible (summary only), local otherwise.
  if (!state.letter) {
    let template = LOCAL_LETTER_TEMPLATE;
    let tby = 'Local letter template.';
    try {
      if (ai && navigator.onLine && state.profile) {
        const t = await ai.generateLetterTemplate(state.profile, labels());
        if (t.template.includes('{{explanation}}')) {
          template = t.template;
          tby = 'Template written by Gemini in the cloud, with blanks only.';
        }
      }
    } catch {
      /* keep the local template */
    }
    state.letter = { template, by: tby };
  }
  b.disabled = false;
  renderLetter();
});

$('#letter-fields').addEventListener('input', updateLetter);
$('#copy-letter').addEventListener('click', () => navigator.clipboard?.writeText($('#letter-text').textContent ?? ''));
$('#download-letter').addEventListener('click', () => download('letter-of-explanation.txt', $('#letter-text').textContent ?? '', 'text/plain'));

async function ask(question: string): Promise<void> {
  if (!state.result || !question.trim()) return;
  const months = [...new Set(allTxs().map((t) => t.date.slice(0, 7)))].sort();
  let query = null;
  let by = 'Understood by keyword rules (no on-device model).';
  try {
    if (ai && (origin() === 'demo' || state.device === 'available')) {
      query = await ai.understandQuestion(question, months, origin());
      by = 'Understood by Gemini Nano; computed by code on this device.';
    }
  } catch {
    query = null;
  }
  if (!query) {
    query = guessQuery(question, months);
    by = 'Understood by keyword rules (no on-device model).';
  }
  state.answer = { ...runQuery(query, allTxs(), pack().currency, pack().locale), by };
  renderAnswer();
}
$('#ask-btn').addEventListener('click', () => ask($<HTMLInputElement>('#question').value));
$('#question').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ask($<HTMLInputElement>('#question').value);
});
$$('[data-q]').forEach((b) =>
  b.addEventListener('click', () => {
    $<HTMLInputElement>('#question').value = b.dataset.q!;
    ask(b.dataset.q!);
  }),
);

$('#keep').addEventListener('change', (e) => {
  if ((e.target as HTMLInputElement).checked && state.previous) saveSnapshot(state.previous);
  if (!(e.target as HTMLInputElement).checked) clearSnapshot();
});

$('#erase').addEventListener('click', () => {
  clearSnapshot();
  location.reload();
});

window.addEventListener('online', renderPills);
window.addEventListener('offline', renderPills);

// ---------------------------------------------------------------------------- start

$<HTMLInputElement>('#keep').checked = loadSnapshot() !== null;
ledger.onChange(renderLedger);
renderRules();
renderAccounts();
renderLedger();
HybridAI.onDeviceStatus().then((s) => {
  state.device = s;
  renderPills();
});
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
