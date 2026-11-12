import type { Account } from '../core/types';

/**
 * Renders a synthetic account as a classic bank statement PDF, in the browser or in tests,
 * so the PDF import can be tried without a real statement. Fictional bank, fictional person.
 *
 * `compact` is a deliberately unusual layout (no standard column names, month names, signed
 * amounts in one column): the layout rules cannot read it, Gemini Nano can.
 */
export async function accountToPdf(account: Account, holder: string, layout: 'classic' | 'compact' = 'classic'): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const us = account.country === 'US';
  const txs = account.transactions.slice().sort((a, b) => a.date.localeCompare(b.date));
  const first = txs[0]?.date ?? '2026-01-01';
  const lastDate = txs.at(-1)?.date ?? first;
  const dmy = (d: string, withYear: boolean) => {
    const [y, m, day] = d.split('-');
    const core = us ? `${m}/${day}` : `${day}/${m}`;
    return withYear ? `${core}/${y}` : core;
  };
  const money = (n: number) => {
    const [int, dec] = Math.abs(n).toFixed(2).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, us ? ',' : ' ');
    return us ? `${grouped}.${dec}` : `${grouped},${dec}`;
  };
  const bankName = account.name.split(' - ')[0];
  const cols = us
    ? { date: 40, label: 92, out: 420, in: 495, bal: 572, hOut: 'Withdrawals', hIn: 'Deposits', hBal: 'Balance' }
    : { date: 40, label: 92, out: 440, in: 530, bal: 0, hOut: 'Débit', hIn: 'Crédit', hBal: '' };

  let page = doc.addPage([612, 792]);
  let y = 0;
  const right = (text: string, xRight: number, f = font, size = 9) =>
    page.drawText(text, { x: xRight - f.widthOfTextAtSize(text, size), y, size, font: f });
  const compact = layout === 'compact';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const header = () => {
    if (compact) {
      page.drawText('When', { x: cols.date, y, size: 9, font: bold });
      page.drawText('What happened', { x: cols.label, y, size: 9, font: bold });
      right('Value', cols.in, bold);
      y -= 20;
      return;
    }
    page.drawText(us ? 'Date' : 'Date', { x: cols.date, y, size: 9, font: bold });
    page.drawText(us ? 'Description' : "Libellé de l'opération", { x: cols.label, y, size: 9, font: bold });
    right(cols.hOut, cols.out, bold);
    right(cols.hIn, cols.in, bold);
    if (cols.bal) right(cols.hBal, cols.bal, bold);
    y -= 6;
    page.drawLine({ start: { x: 40, y }, end: { x: 572, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    y -= 14;
  };
  const top = () => {
    y = 750;
    page.drawText(bankName, { x: 40, y, size: 16, font: bold });
    y -= 20;
    page.drawText(us ? 'Account statement - synthetic sample' : 'Relevé de compte - exemple fictif', { x: 40, y, size: 10, font });
    y -= 14;
    page.drawText(
      us ? `Statement period: ${dmy(first, true)} to ${dmy(lastDate, true)}` : `Période du ${dmy(first, true)} au ${dmy(lastDate, true)}`,
      { x: 40, y, size: 10, font },
    );
    y -= 14;
    page.drawText(`${us ? 'Account holder' : 'Titulaire'}: ${holder}`, { x: 40, y, size: 10, font });
    y -= 30;
    header();
  };
  top();
  let balance = 3200;
  for (const t of txs) {
    if (y < 60) {
      page = doc.addPage([612, 792]);
      top();
    }
    balance += t.amount;
    if (compact) {
      page.drawText(`${MONTHS.at(Number(t.date.slice(5, 7)) - 1)} ${t.date.slice(8)}`, { x: cols.date, y, size: 9, font });
      page.drawText(t.rawLabel.toLowerCase(), { x: cols.label, y, size: 9, font });
      right(`${t.amount < 0 ? '-' : '+'}${money(t.amount)}`, cols.in);
      y -= 14;
      continue;
    }
    page.drawText(dmy(t.date, false), { x: cols.date, y, size: 9, font });
    page.drawText(t.rawLabel, { x: cols.label, y, size: 9, font });
    right(money(t.amount), t.amount < 0 ? cols.out : cols.in);
    if (cols.bal) right(money(balance), cols.bal);
    y -= 14;
  }
  return doc.save();
}
