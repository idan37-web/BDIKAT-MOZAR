// Classifier result cache keyed by (fileHash, pageIndex) — a page of the SAME source PDF never
// bills twice. Storage is injectable: localStorage in the app, a Map (or file-backed map) in Node.
import type { PageSemantics } from './semanticSchema';
import { pageSemanticsSchema } from './semanticSchema';

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const memory = new Map<string, string>();
const memoryKV: KV = { get: (k) => memory.get(k) ?? null, set: (k, v) => { memory.set(k, v); } };

function defaultKV(): KV {
  if (typeof localStorage !== 'undefined') {
    return {
      get: (k) => localStorage.getItem(k),
      set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota — cache is best-effort */ } },
    };
  }
  return memoryKV;
}

const keyOf = (fileHash: string, pageIndex: number) => `autospec.sem.${fileHash}.${pageIndex}`;

export function getCachedSemantics(fileHash: string, pageIndex: number, kv: KV = defaultKV()): PageSemantics | null {
  const raw = kv.get(keyOf(fileHash, pageIndex));
  if (!raw) return null;
  try { return pageSemanticsSchema.parse(JSON.parse(raw)); } catch { return null; }
}

export function setCachedSemantics(fileHash: string, pageIndex: number, sem: PageSemantics, kv: KV = defaultKV()): void {
  kv.set(keyOf(fileHash, pageIndex), JSON.stringify(sem));
}

/** SHA-256 of the source PDF bytes (the cache key's fileHash). Works in browser + Node 22. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', ab);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
