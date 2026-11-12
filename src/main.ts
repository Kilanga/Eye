import './styles.css';
import { HybridAI, type LetterTemplate, type OnDeviceStatus, type Plan } from './ai/models';
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
  plan?: Plan;
  letter?: LetterTemplate;
  device: OnDeviceStatus;
} = { country: 'US', accounts: [], inputs: { projectedHousingPayment: 0 }, device: 'no-api' };

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

<section id="results" class="hidden">
  <h2>3. What your lender will see</h2>
  <ul class="checks" id="checks"></ul>
</section>

<section id="cloud" class="hidden">
  <h2>4. Your 90-day plan and explanation letter</h2>
  <p class="note">Only this summary leaves your device. Nothing else.</p>
  <pre id="profile-preview"></pre>
  <button id="send" ${ai ? '' : 'disabled'}>Send these numbers and get my plan</button>
  <div id="plan"></div>
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
  const txById = new Map(state.accounts.flatMap((acc) => acc.transactions).map((t) => [t.id, t]));
  $('#checks').innerHTML = a.checks
    .map(
      (c) => `<li class="check" data-check="${c.id}"><span class="dot ${c.status}"></span><div>
        <strong>${esc(c.title)}</strong><p>${esc(c.detail)}</p>
        <div class="txlist hidden">${c.transactionIds
          .map((id) => txById.get(id))
          .filter(Boolean)
          .map((t) => `${t!.date} &middot; ${esc(t!.rawLabel)} &middot; ${t!.amount.toFixed(2)} ${t!.currency}`)
          .join('<br>')}</div></div></li>`,
    )
    .join('');
  $('#results').classList.remove('hidden');
  state.profile = buildCloudProfile(a, state.inputs.projectedHousingPayment);
  $('#profile-preview').textContent = JSON.stringify(state.profile, null, 2);
  $('#cloud').classList.remove('hidden');
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

function renderPlanAndLetter(): void {
  if (state.plan) {
    $('#plan').innerHTML = `<h3>90-day plan</h3><p>${esc(state.plan.summary)}</p><table><tr><th>Week</th><th>Action</th><th>Why</th></tr>${state.plan.actions
      .map((x) => `<tr><td>${x.week}</td><td>${esc(x.action)}</td><td>${esc(x.why)}</td></tr>`)
      .join('')}</table>`;
  }
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
    renderChecks();
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
    state.plan = await ai.generatePlan(state.profile, labels);
    state.letter = await ai.generateLetterTemplate(state.profile, labels);
    renderPlanAndLetter();
  } catch (err) {
    alertNote(`Cloud step failed: ${(err as Error).message}`);
  } finally {
    ($('#send') as HTMLButtonElement).disabled = false;
  }
});

function alertNote(msg: string): void {
  $('#accounts-note').textContent = msg;
}

ledger.onChange(renderLedger);
renderRulesNote();
renderAccounts();
HybridAI.onDeviceStatus().then((s) => {
  state.device = s;
  renderDevice();
});
