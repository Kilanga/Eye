import './styles.css';
import { HybridAI, type OnDeviceStatus } from './ai/models';
import { analyze } from './core/analyze';
import { guessQuery, reconcileQuery, runQuery, type QueryAnswer } from './core/ask';
import { documentsFor, GIFT_LETTER_TEMPLATE } from './core/documents';
import {
  applyAnswer,
  CHOICES_IN,
  CHOICES_OUT,
  clearPersonalRules,
  fingerprint,
  loadPersonalRules,
  pickQuestions,
  savePersonalRules,
  type PersonalRules,
} from './core/clarify';
import { clearSnapshot, compareSnapshots, loadSnapshot, saveSnapshot, takeSnapshot, type Comparison, type Snapshot } from './core/followup';
import { importCsv } from './core/import/csv';
import { importOfx } from './core/import/ofx';
import { chunkLines, guessYear, lineText, parseWithLayout } from './core/import/statement-text';
import { defaultQuestions, LOCAL_LETTER_TEMPLATE, templateExplanation, type Answer, type InterviewQuestion } from './core/interview';
import { OutboundLedger } from './core/ledger';
import { fillTemplate, listPlaceholders } from './core/letter';
import { buildDraftPlan, finalisePlan, toCloudSteps, type DraftPlan, type FinalPlan } from './core/plan';
import { buildCloudProfile, type CloudProfile } from './core/profile';
import { getRulePack, PROGRAMS_BY_COUNTRY } from './core/rules';
import type { Account, Category, CategorySource, CheckResult, CheckStatus, CountryCode, DataOrigin, LoanProgram, Transaction, UserInputs } from './core/types';
import { accountToCsv, DEMO_PERSONAS } from './demo/generate';
import { initFirebase } from './firebase';
import { loadSettings } from './remote-config';
import { DEFAULT_SETTINGS, type AppSettings } from './core/settings';
import { runPipeline, type PipelineResult } from './pipeline';

/*
 * Accessibility notes (WCAG 2.2 AA):
 *  - landmarks, a skip link, one h1, one h2 per step; focus moves to the results after the analysis
 *  - every status says it in words and with a shape, never with colour alone
 *  - progress and results are announced in a polite live region; errors in an alert
 *  - all targets are at least 44px high; the layout reflows to one column at 320px
 */

// ---------------------------------------------------------------------------- state

const ledger = new OutboundLedger();
const app = initFirebase();
const ai = app ? new HybridAI(app, ledger) : null;
/** App settings from Firebase Remote Config (cloud model, cloud on/off, number of questions). */
let settings: AppSettings = DEFAULT_SETTINGS;
if (app && ai) {
  void loadSettings(app, ledger).then((loaded) => {
    settings = loaded.settings;
    ai.configure(settings);
    renderStatus();
    if (state.result) renderClarify();
  });
}

interface State {
  country: CountryCode;
  program: LoanProgram;
  accounts: Account[];
  methods: Record<string, string>;
  sample?: number;
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
  giftValues: Record<string, string>;
  docsDone: Record<string, boolean>;
  answer?: QueryAnswer & { by: string };
  personalRules: PersonalRules;
  examples: { label: string; amount: number; category: string; origin: DataOrigin }[];
  answered: Record<string, Category | 'skip'>;
}

