import type { PdfLine } from './statement-text';

/**
 * Extracts positioned text lines from a PDF, on the device, with pdf.js.
 * The pdf.js module is passed in so the same code runs in the browser and in the tests.
 */
interface TextItemLike {
  str: string;
  transform: number[];
  width?: number;
}
interface PdfJsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; verbosity?: number }): {
    promise: Promise<PdfDocLike>;
    destroy(): Promise<void>;
  };
}
interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
}

export async function extractPdfLines(pdfjs: PdfJsLike, data: Uint8Array): Promise<PdfLine[]> {
  const task = pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const lines: PdfLine[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = (content.items as TextItemLike[]).filter((i) => typeof i.str === 'string' && i.str.trim());
      const rows: PdfLine[] = [];
      for (const it of items) {
        const x = it.transform[4];
        const y = it.transform[5];
        const row = rows.find((r) => Math.abs(r.y - y) < 2.5);
        const item = { x, width: it.width, text: it.str };
        if (row) row.items.push(item);
        else rows.push({ page: p, y, items: [item] });
      }
      rows.sort((a, b) => b.y - a.y); // PDF y grows upwards
      rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
      lines.push(...rows);
    }
  } finally {
    await task.destroy();
  }
  return lines;
}

/** Browser entry point: loads pdf.js lazily so it stays out of the main bundle. */
export async function readPdfInBrowser(file: ArrayBuffer): Promise<PdfLine[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return extractPdfLines(pdfjs as unknown as PdfJsLike, new Uint8Array(file));
}
