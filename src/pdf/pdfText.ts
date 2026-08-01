// Lightweight PDF → plain text (for AI source material only). Uses pdf.js getTextContent;
// no rendering, no IR — just the words on every page, joined in reading order.
let workerConfigured = false;

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  if (typeof window !== 'undefined' && !workerConfigured) {
    const Worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline')).default;
    (pdfjs as any).GlobalWorkerOptions.workerPort = new Worker();
    workerConfigured = true;
  }
  return pdfjs as any;
}

/** Extract all text from a PDF as one string (pages separated by blank lines). */
export async function extractPdfText(data: ArrayBuffer | Uint8Array): Promise<string> {
  const pdfjs = await loadPdfjs();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false }).promise;
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const line = tc.items.map((it: any) => (typeof it.str === 'string' ? it.str : '')).join(' ');
    if (line.trim()) out.push(line.replace(/\s+/g, ' ').trim());
  }
  return out.join('\n\n');
}
