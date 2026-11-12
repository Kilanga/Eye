import './styles.css';
import { HybridAI, type LetterTemplate, type OnDeviceStatus } from './ai/models';
import {
  clearSnapshot,
  compareSnapshots,
  loadSnapshot,
  saveSnapshot,
  takeSnapshot,
  type Comparison,
  type Snapshot,
} from './core/followup';
import { buildDraftPlan, finalisePlan, type DraftPlan, type FinalPlan } from './core/plan';
import { importCsv } from './core/import/csv';
import { importOfx } from './core/import/ofx';
import { fillTemplate, listPlaceholders } from './core/letter';
import { OutboundLedger } from './core/ledger';
import { buildCloudProfile, type CloudProfile } from './core/profile';
import { getRulePack } from './core/rules';
import type { Account, Analysis, CountryCode, UserInputs } from './core/types';
import { DEMO_PERSONAS } from './demo/generate';
import { initFirebase } from './firebase';
import { runPipeline } from './pipeline';

const ledger = new OutboundLedger();
const app = initFirebase();
const ai = app ? new HybridAI(app, ledger) : null;

const state: {
  country: CountryCode;
  accounts: Account[];
  inputs: UserInputs;
  analysis?: Analysis;
  profile?: CloudProfile;
  draft?: DraftPlan;
  plan?: FinalPlan;
  letter?: LetterTemplate;
  device: OnDeviceStatus;
  /** Date of the statements: the demo personas carry their own, imported files use today. */
  asOf?: string;
  /** Previous scan, kept in memory for the session (and in localStorage only if the user opts in). */
  previous: Snapshot | null;
  comparison?: Comparison | null;
} = {
  country: 'US',
  accounts: [],
  inputs: { projectedHousingPayment: 0 },
  device: 'no-api',
  previous: loadSnapshot(),
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

document.querySelector('#app')!.innerHTML = `
<header>
  <h1>Underwriter's Eye</h1>
  <span id="device-badge" class="badge">Checking device...</span>
</header>
<p class="tagline">See your bank statements the way a lender will, before you apply. Your statements never leave this device.</p>
${ai ? '' : '<section><strong>Offline demo mode.</strong> <span class="note">No Firebase config found: lines are classified by keyword rules only and the cloud plan is disabled. See README.</span></section>'}

<section>
  <h2>1. Where are you applying?</h2>
  <div class="row">
    <label>Country rules
      <select id="country"><option value="US">United States</option><option value="FR">France</option></select>
    </label>
    <button id="prepare" class="secondary">Prepare private mode (download on-device model)</button>
  </div>
  <div class="progress hidden" id="dl-progress"><div></div></div>
  <p class="note" id="rules-note"></p>
</section>

<section>
  <h2>2. Your statements</h2>
  <div class="row">
    <label>Import CSV or OFX files (one per account)
      <input type="file" id="files" multiple accept=".csv,.ofx,.qfx,.txt" />
    </label>
    <span class="note">or try a synthetic profile:</span>
    ${DEMO_PERSONAS.map((p, i) => `<button class="secondary" data-demo="${i}">${esc(p().title)}</button>`).join('')}
  </div>
  <div class="row" style="margin-top:12px">
    <label id="gross-label">Gross monthly income<input type="number" id="gross" min="0" step="50" /></label>
    <label>Target monthly housing payment<input type="number" id="housing" min="0" step="50" /></label>
  </div>
  <p class="note" id="accounts-note">No statements yet.</p>
  <button id="analyze" disabled>Analyse on this device</button>
  <div class="progress hidden" id="an-progress"><div></div></div>
</section>

<section id="compare" class="hidden">
  <h2>Since your last scan</h2>
  <p class="note" id="compare-note"></p>
  <ul class="compare" id="compare-list"></ul>
</section>

<section id="results" class="hidden">
  <h2>3. What your lender will see</h2>
  <ul class="checks" id="checks"></ul>
  <div class="row" style="margin-top:12px">
    <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="keep" /> Keep this summary (numbers and lights only, no statements) in this browser for a follow-up scan</label>
    <button class="secondary" id="forget">Forget saved summary</button>
  </div>
</section>

<section id="plan-section" class="hidden">
  <h2>4. Your 90-day plan</h2>
  <p class="note">Steps and figures are computed on this device. Rescan around day 30 and day 60 to watch the lights change.</p>
  <div id="plan"></div>
</section>

<section id="cloud" class="hidden">
  <h2>5. Better wording and an explanation letter</h2>
  <p class="note">Optional. Only this summary leaves your device: no statement, no exact amount. The figures in the plan and the letter are filled in here afterwards.</p>
  <pre id="profile-preview"></pre>
  <button id="send" ${ai ? '' : 'disabled'}>Send these numbers</button>
  ${ai ? '' : '<span class="note">Needs a Firebase config.</span>'}
  <div id="letter"></div>
</section>

<section>
  <h2>Outbound ledger</h2>
  <p class="note">Every request that left this device, exactly as sent.</p>
  <table><thead><tr><th>Time</th><th>What</th><th>Bytes</th><th>Answered by</th><th>Payload</th></tr></thead><tbody id="ledger"><tr><td colspan="5" class="note">Nothing has left this device.</td></tr></tbody></table>
</section>
<p class="note">Educational tool, not financial advice. Rule thresholds are documented with sources in the README.</p>
`;

function renderRulesNote(): void {
  const pack = getRulePack(state.country);
  $('#rules-note').textContent = `${pack.displayName}: ${pack.statementMonths} months of statements, ${pack.debtRatio.label} limit around ${Math.round(pack.debtRatio.max * 100)}%.`;
  $('#gross-label').classList.toggle('hidden', pack.incomeBasis !== 'gross');
}

function renderAccounts(): void {
  const n = state.accounts.reduce((s, a) => s + a.transactions.length, 0);
  $('#accounts-note').textContent = state.accounts.length
    ? `${state.accounts.length} account(s), ${n} lines: ${state.accounts.map((a) => a.name).join(', ')}.`
    : 'No statements yet.';
  ($('#analyze') as HTMLButtonElement).disabled = state.accounts.length === 0;
}

function renderDevice(): void {
  const b = $('#device-badge');
  const labels: Record<OnDeviceStatus, string> = {
    available: 'On-device model ready',
    downloadable: 'On-device model not downloaded',
    downloading: 'On-device model downloading',
    unavailable: 'On-device model unavailable',
    'no-api': 'No on-device model in this browser',
  };
  b.textContent = labels[state.device];
  b.className = `badge ${state.device === 'available' ? 'on' : ''}`;
}

function renderChecks(): void {
  const a = state.analysis!;
  const stepFor = new Map((state.plan?.steps ?? []).map((st) => [st.checkId, st]));
  const txById = new Map(state.accounts.flatMap((acc) => acc.transactions).map((t) => [t.id, t]));
  $('#checks').innerHTML = a.checks
    .map(
      (c) => `<li class="check" data-check="${c.id}"><span class="dot ${c.status}"></span><div>
        <strong>${esc(c.title)}</strong><p>${esc(c.detail)}</p>
        <div class="txlist hidden">${c.transactionIds
          .map((id) => txById.get(id))
          .filter(Boolean)
          .map((t) => `${t!.date} &middot; ${esc(t!.rawLabel)} &middot; ${t!.amount.toFixed(2)} ${t!.currency}`)
          .join('<br>')}</div>${
          stepFor.has(c.id)
            ? `<div class="plan-link">Plan, week ${stepFor.get(c.id)!.week}: ${esc(stepFor.get(c.id)!.action)}</div>`
            : ''
        }</div></li>`,
    )
    .join('');
  $('#results').classList.remove('hidden');
}

function renderCloudPreview(): void {
  const steps = state.draft ? state.draft.steps.map(({ week, checkId, lever }) => ({ week, checkId, lever })) : [];
  $('#profile-preview').textContent = JSON.stringify({ ...state.profile, steps }, null, 2);
  $('#cloud').classList.remove('hidden');
}

function renderComparison(): void {
  const c = state.comparison;
  $('#compare').classList.toggle('hidden', !c);
  if (!c) return;
  const pack = getRulePack(state.country);
  const title = (id: string) => state.analysis?.checks.find((x) => x.id === id)?.title ?? id;
  $('#compare-note').textContent = `${c.daysBetween} day(s) later: ${c.improved} light(s) better, ${c.worsened} worse. ${pack.debtRatio.label}: ${c.debtRatioPct.before}% to ${c.debtRatioPct.after}%.`;
  $('#compare-list').innerHTML = c.checks
    .map(
      (x) =>
        `<li>${x.before ? `<span class="dot ${x.before}"></span>&rarr;` : ''}<span class="dot ${x.after}"></span>${esc(title(x.id))} <span class="trend ${x.trend}">${x.trend}</span></li>`,
    )
    .join('');
}

function renderLedger(): void {
  const rows = ledger.list();
  $('#ledger').innerHTML = rows.length
    ? rows
        .map(
          (e) =>
            `<tr><td>${e.at.slice(11, 19)}</td><td>${e.kind}</td><td>${e.bytes}</td><td>${e.inferenceSource ?? '...'}</td><td><code>${esc(e.payload)}</code></td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="note">Nothing has left this device.</td></tr>';
}

function renderPlan(): void {
  const p = state.plan;
  $('#plan-section').classList.toggle('hidden', !p);
  if (!p) return;
  const wording = p.steps.some((st) => st.wording === 'cloud') ? 'Wording by Gemini, figures computed on this device.' : 'Built entirely on this device.';
  $('#plan').innerHTML = `<p>${esc(p.summary)}</p><p class="note">${wording}</p>
    <table><tr><th>Week</th><th>Action</th><th>Why it matters to the lender</th></tr>${p.steps
      .map((x) => `<tr><td>${x.week}</td><td><span class="dot ${x.status}" style="display:inline-block;width:10px;height:10px"></span> ${esc(x.action)}</td><td>${esc(x.why)}</td></tr>`)
      .join('')}
    <tr class="milestone"><td>${p.cleanFromWeek}-12</td><td>Keep every statement clean: these are the months the lender will read.</td><td>Rescan around day 30 and day 60.</td></tr>
    <tr class="milestone"><td>13</td><td>Rescan, check every light, then apply.</td><td></td></tr></table>`;
}

function renderLetter(): void {
  if (state.letter) {
    const keys = listPlaceholders(state.letter.template);
    $('#letter').innerHTML = `<h3>Explanation letter</h3><p class="note">The cloud wrote a template with blanks. Fill them here: they stay on this device.</p>
      <div class="row">${keys.map((k) => `<label>${esc(k)}<input data-ph="${esc(k)}" /></label>`).join('')}</div>
      <textarea id="letter-text" readonly></textarea>`;
    const update = () => {
      const values: Record<string, string> = {};
      document.querySelectorAll<HTMLInputElement>('[data-ph]').forEach((i) => (values[i.dataset.ph!] = i.value));
      ($('#letter-text') as HTMLTextAreaElement).value = fillTemplate(state.letter!.template, values).text;
    };
    document.querySelectorAll('[data-ph]').forEach((i) => i.addEventListener('input', update));
    update();
  }
}

/** After every analysis: local plan, follow-up comparison, cloud preview. */
function afterAnalysis(): void {
  const a = state.analysis!;
  const pack = getRulePack(state.country);
  state.profile = buildCloudProfile(a, state.inputs.projectedHousingPayment);
  state.draft = buildDraftPlan(a, pack, state.inputs);
  state.plan = finalisePlan(state.draft);
  state.letter = undefined;
  $('#letter').innerHTML = '';
  const snap = takeSnapshot(state.profile, state.asOf ? new Date(`${state.asOf}T12:00:00Z`) : new Date());
  state.comparison = state.previous ? compareSnapshots(state.previous, snap) : null;
  state.previous = snap;
  if (($('#keep') as HTMLInputElement).checked) saveSnapshot(snap);
  renderComparison();
  renderPlan();
  renderChecks();
  renderCloudPreview();
}

function setProgress(sel: string, ratio: number | null): void {
  const el = $(sel);
  el.classList.toggle('hidden', ratio === null);
  (el.firstElementChild as HTMLElement).style.width = `${Math.round((ratio ?? 0) * 100)}%`;
}

// --- events ---------------------------------------------------------------

$('#country').addEventListener('change', (e) => {
  state.country = (e.target as HTMLSelectElement).value as CountryCode;
  renderRulesNote();
});

$('#prepare').addEventListener('click', async () => {
  if (!ai) return alertNote('Add a Firebase config to use the on-device model.');
  try {
    setProgress('#dl-progress', 0);
    await ai.prepareOnDevice((p) => setProgress('#dl-progress', p));
    state.device = await HybridAI.onDeviceStatus();
  } catch (err) {
    alertNote(`On-device model unavailable: ${(err as Error).message}`);
  } finally {
    setProgress('#dl-progress', null);
    renderDevice();
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-demo]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const p = DEMO_PERSONAS[Number(btn.dataset.demo)]();
    state.country = p.country;
    ($('#country') as HTMLSelectElement).value = p.country;
    state.accounts = p.accounts;
    state.asOf = p.asOf;
    ($('#gross') as HTMLInputElement).value = p.grossMonthlyIncome ? String(p.grossMonthlyIncome) : '';
    ($('#housing') as HTMLInputElement).value = String(p.projectedHousingPayment);
    renderRulesNote();
    renderAccounts();
  }),
);

$('#files').addEventListener('change', async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  const pack = getRulePack(state.country);
  const accounts: Account[] = [];
  for (const [i, file] of files.entries()) {
    const text = await file.text();
    const id = `user-${i}`;
    try {
      const isOfx = /<OFX>|OFXHEADER/i.test(text);
      const txs = isOfx
        ? importOfx(text, { accountId: id, country: state.country, currency: pack.currency }).transactions
        : importCsv(text, { accountId: id, currency: pack.currency, country: state.country }).transactions;
      accounts.push({ id, name: file.name, currency: txs[0]?.currency ?? pack.currency, country: state.country, origin: 'user', transactions: txs });
    } catch (err) {
      alertNote(`${file.name}: ${(err as Error).message}`);
    }
  }
  state.accounts = accounts;
  state.asOf = undefined;
  renderAccounts();
});

$('#analyze').addEventListener('click', async () => {
  state.inputs = {
    projectedHousingPayment: Number(($('#housing') as HTMLInputElement).value) || 0,
    ...(Number(($('#gross') as HTMLInputElement).value) > 0
      ? { grossMonthlyIncome: Number(($('#gross') as HTMLInputElement).value) }
      : {}),
  };
  try {
    setProgress('#an-progress', 0);
    state.analysis = await runPipeline(state.accounts, getRulePack(state.country), state.inputs, ai, (p) =>
      setProgress('#an-progress', p.total ? (p.done ?? 0) / p.total : 0.1),
    );
    afterAnalysis();
  } catch (err) {
    alertNote(`Analysis stopped: ${(err as Error).message}`);
  } finally {
    setProgress('#an-progress', null);
  }
});

$('#checks').addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest('.check');
  li?.querySelector('.txlist')?.classList.toggle('hidden');
});

$('#send').addEventListener('click', async () => {
  if (!ai || !state.profile) return;
  const labels = state.accounts.flatMap((a) => a.transactions.map((t) => t.rawLabel));
  try {
    ($('#send') as HTMLButtonElement).disabled = true;
    state.plan = await ai.generatePlan(state.profile, state.draft!, labels);
    state.letter = await ai.generateLetterTemplate(state.profile, labels);
    renderPlan();
    renderChecks();
    renderLetter();
  } catch (err) {
    alertNote(`Cloud step failed: ${(err as Error).message}`);
  } finally {
    ($('#send') as HTMLButtonElement).disabled = false;
  }
});

$('#keep').addEventListener('change', (e) => {
  if ((e.target as HTMLInputElement).checked && state.previous) saveSnapshot(state.previous);
  if (!(e.target as HTMLInputElement).checked) clearSnapshot();
});

$('#forget').addEventListener('click', () => {
  clearSnapshot();
  ($('#keep') as HTMLInputElement).checked = false;
});

function alertNote(msg: string): void {
  $('#accounts-note').textContent = msg;
}

($('#keep') as HTMLInputElement).checked = loadSnapshot() !== null;
ledger.onChange(renderLedger);
renderRulesNote();
renderAccounts();
HybridAI.onDeviceStatus().then((s) => {
  state.device = s;
  renderDevice();
});
