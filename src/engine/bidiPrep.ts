// Bidi text PREPARATION shared by BOTH export paths — this is UAX #9 INPUT (isolate controls +
// NBSP), never reordering. Domain rule, hard-won on real brochures (F2): a spaced digit list —
// a scale "1 2 3 4", a letter-spaced phone "0 3 - 6 7 1 0 3 3 3", a run "04 - 6572222 ,2003" —
// reads LEFT-TO-RIGHT as ONE number sequence in this domain. Plain space is bidi-neutral (rule
// N1 hands it the RTL paragraph level and REVERSES the list); NBSP is CS, which bridges EN runs
// (rule W4), and the LRI/PDI isolates pin the token's direction without touching its content.
//
// ONLY wrap a token that actually CONTAINS A SPACE: a contiguous number ("2017/1151") needs no
// isolate, and wrapping it severs it from a preceding Latin run ("EU 2017/1151") that UBA rule
// W7 folds into ONE LTR run — the isolate flips "EU 2017/1151" to "2017/1151 EU".
export function bridgeNumericTokens(logical: string): string {
  return logical.replace(/\d[\d,\-–—.:/ ]*\d/g, (tok) =>
    tok.includes(' ') ? '\u2066' + tok.replace(/ /g, '\u00A0') + '\u2069' : tok);
}
