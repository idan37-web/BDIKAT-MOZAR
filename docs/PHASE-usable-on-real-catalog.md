# AutoSpec Studio — Phase: make it usable on a real catalog (post Stage 7)

The three engines now have a skeleton: real import (extract + render), template learning with
fixed/dynamic slots, generation with required-field validation, and the editor. The goal of THIS phase is
NOT new breadth. Do not add new slot types, new templates, effects, or print/CMYK yet. The goal is to prove
the full loop produces ONE usable catalog from real data, and to remove the things that block daily use.

ASSUMPTIONS (flag if wrong): primary output is high-quality digital RGB PDF; structured-data ingestion is
built so it ALSO supports manual entry. Print/CMYK is deferred (see "Deferred").

Work the milestones in order. Each ends with an acceptance test that produces a real, openable artifact.
Do not move on until it passes. Do not go breadth-first.

## Milestone A — End-to-end hardening on ONE real catalog
Take a real catalog family. Learn a template from it, generate a NEW model's catalog by streaming real
assets, edit, and export a PDF. Fix whatever breaks on real data. Remove any remaining simulated steps
(setTimeout progress that isn't backed by real work). Every action must produce a real result.
Acceptance: a real model's catalog is generated, edited, and exported to a PDF that visually matches the
editor, with selectable vector text and correct Hebrew order. No simulated progress remains.

## Milestone B — Generation-time auto-fit (text + tables)
At generation time an overflow WARNING is not enough; auto-generated pages must not come out broken.
- Text slots: measure rendered text vs box. If it overflows, in order: shrink font down to a floor
  (e.g. 85% of the design size), then wrap, then expand the box within page bounds, else flag clearly.
  Underflow stays visually balanced. Preserve RTL throughout.
- Spec/safety tables: if rows exceed available height, reduce row height/font to a floor, then continue
  into a continuation area/page, else flag. Never silently clip.
Acceptance: generate a model whose marketing text and spec table are LONGER than the template's, and the
output pages are not clipped, not overflowing, and remain readable without manual per-box fixing.

## Milestone C — Project persistence (no more single-session)
Add an IndexedDB store (this is a real app, not a claude.ai artifact, so IndexedDB is fine).
- Templates library: save/list/open/duplicate/delete learned TemplateSpecs with thumbnails.
- Projects: save/open in-progress catalogs (DocumentIR + assets), with autosave and a "saved" indicator.
Acceptance: learn a template, close and reopen the app, the template and an in-progress catalog are still
there and open correctly.

## Milestone D — Structured-data ingestion for generation (with manual fallback)
The user already maintains a structured catalog library (Markdown spec files; Excel comparison data).
Build an adapter that maps that structured data to slots instead of manual entry every time.
- Parse a spec table (key/value rows), color list, wheel list, marketing text, legal text, price from the
  user's existing structured format. Reuse the schema from the existing car-comparison workflow if possible.
- Map parsed fields to template slots by name/heuristic, with a manual override UI for mismatches.
- Manual asset entry remains available as a fallback for anything not in the structured data.
Acceptance: feed a real structured spec file, and the catalog is populated from it with minimal manual
entry; unmapped fields are clearly surfaced for manual fill.

## Deferred (do NOT build now; just stay compatible)
Print readiness (bleed, 300dpi, CMYK) is a later, optional milestone, only if output goes to print.
For now: keep exported page geometry in PDF points, embed fonts (already done), and do NOT downsample
images on export, so a future print step is feasible without rework.

## Method reminders
- Small stages, real artifact + acceptance test each. No breadth-first.
- After Milestones A/B, re-run the real-catalog test end to end and confirm nothing regressed.
- Keep all prior hard rules (single operator-list walk for import; overlap never merges/drops; no
  text-bearing render-crop; vector export only).
