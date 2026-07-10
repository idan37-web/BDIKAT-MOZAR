// Gemini implementation of the SemanticProvider contract. Reuses the transport pattern of
// geminiClassify (free-tier key, 429/503 backoff) and adds the VISION part: the page render
// travels as inline JPEG next to the compact block list. Temperature 0; ONE retry on schema
// failure (the validation error is echoed back so the model can correct itself).
import type { PageClassifyInput, SemanticProvider, TableRescueInput } from './provider';
import { BLOCK_ROLES, PAGE_TYPES, parsePageSemantics, parseTableRescue, type PageSemantics, type TableRescue } from './semanticSchema';

export const GEMINI_VISION_DEFAULT = 'gemini-2.5-flash';

interface GeminiPart { text?: string; inline_data?: { mime_type: string; data: string } }

/** POST one generateContent call with quota backoff (shared transport for classify + rescue). */
async function geminiGenerate(apiKey: string, model: string, parts: GeminiPart[]): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      const json = await res.json();
      const text: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
      if (!text) throw new Error('Gemini returned an empty response');
      return text;
    }
    const errText = (await res.text()).slice(0, 400);
    lastErr = `Gemini ${res.status}: ${errText}`;
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      const m = /"retryDelay":\s*"?(\d+)s/.exec(errText);
      await sleep(m ? Math.min(30, +m[1]) * 1000 : 1500 * (attempt + 1) ** 2);
      continue;
    }
    throw new Error(lastErr);
  }
  throw new Error(lastErr || 'Gemini: failed after retries');
}

function classifyPrompt(input: PageClassifyInput): string {
  const lines = [
    'You label blocks of a Hebrew (RTL) car-brochure page. The blocks were produced by OUR extractor;',
    'you ONLY CLASSIFY them. Never output coordinates, never invent block ids, never rewrite text.',
    `pageType: one of ${PAGE_TYPES.join(', ')}.`,
    `block role: one of ${BLOCK_ROLES.join(', ')}.`,
    'variability: "variable" if the content changes between car models of the same brand (model names,',
    'trim names, spec values, hero/gallery photos, prices); "fixed" for brand furniture identical in',
    'every brochure (logo, legal boilerplate, column labels, page numbers, decorative elements).',
    'Answer STRICT JSON only:',
    '{"pageType":"...","blocks":[{"id":"...","role":"...","variability":"fixed|variable","confidence":0..1,"reason":"<=15 words"}]}',
    'Include EVERY id from the list below exactly once. Use ONLY the enum values above.',
  ];
  if (input.fewShot?.length) {
    lines.push('', 'Examples reviewed and corrected by the user for this brand (follow their conventions):');
    input.fewShot.forEach((ex, i) => {
      lines.push(`--- example ${i + 1} input blocks ---`, JSON.stringify(ex.blocks));
      lines.push(`--- example ${i + 1} correct output ---`, JSON.stringify(ex.labels));
    });
  }
  lines.push('', `Page ${input.pageWidth}x${input.pageHeight}pt${input.brand ? `, brand: ${input.brand}` : ''}. Blocks:`, JSON.stringify(input.blocks));
  return lines.join('\n');
}

const RESCUE_PROMPT = [
  'This image is a TABLE region from a Hebrew (RTL) car-spec brochure. Return its LOGICAL structure',
  'ONLY as strict JSON: {"headerRows":[rowIndexes],"rows":[["cell text",...],...],"colspans":[[row,col,span],...]}.',
  'Columns in LOGICAL order (index 0 = the label column, which appears RIGHTMOST on the page).',
  'Copy cell texts EXACTLY as printed (same characters); empty string for empty cells. Never output',
  'coordinates and never invent text that is not visible. The extracted text runs are listed for',
  'reference only:',
].join('\n');

export class GeminiSemanticProvider implements SemanticProvider {
  readonly name: string;
  constructor(private apiKey: string, private model = GEMINI_VISION_DEFAULT) {
    this.name = `gemini:${model}`;
  }

  async classifyPage(input: PageClassifyInput): Promise<PageSemantics> {
    const allowed = new Set(input.blocks.map((b) => b.id));
    const parts: GeminiPart[] = [
      { inline_data: { mime_type: 'image/jpeg', data: input.imageJpegBase64 } },
      { text: classifyPrompt(input) },
    ];
    const first = await geminiGenerate(this.apiKey, this.model, parts);
    try {
      return parsePageSemantics(first, allowed);
    } catch (e) {
      // ONE retry on schema failure (contract): echo the validation error so the model can fix it.
      const err = e instanceof Error ? e.message.slice(0, 400) : String(e);
      const retryParts: GeminiPart[] = [
        ...parts,
        { text: `Your previous answer failed schema validation: ${err}\nAnswer again with STRICT valid JSON only.` },
      ];
      const second = await geminiGenerate(this.apiKey, this.model, retryParts);
      return parsePageSemantics(second, allowed);
    }
  }

  async rescueTable(input: TableRescueInput): Promise<TableRescue> {
    const parts: GeminiPart[] = [
      { inline_data: { mime_type: 'image/jpeg', data: input.imageJpegBase64 } },
      { text: `${RESCUE_PROMPT}\n${JSON.stringify(input.texts.slice(0, 200))}` },
    ];
    const first = await geminiGenerate(this.apiKey, this.model, parts);
    try {
      return parseTableRescue(first);
    } catch (e) {
      const err = e instanceof Error ? e.message.slice(0, 400) : String(e);
      const second = await geminiGenerate(this.apiKey, this.model, [...parts, { text: `Schema error: ${err}. Strict JSON only.` }]);
      return parseTableRescue(second);
    }
  }
}
