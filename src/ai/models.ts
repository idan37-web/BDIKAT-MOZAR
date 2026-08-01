// Shared Gemini model list for the AI-assist UIs. Ordered newest→oldest so the smartest free
// Flash is the default. Gemini 3 Flash / Flash Lite are the current generation (2026); the 2.x
// entries stay as fallbacks if a key/project lacks access to the newest models.
export const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-3-flash',
  'gemini-3-flash-lite',
];

/** Default for generative copy completion: the most capable free Flash that is GA on the public
 * endpoint. (gemini-3-flash is offered in the selector but not all keys can reach it yet.) */
export const GEMINI_COMPLETE_DEFAULT = 'gemini-2.5-flash';
