# Design guide

Every screen follows the **Instrument Calendar — NKU Prototypes** design canvas
(https://claude.ai/artifact/GUA2hp5d8KttdJHeETnr1u). Before building a new screen, look
for its artboard there. If there isn't one, compose it from the pieces below so it looks
like it belongs.

| Artboard                         | Built as                                   |
| -------------------------------- | ------------------------------------------ |
| Instruments (home)               | `src/app/(site)/page.tsx`                  |
| Week schedule                    | `src/app/(site)/instruments/[slug]/page.tsx` |
| Book time (dialog)               | `src/components/booking-dialog.tsx`        |
| Reserve for a class (instructor) | `src/app/(site)/classes/page.tsx` + `reserve-form.tsx`. The "Every week" mode (per-date checklist) and the "Your class reservations" list below the form have no artboard; they reuse the impact panel's styles |
| Shared header                    | `src/components/app-header.tsx`; its avatar opens `account-menu.tsx` (identity, research group, appearance, sign out) on desktop and phone |
| Phone · Book time                | the booking dialog, as a bottom sheet under 640px |
| Phone · Day schedule             | `src/components/day-agenda.tsx`, under 640px on the instrument page and the embed |
| My bookings (no artboard; composed from the home page's booking cards) | `src/app/(site)/my-bookings/page.tsx` |
| Phone · Instruments              | not built yet                              |
| Instrument settings (admin)      | not built yet                              |

## Tokens: never write a colour

All colour comes from tokens in [`src/app/globals.css`](../src/app/globals.css), defined
once for light and once for dark. Use the Tailwind names, never hex codes or Tailwind's
palette (`stone-*`, `indigo-*` …). A hard-coded colour is a dark-mode bug.

| Use                                  | Classes                                       |
| ------------------------------------ | --------------------------------------------- |
| Page background                      | `bg-bg`                                       |
| Panels, cards, inputs                | `bg-surface`; `bg-surface-2` for subtle fills |
| Recessed (tracks, closed time, code) | `bg-sunken`                                   |
| Text: primary, secondary, tertiary   | `text-ink`, `text-ink-2`, `text-ink-3`        |
| Borders: hairline, control           | `border-line`, `border-line-2`                |
| The one main action                  | `bg-gold text-on-gold`                        |
| Header chrome                        | `bg-chrome`, `text-chrome-ink(-2)`            |
| Status                               | `ok`, `warn`, `err`, each with a `-soft` fill |
| "Yours"                              | `bg-mine text-on-mine`, `bg-mine-soft`        |
| Class / maintenance fills            | `stripes-class`, `stripes-maintenance`        |
| Raised card shadow                   | `shadow-[var(--ui-shadow)]` (or `<Card raised>`) |

**An instrument's own colour** is data an admin sets, not a token. Pass it as the CSS
variable `--inst` and use `inst-soft` (tinted background), `inst-ink` (legible text) or
`inst-dot`. They blend with the theme so they work in both modes. `<InstrumentTile>`
already does this.

To pin a region to one theme regardless of the viewer's choice (the embed does this to
match the department's light page), put `data-theme="light"` or `"dark"` on its wrapper.

## Pieces: `src/components/ui.tsx`

Build from these instead of restyling raw elements:

- **`Button` / `ButtonLink` / `buttonClass()`**: `primary` (gold), `secondary` (outlined)
  or `ghost`, in sizes `md`, `lg` or `icon`. Use one primary per view, for the thing the
  screen is for. Don't pass classes that fight the built-in padding or text size; pick a
  size instead.
- **`Card`**: the surface panel. `raised` adds the shadow; `as="section"` etc. sets the
  element.
- **`Field`** + **`fieldClass`** / **`textareaClass`**: a label wrapping its control,
  with an inline `hint` ("optional", "shown to affected students"), a `required` marker
  and `help` text below.
- **`Segmented`**: pick-one buttons, like the dialog's Length choice.
- **`Notice`**: `ok`, `warn`, `err` or `info` messages with icon and title. Pass `alert`
  for errors that appear after a submit.
- **`Chip`**, **`Eyebrow`** (small uppercase heading), **`InstrumentTile`**.

## Patterns

- **Type:** Figtree throughout. Page titles are 32–40px `font-extrabold` with
  `tracking-[-0.02em]`; section headings 18–20px `font-bold`; body 15–17px.
- **Layout:** content sits in the layout's 1240px column. Side-by-side panels use
  `flex flex-wrap` with `flex-[999_1_640px]` / `flex-[1_1_280px]`, so they stack on
  narrow screens without media queries.
- **Touch targets:** every control is at least 44px tall (`min-h-11`).
- **Focus:** the gold focus ring is global. Never remove an outline without replacing it.
- **Phones:** the breakpoint is Tailwind's `sm` (640px). Below it, dialogs become bottom
  sheets, and wide grids either scroll inside their own box or, better, have a phone
  layout of their own.
- **Times:** campus time, 24-hour (`14:00 – 15:00`, `17:00 → 08:00` overnight) in
  schedules. Format on the server (`src/lib/time.ts`); a component that formats dates
  during server rendering can disagree with the browser and break hydration.
- **Privacy:** students see each other's names only when signed in, and never on
  `/embed`. Show what a booking *is*, not what someone is running.
- **Copy:** say what happens ("Reserve 13:00 – 17:00 & cancel 2 bookings"), and explain
  refusals with a way forward. Describe booking windows through `src/lib/window-copy.ts`,
  so the wording matches everywhere.
- **Accessibility:** real `<button>` and `<a>` elements, labels on every control, and
  `aria-label` on icon-only buttons. Anything drawn by position (calendar blocks) also
  carries its time as text for screen readers.
