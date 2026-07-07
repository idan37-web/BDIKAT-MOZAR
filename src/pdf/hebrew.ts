// Back-compat shim: the canonical bidi seam moved to src/engine/bidi.ts (T4, Reference
// Playbook). pdf-lib does NO bidi/shaping, so every draw call must convert logical → visual
// per wrapped line through that one module.
import { toVisualLine } from '../engine/bidi';

export { toVisualLine };
export const logicalToVisual = toVisualLine;
