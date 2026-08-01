// Persisted AI-assist settings (Gemini). The key lives only in this browser's localStorage and
// is sent solely to Google when the user clicks "refine with AI". OFF until a key is entered.
import { GEMINI_DEFAULT_MODEL } from './geminiClassify';

const K_KEY = 'autospec.gemini.key';
const K_MODEL = 'autospec.gemini.model';
const ls = (): Storage | null => (typeof localStorage !== 'undefined' ? localStorage : null);

export const getGeminiKey = (): string => ls()?.getItem(K_KEY) || '';
export const setGeminiKey = (v: string) => ls()?.setItem(K_KEY, v.trim());
export const getGeminiModel = (): string => ls()?.getItem(K_MODEL) || GEMINI_DEFAULT_MODEL;
export const setGeminiModel = (v: string) => ls()?.setItem(K_MODEL, v.trim() || GEMINI_DEFAULT_MODEL);
