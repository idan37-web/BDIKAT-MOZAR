# Semantic layer — judgment (heuristics vs AI)

Golden set: 15 hand-labeled pages, 587 labeled blocks (tests/golden/pages.json).
Generated 2026-07-10T10:40Z by scripts/semanticJudge.mts.

| metric | heuristics | ai (PENDING — run with GEMINI_API_KEY) |
|---|---|---|
| pageType accuracy | 66.7% (10/15) | — |
| macro-F1 (block roles) | 37.5% | — |

## Per-role precision / recall

| role | support | heur P | heur R | AI P | AI R |
|---|---|---|---|---|---|
| brand_logo | 2 | 0.0% | 0.0% | — | — |
| decorative | 40 | 95.2% | 100.0% | — | — |
| footnote | 15 | 0.0% | 0.0% | — | — |
| legal_text | 17 | 6.0% | 52.9% | — | — |
| model_name | 5 | 83.3% | 100.0% | — | — |
| other | 121 | 0.0% | 0.0% | — | — |
| section_heading | 21 | 77.8% | 33.3% | — | — |
| spec_table | 366 | 71.2% | 44.0% | — | — |

## Verdict

The AI column is PENDING (no GEMINI_API_KEY in the environment). Per the contract, the AI path becomes default ONLY if it beats the heuristics on this table — the default therefore REMAINS the heuristic learner.
