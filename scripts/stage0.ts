// Headless Stage-0 runner: writes stage0.pdf so the gate artifact can be opened/verified.
import { readFileSync, writeFileSync } from 'node:fs';
import { makeHebrewPdf, GATE_STRING } from '../src/stage0/makeHebrewPdf';

const fontBytes = new Uint8Array(readFileSync('public/fonts/PeugeotNewHebrew-Regular.otf'));
const pdf = await makeHebrewPdf(fontBytes);
writeFileSync('stage0.pdf', pdf);
console.log(`wrote stage0.pdf (${pdf.length} bytes) — gate string: ${GATE_STRING}`);
