---
name: make-interfaces-feel-better
description: Polish the FEEL of a UI without rebuilding it — interaction states, spacing rhythm, motion, feedback, empty/loading/error states, focus & keyboard, and RTL/Hebrew correctness. Use when the user asks to "make it feel better/nicer/more polished", "improve the UX", "tighten the design", "add micro-interactions", "the UI feels off/cheap/janky", or wants a pass over an existing screen/component to raise its quality without changing the architecture.
---

# Make interfaces feel better

A focused quality pass on an EXISTING interface. Goal: raise perceived quality and
responsiveness without redesigning or rebuilding. Small, reversible, high-leverage changes.

## When to use
- "Make this screen feel nicer / more polished / less cheap."
- "Improve the UX of X", "tighten the spacing", "add some motion", "the button feels dead."
- A feature works but the interaction is rough (no hover/active/disabled states, abrupt changes,
  no feedback on click, jumpy layout, missing empty/error states).

## When NOT to use
- Net-new features or flows (build them first, then polish).
- Correctness bugs (use a debugging/review path).
- A full visual redesign or rebrand (that's a design task, not a feel pass).

## Operating principles
1. **Do not break behavior or layout contracts.** Polish is additive and reversible. Never change
   data flow, state shape, or routing to make something "feel" better.
2. **Match the existing system.** Reuse the project's tokens/variables, component patterns, and
   spacing scale. Do not introduce a new design language or a UI library.
3. **Smallest change that moves perceived quality.** Prefer 3 surgical edits over a rewrite.
4. **Every interactive element earns its states.** default / hover / active / focus-visible /
   disabled / loading. A control with only a default state feels dead.
5. **Motion serves meaning.** 120–200ms ease-out for enter/affordance; respect
   `prefers-reduced-motion`. No gratuitous animation, no layout-shifting transitions.
6. **Feedback is immediate.** Every action acknowledges within ~100ms (press state, spinner,
   optimistic update, toast). Never let a click feel like nothing happened.

## Checklist (run top to bottom; fix what applies)
- **Interaction states** — hover, `:active`, `:focus-visible` (keyboard), `:disabled` (reduced
  opacity + `cursor: not-allowed`), and a clear selected/active state for toggles.
- **Feedback** — buttons show a busy/disabled state during async work; destructive actions confirm;
  success/error is visible (inline message or toast), not silent.
- **Spacing rhythm** — consistent scale (4/8px), align edges, group related controls, give content
  breathing room; kill cramped or uneven gaps.
- **Typography** — clear hierarchy (size/weight/color), readable line-height, truncate/ellipsis long
  strings instead of overflowing.
- **Empty / loading / error states** — never a blank box. Skeletons or a spinner for loading; a
  helpful empty state with a next action; a recoverable error state.
- **Motion** — transition color/opacity/transform (not `width`/`top`/`height` that reflow); 120–200ms;
  `prefers-reduced-motion: reduce` disables it.
- **Focus & keyboard** — logical tab order, visible focus ring, Enter/Esc on dialogs, arrow keys
  where natural, no keyboard traps.
- **Hit targets** — ≥ 32–40px clickable; icon-only buttons get a `title`/`aria-label`.
- **Alignment & overflow** — nothing clipped or jumping; scroll containers behave; sticky headers stay.
- **Color & contrast** — meet WCAG AA for text; don't rely on color alone to convey state.

## RTL / Hebrew (this project is Hebrew, RTL — always verify)
- Use logical CSS properties (`margin-inline`, `padding-inline`, `inset-inline`, `border-inline`)
  instead of physical left/right so layout mirrors correctly.
- Keep `dir="rtl"` containers; set `dir="ltr"` only on genuinely LTR content (URLs, API keys,
  model ids, code, raw numbers/measurements).
- Numbers, units, and Latin tokens inside Hebrew text must stay readable — use `unicode-bidi`
  appropriately; verify the rendered order, don't trust your own reading of RTL.
- Mirror directional affordances (chevrons, "next/prev", progress) for RTL.

## Workflow
1. **Identify the target** surface/component and read it. Note the existing tokens, spacing scale,
   and interaction patterns already in use.
2. **Inventory gaps** against the checklist — list the few highest-impact issues for THIS screen.
3. **Apply** the smallest edits that fix them, reusing existing variables/components.
4. **Verify**: typecheck/build, and confirm states by reasoning through default → hover → active →
   focus → disabled → loading. For RTL, confirm mirroring and number/order correctness. If a verify
   or run skill exists in the project, use it to see the change.
5. **Summarize** what changed and why it feels better — keep it short.

## Anti-patterns
- Swapping in a component library or new CSS framework "to look nicer."
- Animating layout properties (causes reflow/jank) or adding motion that ignores reduced-motion.
- Big spacing/typography rewrites that change the layout the user relies on.
- Adding states that look pretty but aren't wired to real behavior.
- Polishing before the underlying feature actually works.
