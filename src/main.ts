import { makeHebrewPdf } from './stage0/makeHebrewPdf';

const btn = document.getElementById('gen') as HTMLButtonElement;
const prev = document.getElementById('prev') as HTMLIFrameElement;
const dl = document.getElementById('dl') as HTMLAnchorElement;

async function generate() {
  const fontBytes = new Uint8Array(await (await fetch('/fonts/PeugeotNewHebrew-Regular.otf')).arrayBuffer());
  const pdf = await makeHebrewPdf(fontBytes);
  const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
  prev.src = url;
  dl.href = url;
}

btn.addEventListener('click', generate);
generate();