const state: State = {
  country: 'US',
  program: 'conventional',
  accounts: [],
  methods: {},
  inputs: { projectedHousingPayment: 0 },
  device: 'no-api',
  previous: loadSnapshot(),
  questions: [],
  letterValues: {},
  giftValues: {},
  docsDone: {},
  personalRules: loadPersonalRules(),
  examples: [],
  answered: {},
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pack = () => getRulePack(state.country, state.program);
const money = (n: number, digits = 0) =>
  new Intl.NumberFormat(pack().locale, {
    style: 'currency',
    currency: pack().currency,
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
const origin = (): DataOrigin => (state.accounts.some((a) => a.origin === 'user') ? 'user' : 'demo');
const allTxs = () => state.accounts.flatMap((a) => a.transactions);
const labels = () => allTxs().map((t) => t.rawLabel);
const show = (sel: string, on: boolean) => $(sel).classList.toggle('hidden', !on);

/** Polite announcement for screen readers (progress, results). */
function announce(msg: string): void {
  const live = $('#live');
  live.textContent = '';
  window.setTimeout(() => (live.textContent = msg), 50);
}

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="3" width="22" height="26" rx="2" fill="#fff" stroke="currentColor" stroke-width="2"/><path d="M9 10h14M9 15h14M9 20h9" stroke="currentColor" stroke-width="2"/><path d="M8 14h16v3H8z" fill="#ffe066" opacity=".9"/><path d="M9 15h14" stroke="currentColor" stroke-width="2"/></svg>`;

const VERDICT: Record<CheckStatus, { word: string; svg: string }> = {
  ok: {
    word: 'Clear',
    svg: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 10.5l2.6 2.6L14.2 7" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`,
  },
  watch: {
    word: 'Expect questions',
    svg: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2L19 18H1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 8v4.5M10 14.6v.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  },
  alert: {
    word: 'Fix first',
    svg: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 1.5h7l5 5v7l-5 5h-7l-5-5v-7z" fill="currentColor"/><path d="M7 7l6 6M13 7l-6 6" stroke="#fff" stroke-width="2.2"/></svg>`,
  },
};
const RANK: Record<CheckStatus, number> = { alert: 0, watch: 1, ok: 2 };
const PROGRAM_NAMES: Record<LoanProgram, string> = {
  conventional: 'Conventional mortgage',
  fha: 'FHA loan (government-insured)',
  va: 'VA loan (veterans)',
  bank_statement: 'Bank statement loan (self-employed)',
  standard: 'Standard mortgage',
};

// ---------------------------------------------------------------------------- page

document.querySelector('#app')!.innerHTML = `
<a class="skip" href="#main">Skip to the content</a>
<header class="masthead">
  <div class="masthead-inner">
    <a class="wordmark" href="#top">${LOGO}<span>Underwriter's Eye</span></a>
    <ul class="status-line" aria-label="Status">
      <li id="st-device">On-device model</li>
      <li id="st-cloud"></li>
      <li id="st-bytes">Nothing sent from this device</li>
    </ul>
  </div>
</header>

<div class="layout">
  <nav class="steps" aria-label="Steps">
    <ol id="steps-list"></ol>
    <a class="privacy-link" href="#privacy">What left this device</a>
  </nav>

  <main id="main" tabindex="-1">
    <div class="intro" id="top">
      <div>
        <h1>See your bank statements the way a lender will.</h1>
        <p>Before a mortgage, an underwriter reads your last months of statements line by line and marks what needs explaining. Do it first, on your own computer, and fix what you can before you apply.</p>
        <p class="promise">Your statements are read on this device and never uploaded.</p>
        <div class="intro-actions">
          <a class="btn" href="#application">Check my statements</a>
          <a class="btn secondary" href="#samples">Try a sample file</a>
        </div>
      </div>
      <figure class="excerpt" aria-labelledby="excerpt-caption">
        <div class="row"><span>10/03 BRIGHTWAVE PAYROLL</span><span>2,450.00</span></div>
        <div class="row"><span><mark>10/14 MOBILE DEPOSIT</mark></span><span><mark>6,000.00</mark></span></div>
        <div class="row"><span><mark>10/18 STAR CASINO</mark></span><span><mark>-40.00</mark></span></div>
        <div class="row"><span><mark class="fix">10/29 OVERDRAFT FEE</mark></span><span><mark class="fix">-35.00</mark></span></div>
        <figcaption class="note" id="excerpt-caption">Underwriter's note: where did the $6,000 come from? Why the overdraft?</figcaption>
      </figure>
    </div>

    <section class="sheet" id="application" aria-labelledby="h-application">
      <h2 id="h-application" tabindex="-1"><span class="n">1</span>Your application</h2>
      <p class="lead">The rules depend on where you apply and on the type of loan.</p>
      <fieldset>
        <legend class="sr-only">Application details</legend>
        <div class="fields">
          <div class="field"><label for="country">Country</label><select id="country"><option value="US">United States</option><option value="FR">France</option></select></div>
          <div class="field" id="program-field"><label for="program">Type of loan</label><select id="program"></select></div>
          <div class="field" id="gross-field"><label for="gross">Monthly income before tax</label><input type="number" id="gross" inputmode="decimal" min="0" step="50" aria-describedby="gross-hint" /><span class="hint" id="gross-hint">Lenders in the US use gross income.</span></div>
          <div class="field"><label for="housing">Monthly housing payment you are aiming for</label><input type="number" id="housing" inputmode="decimal" min="0" step="50" aria-describedby="housing-hint" /><span class="hint" id="housing-hint">Loan, taxes and insurance together.</span></div>
          <div class="field" id="cash-field"><label for="cash">Cash you need at closing (optional)</label><input type="number" id="cash" inputmode="decimal" min="0" step="500" aria-describedby="cash-hint" /><span class="hint" id="cash-hint">Down payment and closing costs, to check your funds.</span></div>
        </div>
      </fieldset>
      <fieldset class="hidden" id="se-fields">
        <legend>Self-employed</legend>
        <div class="fields">
          <div class="field"><label for="kind">Your statements are from</label><select id="kind"><option value="business">a business account</option><option value="personal">a personal account</option></select></div>
          <div class="field"><label for="expense">Business expenses, as a share of deposits (%)</label><input type="number" id="expense" min="0" max="90" step="5" value="50" aria-describedby="expense-hint" /><span class="hint" id="expense-hint">Lenders use 50% unless a CPA letter shows less.</span></div>
        </div>
      </fieldset>
      <p class="note" id="rules-note"></p>
      <div class="actions" id="model-actions">
        <button type="button" class="btn secondary" id="prepare">Download the on-device model</button>
        <span class="note" id="prepare-note">A one-time download that lets Gemini Nano read your statements privately on this computer.</span>
      </div>
      <div class="progress hidden" id="dl-progress" role="progressbar" aria-label="Model download" aria-valuemin="0" aria-valuemax="100"><div></div></div>
    </section>

    <section class="sheet" id="statements" aria-labelledby="h-statements">
      <h2 id="h-statements" tabindex="-1"><span class="n">2</span>Your statements</h2>
      <p class="lead">One file per account, for the last two months at least. PDF statements from online banking work best; CSV and OFX exports work too.</p>
      <div class="drop" id="drop">
        <p><strong>Drop your files here</strong></p>
        <p class="note">or</p>
        <span class="file-pick"><span class="btn secondary" aria-hidden="true">Choose files</span><input type="file" id="files" multiple accept=".csv,.ofx,.qfx,.txt,.pdf" aria-label="Choose statement files (PDF, CSV or OFX)" /></span>
        <p class="note">The files are read in this browser. Nothing is uploaded.</p>
      </div>
      <div class="samples" id="samples">
        <h3>No statements at hand? Use a sample file</h3>
        <p class="note">Invented people and banks, so you can see every step.</p>
        <ul>${DEMO_PERSONAS.map((p, i) => {
          const d = p();
          return `<li><button type="button" class="sample" data-demo="${i}" aria-pressed="false"><strong>${esc(d.title.replace(' (synthetic)', ''))}</strong><span>${esc(d.description)}</span></button></li>`;
        }).join('')}</ul>
        <div class="sample-files">
          <p class="note" id="sample-files-label">Or download Maya's files and import them like your own:</p>
          <div class="sample-file-buttons" role="group" aria-labelledby="sample-files-label">
            <button type="button" class="btn secondary small" data-sample="csv">CSV export</button>
            <button type="button" class="btn secondary small" data-sample="pdf">PDF statement</button>
            <button type="button" class="btn secondary small" data-sample="pdf-compact">PDF, unusual layout</button>
          </div>
        </div>
      </div>
      <ul class="accounts" id="accounts" aria-label="Statements added"></ul>
      <div id="import-notes"></div>
      <div class="actions">
        <button type="button" class="btn" id="analyze" disabled>Review my statements</button>
        <button type="button" class="btn link" id="clear-accounts">Remove all statements</button>
      </div>
      <div class="progress hidden" id="an-progress" role="progressbar" aria-label="Review progress" aria-valuemin="0" aria-valuemax="100"><div></div></div>
    </section>

    <section class="sheet hidden" id="review" aria-labelledby="h-review">
      <h2 id="h-review" tabindex="-1"><span class="n">3</span>What the lender will see</h2>
      <p class="lead" id="review-lead"></p>
      <div class="readers" id="who-read"></div>
      <div id="pipeline-notes"></div>
      <div id="clarify"></div>
      <div class="compare hidden" id="compare"><h3>Since your last review</h3><p id="compare-note"></p><ul id="compare-list"></ul></div>
      <ol class="findings" id="findings" aria-label="Findings, most serious first"></ol>
      <div id="obligations"></div>
      <h3 id="h-sim">Try another target</h3>
      <div class="sim" role="group" aria-labelledby="h-sim">
        <div class="field"><label for="sim-h">Housing payment: <output id="sim-h-v" for="sim-h"></output></label><input type="range" id="sim-h" /></div>
        <div class="field"><label for="sim-d">Debt payments paid off: <output id="sim-d-v" for="sim-d"></output></label><input type="range" id="sim-d" /></div>
        <div class="sim-result" aria-live="polite"><span class="note" id="sim-label"></span><span class="ratio" id="sim-ratio"></span><span id="sim-verdict"></span></div>
      </div>
      <div class="actions"><button type="button" class="btn secondary" id="sim-apply">Use this housing payment</button></div>
      <details style="margin-top:1.5rem"><summary>Every line, and who read it</summary><div class="scroll" tabindex="0" role="region" aria-label="All statement lines"><table class="lines" id="lines"></table></div></details>
    </section>

    <section class="sheet hidden" id="plan-card" aria-labelledby="h-plan">
      <h2 id="h-plan" tabindex="-1"><span class="n">4</span>Your 90-day plan</h2>
      <p class="lead">The steps and the figures are worked out on this device. Review again after 30 and 60 days.</p>
      <div id="plan"></div>
      <div class="actions"><button type="button" class="btn secondary" id="polish">Reword the plan with Gemini</button><span class="note" id="polish-note"></span></div>
    </section>

    <section class="sheet hidden" id="explain" aria-labelledby="h-explain">
      <h2 id="h-explain" tabindex="-1"><span class="n">5</span>Explain it to the lender</h2>
      <p class="lead">An underwriter asks about everything marked above. Prepare your answers and your documents now.</p>
      <div id="docs"></div>
      <h3>The underwriter's questions</h3>
      <div class="actions" style="margin-top:0"><button type="button" class="btn" id="get-questions">Show the questions</button><span class="note" id="questions-note"></span></div>
      <div id="questions"></div>
      <div class="actions hidden" id="explain-actions"><button type="button" class="btn" id="write-explanation">Write my explanation</button><span class="note" id="explanation-note">Your answers stay on this device.</span></div>
      <div id="explanation"></div>
      <div id="letter-block" class="hidden">
        <h3>Your letter of explanation</h3>
        <div class="fields" id="letter-fields"></div>
        <div class="letter" id="letter-text" style="margin-top:1rem" aria-live="polite"></div>
        <div class="actions"><button type="button" class="btn secondary" id="copy-letter">Copy the letter</button><button type="button" class="btn secondary" id="download-letter">Download the letter</button><span class="note" id="letter-note"></span></div>
      </div>
      <h3>Gift letter</h3>
      <p class="note">If a relative gave you money toward the home, the lender will ask for a signed gift letter.</p>
      <div class="actions" style="margin-top:0"><button type="button" class="btn secondary" id="gift-btn" aria-expanded="false" aria-controls="gift-block">Prepare a gift letter</button></div>
      <div id="gift-block" class="hidden">
        <div class="fields" id="gift-fields" style="margin-top:1rem"></div>
        <div class="letter" id="gift-text" style="margin-top:1rem"></div>
        <div class="actions"><button type="button" class="btn secondary" id="download-gift">Download the gift letter</button><span class="note">Filled in on this device. The donor signs it.</span></div>
      </div>
    </section>

    <section class="sheet hidden" id="ask" aria-labelledby="h-ask">
      <h2 id="h-ask" tabindex="-1"><span class="n">6</span>Ask your statements</h2>
      <p class="lead">Gemini Nano turns your question into a search on this device. The totals are counted by the app, not guessed.</p>
      <form class="ask-row" id="ask-form">
        <div class="field"><label for="question">Your question</label><input type="text" id="question" autocomplete="off" /></div>
        <button type="submit" class="btn">Ask</button>
      </form>
      <ul class="suggestions" aria-label="Example questions">${[
        'How much did I pay in bank fees?',
        'What was my largest deposit?',
        'How much do I spend on groceries per month?',
        'How many payments did I send to people?',
      ]
        .map((q) => `<li><button type="button" data-q="${esc(q)}">${esc(q)}</button></li>`)
        .join('')}</ul>
      <div id="answer" aria-live="polite"></div>
    </section>

    <section class="sheet" id="privacy" aria-labelledby="h-privacy">
      <h2 id="h-privacy" tabindex="-1">What left this device</h2>
      <div class="flow">
        <div><h3>Stays on this device</h3><ul id="stays"><li>Nothing added yet.</li></ul></div>
        <div><h3>Can be sent to Gemini in the cloud</h3><ul id="leaves"><li>Nothing yet.</li></ul></div>
      </div>
      <details><summary>The exact summary, as it would be sent</summary><pre id="payload" tabindex="0">{}</pre></details>
      <h3>Every request sent</h3>
      <p class="note">Byte for byte, with where Firebase says the answer came from.</p>
      <div class="scroll" tabindex="0" role="region" aria-label="Requests sent"><table class="ledger"><thead><tr><th scope="col">Time</th><th scope="col">What</th><th scope="col">Bytes</th><th scope="col">Answered by</th><th scope="col">Content</th></tr></thead><tbody id="ledger"></tbody></table></div>
      <div class="check-row" style="margin-top:1.25rem"><input type="checkbox" id="keep" /><label for="keep">Keep the summary (numbers and results, no statements) in this browser so the next review can compare</label></div>
      <div class="actions"><button type="button" class="btn secondary" id="erase">Erase everything from this browser</button></div>
    </section>
  </main>
</div>
<footer>Educational tool, not financial or legal advice. Every sample person, bank and business is invented. Thresholds and their sources are listed in the project README.</footer>
<div id="live" class="sr-only" role="status" aria-live="polite"></div>
`;

// ---------------------------------------------------------------------------- rendering

const STEPS: [string, string][] = [
  ['application', 'Your application'],
  ['statements', 'Your statements'],
  ['review', 'What the lender sees'],
  ['plan-card', '90-day plan'],
  ['explain', 'Explain it'],
  ['ask', 'Ask your statements'],
];
let currentStep = 'application';

function renderSteps(): void {
  const reviewed = !!state.result;
  $('#steps-list').innerHTML = STEPS.map(([id, name], i) => {
    const locked = i >= 2 && !reviewed;
    const done = (id === 'application' && state.accounts.length > 0) || (id === 'statements' && reviewed);
    if (locked) return `<li><a class="locked" aria-disabled="true">${name}<span class="sr-only"> (after the review)</span></a></li>`;
    return `<li><a href="#${id}" class="${done ? 'done' : ''}" ${id === currentStep ? 'aria-current="step"' : ''}>${name}${done ? '<span class="sr-only"> (done)</span>' : ''}</a></li>`;
  }).join('');
}

function renderStatus(): void {
  const device: Record<OnDeviceStatus, string> = {
    available: 'On-device model ready',
    downloadable: 'On-device model not downloaded',
    downloading: 'On-device model downloading',
    unavailable: 'On-device model not available on this computer',
    'no-api': 'This browser has no on-device model',
  };
  const d = $('#st-device');
  d.textContent = device[state.device];
  d.className = state.device === 'available' ? 'on' : '';
  const c = $('#st-cloud');
  c.textContent = !ai ? 'Cloud off (demo mode)' : !ai.cloudEnabled ? 'Cloud paused in the app settings' : navigator.onLine ? 'Cloud connected' : 'Offline';
  c.className = ai && ai.cloudEnabled && navigator.onLine ? 'on' : '';
  const bytes = ledger.list().filter((e) => e.kind !== 'app_settings').reduce((s, e) => s + e.bytes, 0);
  $('#st-bytes').textContent = bytes ? `${bytes.toLocaleString('en-US')} bytes about your file sent from this device` : 'Nothing about your file sent from this device';
  const prep = $<HTMLButtonElement>('#prepare');
  prep.disabled = !ai || state.device === 'available' || state.device === 'no-api' || state.device === 'unavailable';
  prep.textContent = state.device === 'available' ? 'On-device model ready' : 'Download the on-device model';
  $('#prepare-note').textContent =
    state.device === 'available'
      ? 'Gemini Nano reads your statements on this computer.'
      : state.device === 'no-api' || state.device === 'unavailable'
        ? 'Not available here: your own statements are read by the built-in rules only. Desktop Chrome supports it.'
        : 'A one-time download that lets Gemini Nano read your statements privately on this computer.';
}

function renderRules(): void {
  const progs = PROGRAMS_BY_COUNTRY[state.country];
  if (!progs.some((p) => p.program === state.program)) state.program = progs[0].program;
  $('#program').innerHTML = progs
    .map((p) => `<option value="${p.program}" ${p.program === state.program ? 'selected' : ''}>${PROGRAM_NAMES[p.program]}</option>`)
    .join('');
  show('#program-field', progs.length > 1);
  show('#cash-field', state.country === 'US');
  const p = pack();
  show('#gross-field', p.incomeBasis === 'gross');
  show('#se-fields', p.incomeBasis === 'deposits');
  const income = p.incomeBasis === 'gross' ? 'gross income' : p.incomeBasis === 'net' ? 'net income' : 'eligible deposits';
  $('#rules-note').textContent = `These rules ask for ${p.statementMonths} months of statements and look at your ${p.debtRatio.label.replace(/ \(.*\)/, '').replace(/^./, (c) => c.toLowerCase())} on ${income}: comfortable up to ${Math.round(p.debtRatio.comfort * 100)}%, hard to approve above ${Math.round(p.debtRatio.max * 100)}%.`;
}

function renderAccounts(): void {
  $('#accounts').innerHTML = state.accounts
    .map((a) => `<li><span><strong>${esc(a.name)}</strong>, ${a.transactions.length} lines</span><span class="how">${esc(state.methods[a.id] ?? (a.origin === 'demo' ? 'Sample file' : ''))}</span></li>`)
    .join('');
  $<HTMLButtonElement>('#analyze').disabled = state.accounts.length === 0;
  show('#clear-accounts', state.accounts.length > 0);
  $$<HTMLButtonElement>('[data-demo]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.demo) === state.sample)));
  renderSteps();
}

const SOURCE_NAMES: Record<CategorySource, [string, string]> = {
  rule: ['Built-in rules', 'c-rule'],
  user: ['Your answers', 'c-user'],
  on_device: ['Gemini Nano, on this device', 'c-device'],
  in_cloud: ['Cloud (sample files only)', 'c-cloud'],
  unclassified: ['Not recognised', 'c-none'],
};

function renderWhoRead(): void {
  const s = state.result!.sources;
  const total = Object.values(s).reduce((a, b) => a + b, 0) || 1;
  const keys = (Object.keys(SOURCE_NAMES) as CategorySource[]).filter((k) => s[k] > 0);
  $('#who-read').innerHTML = `<p class="note" style="margin:0">Who read your ${total} lines</p>
    <div class="split" aria-hidden="true">${keys.map((k) => `<div class="${SOURCE_NAMES[k][1]}" style="width:${(s[k] / total) * 100}%"></div>`).join('')}</div>
    <ul class="legend">${keys.map((k) => `<li><span class="swatch ${SOURCE_NAMES[k][1]}" aria-hidden="true"></span>${SOURCE_NAMES[k][0]}: ${s[k]}</li>`).join('')}</ul>`;
  $('#pipeline-notes').innerHTML = state.result!.notes.map((n) => `<p class="notice">${esc(n)}</p>`).join('');
}

function txRows(txs: Transaction[], flagged: Map<string, CheckStatus>, withSource = true): string {
  return txs
    .map((t) => {
      const f = flagged.get(t.id);
      const label = f ? `<mark class="${f === 'alert' ? 'fix' : ''}">${esc(t.rawLabel)}</mark>` : esc(t.rawLabel);
      const src = withSource ? `<td class="by">${SOURCE_NAMES[t.categorySource ?? 'unclassified'][0]}</td>` : '';
      return `<tr><td>${t.date}</td><td>${label}</td><td class="amt">${money(t.amount, 2)}</td><td class="by">${esc((t.category ?? 'other').replace(/_/g, ' '))}</td>${src}</tr>`;
    })
    .join('');
}

function linesTable(txs: Transaction[], flagged: Map<string, CheckStatus>, caption: string, withSource = true): string {
  return `<table class="lines"><caption class="sr-only">${esc(caption)}</caption><thead><tr><th scope="col">Date</th><th scope="col">Line</th><th scope="col" class="amt">Amount</th><th scope="col">Type</th>${
    withSource ? '<th scope="col">Read by</th>' : ''
  }</tr></thead><tbody>${txRows(txs, flagged, withSource)}</tbody></table>`;
}

function flaggedMap(): Map<string, CheckStatus> {
  const m = new Map<string, CheckStatus>();
  for (const c of state.result?.checks ?? []) if (c.status !== 'ok') c.transactionIds.forEach((id) => m.set(id, c.status));
  return m;
}

function renderClarify(): void {
  const r = state.result!;
  const qs = pickQuestions(allTxs(), r.metrics.incomeBase, settings.maxQuestions).filter((q) => state.answered[q.key] !== 'skip');
  const unsure = allTxs().filter((t) => t.categorySource === 'unclassified' || t.categoryConfidence === 'low').length;
  const remembered = Object.keys(state.personalRules).length;
  if (!qs.length && !remembered) {
    $('#clarify').innerHTML = '';
    return;
  }
  $('#clarify').innerHTML = `<div class="clarify">
    <h3 id="h-clarify">${qs.length ? `Help the app read ${unsure === 1 ? 'one line' : `${unsure} lines`} it is not sure about` : 'Your answers'}</h3>
    ${qs.length ? `<p class="note">${qs.length === 1 ? 'One question' : `${qs.length} questions`}, the ones that can change a result. Each answer applies to every line of the same name, now and in your next reviews.</p>` : ''}
    ${qs
      .map((q, i) => {
        const choices = q.direction === 'in' ? CHOICES_IN : CHOICES_OUT;
        const meta = `${q.count === 1 ? 'one line' : `${q.count} lines`}, ${money(q.total, 2)} ${q.direction === 'in' ? 'received' : 'paid'}${q.months > 1 ? ` over ${q.months} months` : ''}`;
        return `<fieldset class="question-set" data-key="${esc(q.key)}">
          <legend><span class="label">${esc(q.exampleLabel)}</span><span class="note"> ${esc(meta)}</span></legend>
          <p class="note">${esc(q.reason)}${q.guess ? ` Gemini Nano guessed ${esc(q.guess.replace(/_/g, ' '))}, without certainty.` : ''}</p>
          <div class="choices">${choices
            .map((c, j) => `<label class="choice"><input type="radio" name="q-${i}" value="${c.category}" data-key="${esc(q.key)}" ${j === 0 ? '' : ''} /> ${esc(c.label)}</label>`)
            .join('')}</div>
          <button type="button" class="btn link skip-q" data-skip="${esc(q.key)}">Skip this one</button>
        </fieldset>`;
      })
      .join('')}
    <div class="check-row"><input type="checkbox" id="remember" ${remembered ? 'checked' : ''} aria-describedby="remember-hint" /><label for="remember">Remember my answers on this browser</label></div>
    <p class="note" id="remember-hint">Stored as a fingerprint that cannot be read back, never the merchant name. ${remembered ? `${remembered === 1 ? 'One answer' : `${remembered} answers`} remembered.` : ''} The lender still sees the real lines.</p>
    ${remembered ? '<button type="button" class="btn link" id="forget-answers">Forget my remembered answers</button>' : ''}
  </div>`;
}

function recountSources(): Record<CategorySource, number> {
  const s: Record<CategorySource, number> = { rule: 0, user: 0, on_device: 0, in_cloud: 0, unclassified: 0 };
  allTxs().forEach((t) => s[t.categorySource ?? 'unclassified']++);
  return s;
}

async function answerQuestion(key: string, category: Category): Promise<void> {
  const before = state.result!;
  const changed = applyAnswer(allTxs(), key, category);
  if (!changed.length) return;
  state.answered[key] = category;
  const t = changed[0];
  state.examples.push({ label: t.rawLabel, amount: t.amount, category, origin: state.accounts.find((a) => a.id === t.accountId)?.origin ?? 'demo' });
  if ($<HTMLInputElement>('#remember')?.checked) {
    state.personalRules[await fingerprint(key)] = category;
    savePersonalRules(state.personalRules);
  }
  state.result = { ...analyze(state.accounts, pack(), state.inputs), sources: recountSources(), notes: before.notes };
  afterAnalysis(false);
  const moved = state.result.checks.filter((c) => before.checks.find((b) => b.id === c.id)?.status !== c.status);
  const ratio = (r: PipelineResult) => (Number.isFinite(r.metrics.debtRatio) ? `${(r.metrics.debtRatio * 100).toFixed(1)}%` : 'not computable');
  const r0 = ratio(before);
  const r1 = ratio(state.result);
  announce(
    `${changed.length === 1 ? 'One line' : `${changed.length} lines`} updated. ${pack().debtRatio.label} ${r0 === r1 ? `unchanged at ${r1}` : `went from ${r0} to ${r1}`}.${
      moved.length ? ` Changed: ${moved.map((c) => `${c.title}, now ${VERDICT[c.status].word.toLowerCase()}`).join('; ')}.` : ''
    }`,
  );
  $<HTMLElement>('#clarify input[type="radio"]')?.focus();
}

function renderFindings(): void {
  const a = state.result!;
  const byId = new Map(allTxs().map((t) => [t.id, t]));
  const flagged = flaggedMap();
  const stepFor = new Map((state.plan?.steps ?? []).map((st) => [st.checkId, st]));
  const sorted = a.checks.slice().sort((x, y) => RANK[x.status] - RANK[y.status]);
  const count = (s: CheckStatus) => a.checks.filter((c) => c.status === s).length;
  $('#review-lead').textContent =
    count('alert') + count('watch') === 0
      ? 'Nothing here should worry a lender. Keep your next statements as clean as these.'
      : `${count('alert')} to fix first, ${count('watch')} the lender will ask about, ${count('ok')} clear.`;
  $('#findings').innerHTML = sorted
    .map((c: CheckResult) => {
      const v = VERDICT[c.status];
      const txs = c.transactionIds.map((id) => byId.get(id)).filter((t): t is Transaction => !!t);
      const step = stepFor.get(c.id);
      return `<li class="finding ${c.status}">
        <div class="verdict ${c.status}">${v.svg}<span>${v.word}</span></div>
        <div>
          <h3><span>${esc(c.title)}</span></h3>
          <p>${esc(c.detail)}</p>
          ${step ? `<p class="next"><strong>Week ${step.week}:</strong> ${esc(step.action)}</p>` : ''}
          ${txs.length ? `<details><summary>See the ${txs.length} line${txs.length > 1 ? 's' : ''}</summary>${linesTable(txs.slice(0, 40), flagged, `Lines for ${c.title}`, false)}</details>` : ''}
        </div></li>`;
    })
    .join('');
  $('#lines').outerHTML = `<table class="lines" id="lines">${linesTable(
    allTxs().slice().sort((x, y) => x.date.localeCompare(y.date)),
    flagged,
    'All statement lines',
  ).replace(/^<table class="lines">|<\/table>$/g, '')}</table>`;

  const obs = a.obligations;
  $('#obligations').innerHTML = obs.length
    ? `<h3>Regular payments the lender may count as debt</h3><p class="note">Tell the app what each one is. It changes your debt ratio.</p>${obs
        .map((o) => {
          const d = state.inputs.obligationDecisions?.[o.key];
          const what =
            o.kind === 'person'
              ? 'A regular payment to a person: a private loan or support payment counts as debt.'
              : o.confidence === 'high'
                ? 'Looks like an instalment plan or a lease.'
                : 'A fixed monthly amount that could be a loan.';
          const status = d ? (d === 'debt' ? 'Counted as debt.' : 'Not counted.') : o.confidence === 'high' ? 'Counted as debt until you say otherwise.' : 'Not counted until you confirm.';
          return `<div class="obligation" role="group" aria-label="${esc(o.exampleLabel)}"><div><span class="label">${esc(o.exampleLabel)}</span><br>${money(o.monthlyAmount, 2)} a month for ${o.months} months. ${what} <strong>${status}</strong></div>
            <div class="actions" style="margin:0"><button type="button" class="btn secondary" data-ob="${esc(o.key)}" data-d="debt" aria-pressed="${d === 'debt'}">It is a debt</button><button type="button" class="btn secondary" data-ob="${esc(o.key)}" data-d="not_debt" aria-pressed="${d === 'not_debt'}">It is not</button></div></div>`;
        })
        .join('')}`
    : '';
}

function renderComparison(): void {
  const c = state.comparison;
  show('#compare', !!c);
  if (!c) return;
  const title = (id: string) => state.result?.checks.find((x) => x.id === id)?.title ?? id;
  const word = (s?: CheckStatus) => (s ? VERDICT[s].word.toLowerCase() : 'new');
  $('#compare-note').textContent = `${c.daysBetween} days later: ${c.improved} better, ${c.worsened} worse. ${pack().debtRatio.label}: ${c.debtRatioPct.before}% then ${c.debtRatioPct.after}%.`;
  $('#compare-list').innerHTML = c.checks
    .filter((x) => x.trend !== 'same')
    .map((x) => `<li><span class="trend-${x.trend}">${x.trend === 'better' ? 'Better' : x.trend === 'worse' ? 'Worse' : 'New'}:</span> ${esc(title(x.id))}, ${word(x.before)} to ${word(x.after)}</li>`)
    .join('') || '<li>No change.</li>';
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
  const h = $<HTMLInputElement>('#sim-h');
  const d = $<HTMLInputElement>('#sim-d');
  const ratio = m.incomeBase > 0 ? (m.monthlyDebtPayments - Number(d.value) + Number(h.value)) / m.incomeBase : Infinity;
  const status: CheckStatus = ratio <= p.debtRatio.comfort ? 'ok' : ratio <= p.debtRatio.max ? 'watch' : 'alert';
  $('#sim-h-v').textContent = money(Number(h.value));
  $('#sim-d-v').textContent = money(Number(d.value));
  h.setAttribute('aria-valuetext', money(Number(h.value)));
  d.setAttribute('aria-valuetext', money(Number(d.value)));
  $('#sim-label').textContent = p.debtRatio.label;
  $('#sim-ratio').textContent = Number.isFinite(ratio) ? `${(ratio * 100).toFixed(1)}%` : 'Not computable';
  $('#sim-verdict').innerHTML = `<span class="verdict ${status}">${VERDICT[status].svg}<span>${VERDICT[status].word}</span></span>`;
}

function renderPlan(): void {
  const p = state.plan;
  show('#plan-card', !!p);
  if (!p) return;
  const by = p.steps.some((s) => s.wording === 'cloud') ? 'Reworded by Gemini in the cloud; every figure was worked out on this device.' : 'Written on this device.';
  $('#plan').innerHTML = `<p><strong>${esc(p.summary)}</strong></p><p class="note">${by}</p>
    <table class="plan" role="table"><caption class="sr-only">Your 90-day plan, week by week</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">When</th><th scope="col" role="columnheader">What to do</th><th scope="col" role="columnheader">Why the lender cares</th></tr></thead><tbody role="rowgroup">${p.steps
      .map((x) => `<tr role="row"><td role="cell" class="when">Week ${x.week}</td><td role="cell" class="what">${esc(x.action)}</td><td role="cell" class="why">${esc(x.why)}</td></tr>`)
      .join('')}
    <tr role="row" class="milestone"><td role="cell" class="when">Weeks ${p.cleanFromWeek} to 12</td><td role="cell" class="what">Keep every statement clean: these are the months the lender will read.</td><td role="cell" class="why">Review again around day 30 and day 60.</td></tr>
    <tr role="row" class="milestone"><td role="cell" class="when">Week 13</td><td role="cell" class="what">Review one last time, then apply.</td><td role="cell" class="why"></td></tr></tbody></table>`;
  $<HTMLButtonElement>('#polish').disabled = !ai || !p.steps.length;
  $('#polish-note').textContent = !ai ? 'Needs the cloud connection.' : !ai.cloudEnabled ? 'Cloud wording is paused for now; the plan keeps its own wording.' : 'Sends the summary and the step names, never the figures.';
}

function renderQuestions(): void {
  $('#questions').innerHTML = state.questions
    .map(
      (q, i) =>
        `<div class="field question"><label for="answer-${i}">${esc(q.question)}</label><textarea id="answer-${i}" data-answer="${i}" aria-describedby="answer-hint"></textarea></div>`,
    )
    .join('') + (state.questions.length ? '<p class="note" id="answer-hint">Answer in your own words. Leave blank what does not apply.</p>' : '');
  show('#explain-actions', state.questions.length > 0);
  $('#questions-note').textContent = state.questionsBy ?? '';
}

function answers(): Answer[] {
  return state.questions.map((q, i) => ({ ...q, answer: $<HTMLTextAreaElement>(`#answer-${i}`)?.value ?? '' }));
}

function flaggedTxs(): Transaction[] {
  const ids = new Set(state.result!.checks.filter((c) => c.status !== 'ok').flatMap((c) => c.transactionIds));
  return allTxs().filter((t) => ids.has(t.id));
}

/** Letter text with the blanks still to fill marked like the underwriter would. */
function letterHtml(template: string, values: Record<string, string>): { html: string; missing: string[] } {
  const { text, missing } = fillTemplate(template, values);
  return { html: esc(text).replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, k: string) => `<span class="blank">${esc(k.replace(/_/g, ' '))}</span>`), missing };
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

function fieldsFor(template: string, values: Record<string, string>, attr: string, skip: string[]): string {
  return listPlaceholders(template)
    .filter((k) => !skip.includes(k))
    .map((k) => `<div class="field"><label for="${attr}-${k}">${esc(k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))}</label><input type="text" id="${attr}-${k}" data-${attr}="${esc(k)}" value="${esc(values[k] ?? '')}" /></div>`)
    .join('');
}

function renderLetter(): void {
  const l = state.letter;
  show('#letter-block', !!l);
  if (!l) return;
  prefillLetter();
  $('#letter-fields').innerHTML = fieldsFor(l.template, state.letterValues, 'ph', ['explanation']);
  updateLetter();
}

function updateLetter(): void {
  $$<HTMLInputElement>('[data-ph]').forEach((i) => (state.letterValues[i.dataset.ph!] = i.value));
  const { html, missing } = letterHtml(state.letter!.template, state.letterValues);
  $('#letter-text').innerHTML = html;
  $('#letter-note').textContent = missing.length
    ? `Still to fill: ${missing.join(', ').replace(/_/g, ' ')}.`
    : `${state.letter!.by} Names, dates and amounts were filled in on this device.`;
}

function renderDocs(): void {
  const items = state.result ? documentsFor(state.result.checks, pack().program) : [];
  $('#docs').innerHTML = items.length
    ? `<h3>Documents to gather</h3><ul class="docs">${items
        .map((d, i) => {
          const key = `${d.checkId}:${i}`;
          return `<li class="check-row"><input type="checkbox" id="doc-${i}" data-doc="${esc(key)}" ${state.docsDone[key] ? 'checked' : ''} /><label for="doc-${i}">${esc(d.text)}</label></li>`;
        })
        .join('')}</ul>`
    : '';
}

function renderGift(): void {
  const v = state.giftValues;
  v.date ||= new Date().toLocaleDateString(pack().locale, { year: 'numeric', month: 'long', day: 'numeric' });
  const largeIds = new Set(state.result?.checks.find((c) => c.id === 'large_deposits')?.transactionIds ?? []);
  const deposit = allTxs().filter((t) => largeIds.has(t.id)).sort((a, b) => b.amount - a.amount)[0];
  if (deposit) {
    v.gift_amount ||= money(deposit.amount, 2);
    v.gift_date ||= deposit.date;
  }
  $('#gift-fields').innerHTML = fieldsFor(GIFT_LETTER_TEMPLATE, v, 'gift', ['date']);
  updateGift();
}

function updateGift(): void {
  $$<HTMLInputElement>('[data-gift]').forEach((i) => (state.giftValues[i.dataset.gift!] = i.value));
  $('#gift-text').innerHTML = letterHtml(GIFT_LETTER_TEMPLATE, state.giftValues).html;
}

function renderAnswer(): void {
  const a = state.answer;
  $('#answer').innerHTML = a
    ? `<div class="answer"><p class="big">${esc(a.sentence)}</p><p class="note">Understood as: ${esc(a.understood)}. ${esc(a.by)}</p>${
        a.transactions.length ? `<div class="scroll" tabindex="0" role="region" aria-label="Matching lines">${linesTable(a.transactions.slice(0, 20), new Map(), 'Matching lines', false)}</div>` : ''
      }</div>`
    : '';
}

function renderPrivacy(): void {
  const txs = allTxs();
  $('#stays').innerHTML = txs.length
    ? [
        `${txs.length} statement lines, with their labels, dates and exact amounts`,
        `${state.accounts.length} account name${state.accounts.length > 1 ? 's' : ''}`,
        'Your answers and your explanation',
        'The names, dates and amounts in your letters',
        'Your questions about your statements',
      ]
        .map((x) => `<li>${esc(x)}</li>`)
        .join('')
    : '<li>Nothing added yet.</li>';
  const n = state.profile ? Object.keys(state.profile).length - 2 : 0;
  $('#leaves').innerHTML = state.profile
    ? [
        `${n} rounded numbers: income and payment in ranges, the ratio in whole percent, counts of events`,
        `The result of each check (clear, expect questions, fix first)`,
        'The names of the plan steps, never their figures',
        'Only when you press a cloud button, after a check in the code that nothing else is in it',
      ]
        .map((x) => `<li>${esc(x)}</li>`)
        .join('')
    : '<li>Nothing yet.</li>';
  $('#payload').textContent = state.profile ? JSON.stringify({ ...state.profile, steps: state.draft ? toCloudSteps(state.draft) : [] }, null, 2) : '{}';
}

function renderLedger(): void {
  const rows = ledger.list();
  $('#ledger').innerHTML = rows.length
    ? rows
        .map(
          (e) =>
            `<tr><td>${e.at.slice(11, 19)}</td><td>${esc(e.kind.replace(/_/g, ' '))}</td><td>${e.bytes}</td><td>${esc(
              e.kind === 'app_settings' ? 'Firebase Remote Config' : e.inferenceSource === 'in_cloud' ? 'Cloud' : e.inferenceSource === 'on_device' ? 'This device' : e.inferenceSource === 'failed' ? 'No answer' : e.kind.startsWith('demo') ? 'Sample file' : 'Waiting',
            )}</td><td><code>${esc(e.payload)}</code></td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5">Nothing has left this device.</td></tr>';
  renderStatus();
}

function setProgress(sel: string, ratio: number | null): void {
  const el = $(sel);
  el.classList.toggle('hidden', ratio === null);
  const pct = Math.round((ratio ?? 0) * 100);
  el.setAttribute('aria-valuenow', String(pct));
  (el.firstElementChild as HTMLElement).style.width = `${pct}%`;
}

function notice(sel: string, msg: string, error = false): void {
  $(sel).innerHTML = msg ? `<p class="notice ${error ? 'error' : ''}" ${error ? 'role="alert"' : ''}>${esc(msg)}</p>` : '';
}

// ---------------------------------------------------------------------------- flows

function readInputs(): void {
  const gross = Number($<HTMLInputElement>('#gross').value);
  const business = $<HTMLSelectElement>('#kind').value === 'business';
  state.inputs = {
    ...state.inputs,
    projectedHousingPayment: Number($<HTMLInputElement>('#housing').value) || 0,
    grossMonthlyIncome: pack().incomeBasis === 'gross' && gross > 0 ? gross : undefined,
    accountKind: business ? 'business' : 'personal',
    expenseRatio: pack().incomeBasis === 'deposits' && business ? Math.min(0.9, Math.max(0, Number($<HTMLInputElement>('#expense').value) / 100)) : undefined,
    cashToClose: Number($<HTMLInputElement>('#cash').value) || undefined,
    applicationDate: state.asOf,
  };
}

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
  show('#review', true);
  show('#explain', true);
  show('#ask', true);
  renderWhoRead();
  renderClarify();
  renderComparison();
  renderPlan();
  renderFindings();
  setupSimulator();
  renderQuestions();
  renderLetter();
  renderAnswer();
  renderDocs();
  renderPrivacy();
  renderSteps();
}

function reanalyse(): void {
  const prev = state.result!;
  state.result = { ...analyze(state.accounts, pack(), state.inputs), sources: prev.sources, notes: prev.notes };
  afterAnalysis(false);
  announce(`Updated. ${$('#review-lead').textContent}`);
}

const incompletePdfs: string[] = [];

async function importFile(file: File, i: number): Promise<Account> {
  const p = pack();
  const id = `user-${Date.now()}-${i}`;
  const opts = { accountId: id, currency: p.currency, country: state.country };
  let transactions: Transaction[];
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const { readPdfInBrowser } = await import('./core/import/pdf');
    const lines = await readPdfInBrowser(await file.arrayBuffer());
    const declared = Math.max(0, ...lines.map((l) => Number(lineText(l).match(/\bpage\s*\d+\s*(?:of|sur|\/)\s*(\d+)/i)?.[1] ?? 0)));
    const present = new Set(lines.map((l) => l.page)).size;
    if (declared > present) incompletePdfs.push(`${file.name} has ${present} of ${declared} pages. Lenders want every page.`);
    const byLayout = parseWithLayout(lines, opts, new Date().getFullYear());
    if (byLayout.method === 'layout' && byLayout.unreadLines <= byLayout.transactions.length * 0.1) {
      transactions = byLayout.transactions;
      state.methods[id] = `PDF, ${transactions.length} lines read by the built-in rules`;
    } else if (ai && state.device === 'available') {
      transactions = await ai.readStatementChunks(chunkLines(lines), opts, guessYear(lines, new Date().getFullYear()), (d, t) => setProgress('#an-progress', d / t));
      state.methods[id] = `PDF, ${transactions.length} lines read by Gemini Nano on this device and checked against the page`;
    } else {
      throw new Error('the layout of this PDF is unusual. Download the on-device model in step 1, then add it again.');
    }
  } else {
    const text = await file.text();
    const ofx = /<OFX>|OFXHEADER/i.test(text);
    transactions = ofx ? importOfx(text, opts).transactions : importCsv(text, opts).transactions;
    state.methods[id] = `${ofx ? 'OFX' : 'CSV'}, ${transactions.length} lines`;
  }
  if (!transactions.length) throw new Error('no transaction found in this file.');
  return { id, name: file.name, currency: p.currency, country: state.country, origin: 'user', transactions };
}

async function importFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  if (state.accounts.some((a) => a.origin === 'demo')) state.accounts = [];
  state.asOf = undefined;
  state.sample = undefined;
  incompletePdfs.length = 0;
  const errors: string[] = [];
  announce(`Reading ${files.length} file${files.length > 1 ? 's' : ''}.`);
  for (const [i, f] of files.entries()) {
    try {
      state.accounts.push(await importFile(f, i));
    } catch (err) {
      errors.push(`${f.name}: ${(err as Error).message}`);
    } finally {
      setProgress('#an-progress', null);
    }
  }
  notice('#import-notes', [...errors, ...incompletePdfs].join(' '), errors.length > 0);
  renderAccounts();
  renderPrivacy();
  announce(`${state.accounts.length} statement file${state.accounts.length > 1 ? 's' : ''} added.${errors.length ? ` ${errors.length} could not be read.` : ''}`);
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
  state.program = PROGRAMS_BY_COUNTRY[state.country][0].program;
  renderRules();
});
$('#program').addEventListener('change', (e) => {
  state.program = (e.target as HTMLSelectElement).value as LoanProgram;
  renderRules();
});

$('#prepare').addEventListener('click', async () => {
  if (!ai) return;
  try {
    setProgress('#dl-progress', 0);
    announce('Downloading the on-device model.');
    await ai.prepareOnDevice((p) => setProgress('#dl-progress', p));
  } catch (err) {
    notice('#import-notes', `The on-device model could not start: ${(err as Error).message}`, true);
  } finally {
    state.device = await HybridAI.onDeviceStatus();
    setProgress('#dl-progress', null);
    renderStatus();
    announce(state.device === 'available' ? 'On-device model ready.' : 'The on-device model is not ready.');
  }
});

$$('[data-demo]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const i = Number(btn.dataset.demo);
    const p = DEMO_PERSONAS[i]();
    state.sample = i;
    state.country = p.country;
    $<HTMLSelectElement>('#country').value = p.country;
    state.program = p.program ?? PROGRAMS_BY_COUNTRY[p.country][0].program;
    state.accounts = p.accounts;
    state.methods = {};
    state.asOf = p.asOf;
    state.inputs = { projectedHousingPayment: p.projectedHousingPayment };
    $<HTMLInputElement>('#gross').value = p.grossMonthlyIncome ? String(p.grossMonthlyIncome) : '';
    $<HTMLInputElement>('#housing').value = String(p.projectedHousingPayment);
    $<HTMLInputElement>('#cash').value = p.cashToClose ? String(p.cashToClose) : '';
    if (p.accountKind) $<HTMLSelectElement>('#kind').value = p.accountKind;
    notice('#import-notes', '');
    renderRules();
    renderAccounts();
    renderPrivacy();
    announce(`Sample loaded: ${p.title.replace(' (synthetic)', '')}. Application details filled in. Next: review the statements.`);
    $('#analyze').focus();
  }),
);

$$('[data-sample]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const acc = DEMO_PERSONAS[0]().accounts[0];
    const kind = btn.dataset.sample!;
    if (kind === 'csv') return download('maya-checking-sample.csv', accountToCsv(acc), 'text/csv');
    const { accountToPdf } = await import('./demo/statement-pdf');
    const bytes = await accountToPdf(acc, 'Maya (sample)', kind === 'pdf-compact' ? 'compact' : 'classic');
    download(kind === 'pdf' ? 'maya-checking-sample.pdf' : 'maya-checking-sample-unusual.pdf', bytes as BlobPart, 'application/pdf');
  }),
);

$('#files').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  importFiles([...(input.files ?? [])]).finally(() => (input.value = ''));
});
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
  state.sample = undefined;
  renderAccounts();
  renderPrivacy();
  announce('All statements removed.');
});

$('#analyze').addEventListener('click', async () => {
  readInputs();
  const btn = $<HTMLButtonElement>('#analyze');
  btn.disabled = true;
  btn.textContent = 'Reviewing...';
  announce('Reviewing your statements.');
  try {
    setProgress('#an-progress', 0.05);
    state.result = await runPipeline(
      state.accounts,
      pack(),
      state.inputs,
      ai,
      (p) => setProgress('#an-progress', p.total ? (p.done ?? 0) / p.total : p.stage === 'analysis' ? 1 : 0.2),
      { rules: state.personalRules, examples: state.examples },
    );
    state.answered = {};
    afterAnalysis(true);
    $('#review').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('#h-review').focus({ preventScroll: true });
    announce(`Review done. ${$('#review-lead').textContent}`);
  } catch (err) {
    notice('#import-notes', `The review stopped: ${(err as Error).message}`, true);
  } finally {
    setProgress('#an-progress', null);
    btn.disabled = state.accounts.length === 0;
    btn.textContent = 'Review my statements';
  }
});

$('#clarify').addEventListener('change', async (e) => {
  const el = e.target as HTMLInputElement;
  if (el.type === 'radio' && el.dataset.key) await answerQuestion(el.dataset.key, el.value as Category);
  if (el.id === 'remember' && !el.checked) {
    state.personalRules = {};
    clearPersonalRules();
  }
  if (el.id === 'remember' && el.checked) {
    for (const [key, c] of Object.entries(state.answered)) if (c !== 'skip') state.personalRules[await fingerprint(key)] = c;
    savePersonalRules(state.personalRules);
  }
});
$('#clarify').addEventListener('click', (e) => {
  const b = e.target as HTMLElement;
  if (b.dataset.skip) {
    state.answered[b.dataset.skip] = 'skip';
    renderClarify();
    $<HTMLElement>('#clarify input[type="radio"]')?.focus();
  }
  if (b.id === 'forget-answers') {
    state.personalRules = {};
    clearPersonalRules();
    renderClarify();
    announce('Remembered answers forgotten.');
  }
});

$('#obligations').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ob]');
  if (!b) return;
  state.inputs.obligationDecisions = { ...state.inputs.obligationDecisions, [b.dataset.ob!]: b.dataset.d as 'debt' | 'not_debt' };
  reanalyse();
  $<HTMLButtonElement>(`[data-ob="${CSS.escape(b.dataset.ob!)}"][data-d="${b.dataset.d}"]`)?.focus();
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
    renderFindings();
    announce('Plan reworded.');
  } catch (err) {
    $('#polish-note').textContent = `The plan keeps its original wording: ${cloudTrouble(err)}.`;
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
    state.questionsBy = `${cloudTrouble(err)}, so these are the usual questions.`;
  }
  if (!state.questions.length) {
    state.questions = defaultQuestions(state.result.checks);
    state.questionsBy ??= 'The usual questions for your results.';
  }
  b.disabled = false;
  renderQuestions();
  $<HTMLTextAreaElement>('#answer-0')?.focus();
  announce(`${state.questions.length} questions.`);
});

$('#write-explanation').addEventListener('click', async () => {
  const ans = answers();
  if (!ans.some((a) => a.answer.trim())) {
    $('#explanation-note').textContent = 'Answer at least one question first.';
    $<HTMLTextAreaElement>('#answer-0')?.focus();
    return;
  }
  const b = $<HTMLButtonElement>('#write-explanation');
  b.disabled = true;
  let by = 'Written from your answers.';
  let text = templateExplanation(ans);
  try {
    if (ai && (origin() === 'demo' || state.device === 'available')) {
      const r = await ai.writeExplanation(ans, flaggedTxs(), pack().currency, origin());
      text = r.text;
      by =
        r.by === 'on_device'
          ? 'Written by Gemini Nano on this device.'
          : r.by === 'in_cloud'
            ? 'Written in the cloud (sample files only).'
            : 'The model added facts you did not give, so your own words were kept.';
    }
  } catch (err) {
    by = `The on-device model is not available (${(err as Error).message}); written from your answers.`;
  }
  state.explanation = { text, by };
  $('#explanation').innerHTML = `<div class="field question"><label for="explanation-text">Your explanation (you can edit it)</label><textarea id="explanation-text" style="min-height:9rem" aria-describedby="explanation-by">${esc(text)}</textarea><span class="hint" id="explanation-by">${esc(by)}</span></div>`;
  $('#explanation-text').addEventListener('input', (e) => {
    state.explanation!.text = (e.target as HTMLTextAreaElement).value;
    state.letterValues.explanation = state.explanation!.text;
    if (state.letter) updateLetter();
  });
  if (!state.letter) {
    let template = LOCAL_LETTER_TEMPLATE;
    let tby = 'Standard letter.';
    try {
      if (ai && navigator.onLine && state.profile) {
        const t = await ai.generateLetterTemplate(state.profile, labels());
        if (t.template.includes('{{explanation}}')) {
          template = t.template;
          tby = 'Letter drafted by Gemini in the cloud, with blanks only.';
        }
      }
    } catch {
      /* keep the standard letter */
    }
    state.letter = { template, by: tby };
  }
  b.disabled = false;
  renderLetter();
  $('#explanation-text').focus();
  announce('Explanation written. The letter below is ready to complete.');
});

$('#letter-fields').addEventListener('input', updateLetter);
$('#copy-letter').addEventListener('click', async () => {
  await navigator.clipboard?.writeText($('#letter-text').textContent ?? '');
  announce('Letter copied.');
});
$('#download-letter').addEventListener('click', () => download('letter-of-explanation.txt', $('#letter-text').textContent ?? '', 'text/plain'));
$('#gift-fields').addEventListener('input', updateGift);
$('#gift-btn').addEventListener('click', () => {
  const open = $('#gift-block').classList.contains('hidden');
  show('#gift-block', open);
  $('#gift-btn').setAttribute('aria-expanded', String(open));
  if (open) {
    renderGift();
    $<HTMLInputElement>('[data-gift]')?.focus();
  }
});
$('#download-gift').addEventListener('click', () => download('gift-letter.txt', $('#gift-text').textContent ?? '', 'text/plain'));
$('#docs').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.doc) state.docsDone[el.dataset.doc] = el.checked;
});

/** A plain sentence for a failed cloud call, instead of the SDK's error text. */
function cloudTrouble(err: unknown): string {
  const m = String((err as Error)?.message ?? err);
  if (/paused/.test(m)) return 'The cloud is paused in the app settings';
  if (!navigator.onLine) return 'You are offline';
  if (/\b(503|429)\b|high demand|overloaded|quota|exhausted/i.test(m)) return 'The cloud model is busy right now, try again in a minute';
  return 'The cloud did not answer';
}

async function ask(question: string): Promise<void> {
  if (!state.result || !question.trim()) return;
  const months = [...new Set(allTxs().map((t) => t.date.slice(0, 7)))].sort();
  const labels = [...new Set(allTxs().map((t) => t.rawLabel))];
  let query = null;
  let by = '';
  try {
    if (ai && (origin() === 'demo' || state.device === 'available')) {
      query = await ai.understandQuestion(question, months, origin());
      if (query) query = reconcileQuery(query, guessQuery(question, months, labels));
      by = 'Understood by Gemini Nano, checked against the words of your question, and counted on this device.';
    }
  } catch {
    query = null;
  }
  if (!query) {
    query = guessQuery(question, months, labels);
    by = 'Understood by the built-in rules and counted on this device.';
  }
  state.answer = { ...runQuery(query, allTxs(), pack().currency, pack().locale), by };
  renderAnswer();
}
$('#ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  ask($<HTMLInputElement>('#question').value);
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
  clearPersonalRules();
  location.reload();
});

window.addEventListener('online', renderStatus);
window.addEventListener('offline', renderStatus);

// The step in view is marked as current in the step list.
const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible && STEPS.some(([id]) => id === visible.target.id) && currentStep !== visible.target.id) {
      currentStep = visible.target.id;
      renderSteps();
    }
  },
  { rootMargin: '-20% 0px -60% 0px' },
);
STEPS.forEach(([id]) => observer.observe($(`#${id}`)));

// ---------------------------------------------------------------------------- start

$<HTMLInputElement>('#keep').checked = loadSnapshot() !== null;
ledger.onChange(renderLedger);
renderRules();
renderAccounts();
renderLedger();
HybridAI.onDeviceStatus().then((s) => {
  state.device = s;
  renderStatus();
});
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
