import '../styles.css';
import { HybridAI } from '../ai/models';
import { OutboundLedger } from '../core/ledger';
import { initFirebase } from '../firebase';
import { evalSet } from './dataset';
import { holdoutSet } from './holdout';
import { evaluate, type EvalReport } from './run';

/**
 * Measurement page (/eval.html): rules only vs rules + Gemini Nano, on the main labelled set or on
 * the held-out set. The model runs as for real user data (ONLY_ON_DEVICE), so the bytes column proves
 * that nothing left the device. The numbers go into the README.
 */
const ledger = new OutboundLedger();
const app = initFirebase();
const ai = app ? new HybridAI(app, ledger) : null;
const sets = { main: evalSet(), holdout: holdoutSet() };
type SetName = keyof typeof sets;
const setName = (): SetName => ((document.querySelector('#set') as HTMLSelectElement | null)?.value as SetName) ?? 'main';
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

document.querySelector('#app')!.innerHTML = `
<section class="card"><h2>Measurements</h2>
<p class="lead">Labelled statement lines (English and French, invented names). Rules first, then Gemini Nano on the lines the rules cannot read. The held-out set was written after the first run on real hardware and is never used to tune the prompt.</p>
<div class="row"><label for="set">Lines</label><select id="set"><option value="main">Main set (${sets.main.length})</option><option value="holdout">Held-out set (${sets.holdout.length})</option></select><button id="rules">Rules only</button><button id="nano" ${ai ? '' : 'disabled'}>Rules + Gemini Nano</button><span class="note" id="status"></span></div>
<table style="margin-top:14px"><thead><tr><th>Run</th><th>Accuracy</th><th>On lines the rules miss</th><th>Rule coverage</th><th>Rule precision</th><th>Model mistakes turned into questions</th><th>Model time</th><th>Bytes sent</th></tr></thead><tbody id="rows"></tbody></table>
<h3>Mistakes of the last run</h3><div class="scroll"><table id="mistakes"></table></div></section>`;

function add(name: string, r: EvalReport): void {
  name = `${name}, ${setName() === 'main' ? 'main set' : 'held-out set'}`;
  const bytes = ledger.list().reduce((s, e) => s + e.bytes, 0);
  document.querySelector('#rows')!.insertAdjacentHTML(
    'beforeend',
    `<tr><td>${name}</td><td>${pct(r.accuracy)}</td><td>${pct(r.accuracyOnRest)}</td><td>${pct(r.ruleCoverage)}</td><td>${pct(r.rulePrecision)}</td><td>${r.modelWrong === undefined ? '-' : `${r.modelWrongAsked} of ${r.modelWrong}`}</td><td>${
      r.modelMs ? `${(r.modelMs / 1000).toFixed(1)} s for ${r.modelLines} lines` : '-'
    }</td><td>${bytes}</td></tr>`,
  );
  document.querySelector('#mistakes')!.innerHTML = r.mistakes
    .map((m) => `<tr><td>${m.label.replace(/</g, '&lt;')}</td><td>expected ${m.truth}</td><td>got ${m.got}</td><td>${m.asked ? 'asked' : ''}</td></tr>`)
    .join('');
}

document.querySelector('#rules')!.addEventListener('click', async () => add('Rules only', await evaluate(sets[setName()])));
document.querySelector('#nano')!.addEventListener('click', async () => {
  const status = document.querySelector('#status')!;
  if ((await HybridAI.onDeviceStatus()) !== 'available') {
    status.textContent = 'Gemini Nano is not ready: prepare private mode in the app first.';
    return;
  }
  status.textContent = 'Running on this device...';
  const r = await evaluate(sets[setName()], (txs) => ai!.classifyTransactions(txs, 'user', (d, t) => (status.textContent = `${d}/${t} lines`)));
  status.textContent = '';
  add('Rules + Gemini Nano', r);
});
