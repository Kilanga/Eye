import '../styles.css';
import { LOGO } from '../logo';
import { CATEGORY_NAMES, type Category } from '../core/types';
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
<header class="masthead">
  <div class="masthead-inner"><a class="wordmark" href="/">${LOGO}<span>Underwriter's Eye</span></a></div>
</header>
<main class="eval-page" id="main">
  <section class="sheet" aria-labelledby="h-eval">
    <h2 id="h-eval">Measurements</h2>
    <p class="lead">Labelled statement lines in English and French, with invented names. The rules read them first, then Gemini Nano reads the lines the rules miss, on this device, in the same mode as real statements. The held-out set was written after the first run on real hardware and was never used to tune the prompt.</p>
    <div class="eval-controls">
      <div class="field"><label for="set">Lines</label><select id="set"><option value="main">Main set (${sets.main.length} lines)</option><option value="holdout">Held-out set (${sets.holdout.length} lines)</option></select></div>
      <button type="button" class="btn secondary" id="rules">Rules only</button>
      <button type="button" class="btn" id="nano" ${ai ? '' : 'disabled'}>Rules + Gemini Nano</button>
      <span class="note" id="status" role="status"></span>
    </div>
    <div class="scroll" tabindex="0" role="region" aria-label="Results"><table class="lines eval-results"><thead><tr><th scope="col">Run</th><th scope="col" class="amt">Accuracy</th><th scope="col" class="amt">On lines the rules miss</th><th scope="col" class="amt">Rule coverage</th><th scope="col" class="amt">Rule precision</th><th scope="col">Model mistakes turned into questions</th><th scope="col">Model time</th><th scope="col" class="amt">Bytes sent</th></tr></thead><tbody id="rows"><tr class="empty"><td colspan="8">Run a measurement to see the results here.</td></tr></tbody></table></div>
    <h3>Mistakes of the last run</h3>
    <div class="scroll" tabindex="0" role="region" aria-label="Mistakes of the last run"><table class="lines" id="mistakes"></table></div>
    <p class="note"><a href="/">Back to the app</a></p>
  </section>
</main>`;

function add(name: string, r: EvalReport): void {
  name = `${name}, ${setName() === 'main' ? 'main set' : 'held-out set'}`;
  const bytes = ledger.list().reduce((s, e) => s + e.bytes, 0);
  document.querySelector('#rows .empty')?.remove();
  document.querySelector('#rows')!.insertAdjacentHTML(
    'beforeend',
    `<tr><td>${name}</td><td class="amt">${pct(r.accuracy)}</td><td class="amt">${pct(r.accuracyOnRest)}</td><td class="amt">${pct(r.ruleCoverage)}</td><td class="amt">${pct(r.rulePrecision)}</td><td>${r.modelWrong === undefined ? '-' : `${r.modelWrongAsked} of ${r.modelWrong}`}</td><td>${
      r.modelMs ? `${(r.modelMs / 1000).toFixed(1)} s for ${r.modelLines} lines` : '-'
    }</td><td class="amt">${bytes}</td></tr>`,
  );
  document.querySelector('#mistakes')!.innerHTML = r.mistakes
    .map((m) => `<tr><td>${m.label.replace(/</g, '&lt;')}</td><td>expected ${CATEGORY_NAMES[m.truth as Category] ?? m.truth}</td><td>read as ${CATEGORY_NAMES[m.got as Category] ?? m.got}</td><td>${m.asked ? 'asked the user' : ''}</td></tr>`)
    .join('') || '<tr><td>No mistake.</td></tr>';
}

document.querySelector('#rules')!.addEventListener('click', async () => add('Rules only', await evaluate(sets[setName()])));
document.querySelector('#nano')!.addEventListener('click', async () => {
  const status = document.querySelector('#status')!;
  if ((await HybridAI.onDeviceStatus()) !== 'available') {
    status.textContent = 'Gemini Nano is not ready on this computer. Open the app and click Download the on-device model first.';
    return;
  }
  status.textContent = 'Running on this device...';
  (document.querySelector('#nano') as HTMLButtonElement).disabled = true;
  const r = await evaluate(sets[setName()], (txs) => ai!.classifyTransactions(txs, 'user', (d, t) => (status.textContent = `${d}/${t} lines`)));
  status.textContent = '';
  (document.querySelector('#nano') as HTMLButtonElement).disabled = false;
  add('Rules + Gemini Nano', r);
});
