# Accessibility: WCAG 2.2 AA

Target: **WCAG 2.2 level AA** across all three portals and the public pages (sign-in, sign-up, inquiry form, proposal link).

## How it was checked (2026-11-17)

- **Automated:** axe-core 4.10 with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` rules, run in a real browser against the deployed site.
  - Coverage: every admin page, every crew page, every client portal page, and the public pages.
  - Crew and client pages were checked at 1280px and at 390px (a phone).
- **By hand:** the things axe cannot judge:
  - keyboard use and the skip link;
  - reflow at 320px;
  - focus not hidden;
  - timing and auto-updating content;
  - target sizes;
  - colour pairs computed from the design tokens.

## What changed to meet it

| WCAG 2.2 criterion | Change |
| --- | --- |
| 1.4.3 Contrast (minimum) | Accent `#7A7059` → `#70664F` (5.2:1 on the background, 4.7:1 on chips). Attention `#9C5F5F` → `#935757` (≥4.57:1 on every background). Every text/background pair in the tokens is now ≥4.5:1. |
| 1.4.11 Non-text contrast | New `inputBorder` `#857D6E` (4:1) for every field, select and outline button; checkbox border `#8A8273` (3.7:1). The light `border` token is decorative only. |
| 1.4.10 Reflow | The operations board and the inquiries board wrap their columns instead of scrolling sideways, so nothing needs two-way scrolling at 320px. Data tables keep their own horizontal scroll, which the criterion allows. |
| 1.4.12 Text spacing | Buttons and inputs use a minimum height instead of a fixed one and may wrap, so larger spacing never clips text. |
| 2.2.1 Timing adjustable | Success messages stay until dismissed instead of vanishing after 7 seconds. |
| 2.2.2 Pause, stop, hide | The board and the live shot list, which refresh themselves, have a Pause / Resume control. |
| 2.4.1 Bypass blocks | A "Skip to main content" link is first on every page; every layout's `<main>` is its target. |
| 2.4.7 / 2.4.11 Focus visible, not obscured | A 3px dark focus ring everywhere. Success messages sit in the page instead of floating over it. Focused elements scroll clear of the phone tab bar and the pinned action bar (`scroll-padding`). |
| 2.5.8 Target size (minimum) | Links under the sign-in card are 24px+ tall; checkboxes are 20px with spacing; small buttons are ≥32×44. |
| 1.3.5 Identify input purpose | Name, email, phone and password fields that ask about the person themself carry `autocomplete`. |
| 4.1.2 Name, role, value | Progress bars have names and value text; icon-only controls have labels; "Download" buttons say which file. |
| 3.3.8 Accessible authentication | Email and password with paste, password managers (`autocomplete`) and Show/Hide; no puzzles or memory tests. |
| Motion | `prefers-reduced-motion` turns off animation and smooth scrolling. |

Already in place: labels on every field, errors announced (`role="alert"`) and described in words, status messages announced (`role="status"`), status never shown by colour alone, page language and titles, landmarks (`nav`, `main`), alt text, and 44px touch targets in the crew app.

## Keeping it

- Use the tokens; never a raw colour. New text colours must reach 4.5:1 on `bg`, `surface` and `surfaceAlt`. New control borders must reach 3:1.
- Use `inputStyle`, `textareaStyle`, `buttonStyle` and `ActionForm` for forms.
- Re-run the axe check on changed pages. The browser snippet is in the commit that added this file, and any axe browser extension works too.
- Not covered by an automated check: captions for client videos. Video deliverables are files the client downloads, not media played in the app, so 1.2.x applies to the files themselves, not to the app.
