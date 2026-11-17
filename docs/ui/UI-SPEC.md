# UI Spec: Moments to Media Contractor Ops

This is the build spec for every screen in the approved prototype. Implement the UI from this file and the prototype sources next to it. Data, permissions and status rules come from `docs/PRD.md`; when the two disagree, the PRD wins and you flag the conflict.

## What's in this kit

```
docs/ui/UI-SPEC.md            this file
docs/ui/prototype/*.dc.html   the 11 approved screens (source of truth for look and copy)
docs/ui/prototype/canvas.json screen index (names and sizes)
assets/brand/m2m-monogram.png MM circle logo, transparent, 288x292
assets/brand/m2m-wordmark.png "Moments to Media Content Co." wordmark, transparent, 484x108
```

### How to read the prototype files

- Each `.dc.html` file is one screen written for a design-canvas runtime (`<x-dc>`, `<sc-if>`, `<sc-for>`, `{{ hole }}` bindings, a `class Component extends DCLogic` block). **Do not port that runtime or load `support.js`.** Treat the files as a visual and behavioral reference.
- Inline `style="…"` values are exact: colors, font sizes, weights, padding, gaps, radii. Match them.
- The `renderVals()` block at the bottom of each file shows the interactive behavior (what toggles, what text changes). Re-implement that as real state backed by Supabase.
- All names, events, rates, dates and file sizes are sample data. Replace them with live data; keep the copy patterns (for example "Confirm by 9 PM", "3 of 5 must-haves").
- Phone screens are drawn at 390px wide. Some are taller than one phone screen (Event packet 1700px, Profile 1320px, Shot list 1060px): those are scroll views, not fixed heights.

## 1. Design tokens

Put these in `packages/shared/src/tokens.ts` and use them everywhere. No raw hex values in components.

```ts
export const color = {
  bg: '#F7F4EF',          // app background
  surface: '#FFFDF9',     // cards, tab bar, sidebar
  surfaceAlt: '#EFEAE2',  // chips, secondary buttons, avatar, active sidebar item
  border: '#D9D2C7',      // card borders, input borders, outlines
  divider: '#E6E0D6',     // list row dividers, progress track, disabled fills
  text: '#1F1F1F',
  textSecondary: '#3F3B35',
  textBody: '#2E2B27',    // long-form paragraphs
  textMuted: '#6B655A',
  primary: '#1F1F1F',     // primary buttons
  onPrimary: '#FFFDF9',
  label: '#7A7059',       // eyebrow labels, links, admin accent
  labelHover: '#5C5443',
  done: '#6E7360',        // checked boxes, booked days, progress fill
  checkboxBorder: '#A9A399',
  positive: '#5B6A4A',
  positiveBg: '#EEF0E9',
  positiveBorder: '#C9CEBF',
  positiveStrong: '#3F4A33',
  attention: '#9C5F5F',   // deadlines, warnings, must-have label
  attentionBorder: '#D4A5A5',
  // admin status tags
  dangerBg: '#F6E4E2', dangerText: '#8E3B3B',
  warnBg: '#F5E9E4', warnText: '#8A5543', warnBorder: '#E6CFC6',
  adminBg: '#F7F4EF', adminRowDivider: '#ECE6DC',
} as const;

export const font = {
  heading: 'Cinzel',      // 600; h1 24–28, h2 22, big numbers 40
  label: 'Montserrat',    // 500/600; eyebrows, buttons, tabs, chips
  body: 'Lato',           // 400/700; everything else
} as const;

export const radius = { xs: 6, sm: 8, md: 10, lg: 12, xl: 14, xxl: 16, pill: 18, round: 22 } as const;
export const space = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32] as const;
```

Brand palette reference (from the client's board): `#D9D2C7`, `#B6BCAD`, olive, `#1F1F1F`, `#0D0D0D`. Pale sage `#B6BCAD` and pale rose `#D4A5A5` fail contrast as text on cream; use them only as fills or borders.

### Type scale

| Use | Family | Size / weight | Extra |
| --- | --- | --- | --- |
| Screen title (h1) | Cinzel | 26 / 600 (24 on Home and Profile, 28 on detail screens) | line-height 1.15 |
| Card title (h2) | Cinzel | 22 / 600 | line-height 1.2 |
| Big number | Cinzel | 40 / 600 | Earnings total |
| Eyebrow label | Montserrat | 12 / 600 | uppercase, letter-spacing 0.1em, color `label` or `textMuted` |
| Button | Montserrat | 14–15 / 600 | |
| Tab label | Montserrat | 11 / 600 active, 500 inactive | |
| Body | Lato | 15 / 400 | paragraphs line-height 1.5 |
| Item title | Lato | 15–17 / 700 | |
| Secondary | Lato | 13–14 / 400 | `textSecondary` or `textMuted` |
| Small / status | Lato | 12 / 700 | status color |
| File names | system monospace | 13 | Upload center |

### Fonts

- Mobile: `@expo-google-fonts/cinzel`, `@expo-google-fonts/montserrat`, `@expo-google-fonts/lato`; load with `useFonts` and keep the splash screen up until loaded.
- Admin: `next/font/google` for Cinzel (600), Montserrat (500, 600), Lato (400, 700).

### Rules that apply everywhere

- Light theme only. No dark mode in v1.
- Touch targets at least 44x44.
- Text contrast at least 4.5:1. Every color pair above passes when used as specified.
- Icons are 1.8px stroke line icons (24 grid): home, briefcase, upload arrow, user, clock, map pin, phone, message, lock, check, chevron. Use `lucide-react-native` / `lucide-react` equivalents at stroke width 1.8.
- No shadows, no gradients. Separation comes from 1px borders on `surface` cards over the `bg` background.
- Status always uses text plus color, never color alone.

## 2. Brand assets

| File | Use | Size in UI |
| --- | --- | --- |
| `m2m-monogram.png` | Contractor app Home header, splash screen | 52x52 in the header |
| `m2m-wordmark.png` | Admin sidebar top, admin sign-in page | 176px wide, auto height |

Both are near-black line art on a transparent background, so they only work on light surfaces.

**Blocker for store builds:** the monogram file is 288px. App icons need a 1024x1024 master, and the splash needs a high-resolution version. Ask Moments to Media for vector (SVG or PDF) originals of both logos before the first TestFlight build. Until then use the PNGs for development only.

## 3. Shared components

Build these first. Every screen is made from them.

### Mobile (`apps/mobile/components`)

| Component | Spec |
| --- | --- |
| `Screen` | `bg` background, padding 20 horizontal, top padding 16–24, vertical gap 18–22 between sections; scrolls; bottom padding clears the tab bar or bottom action bar |
| `BackLink` | 44px tall row: chevron-left 20px + label, Montserrat 14/500, `textSecondary` |
| `Eyebrow` | Montserrat 12/600 uppercase, 0.1em tracking; colors `label` (event context), `textMuted` (section heads), `attention` (Must-have) |
| `Card` | `surface`, 1px `border`, radius 14 (16 for hero cards), padding 14–18 |
| `PrimaryButton` | height 52 (48 inside cards, 44 in pairs), radius 14/12/10, `primary` fill, `onPrimary` text, Montserrat 15/600 |
| `SecondaryButton` | height 44, radius 12, 1px `border`, transparent fill, `text` |
| `TonalButton` | height 44–48, radius 12, `surfaceAlt` fill, `text` (Directions, Open in Maps) |
| `DisabledButton` | `divider` fill, `textMuted` text, not pressable |
| `Chip` | `surfaceAlt`, radius 6, padding 4x8, Lato 12, `textSecondary` |
| `FilterPill` | height 36, radius 18, Montserrat 13/600; off: 1px `border`, `textSecondary`; on: `primary` fill, `onPrimary` text |
| `ListRow` | label left, value right, 11px vertical padding, 1px `divider` bottom border, Lato 15 |
| `FactTile` | Card radius 12, padding 12; Montserrat 11 uppercase key, Lato 15/700 value; used in a 2-column grid with gap 12 |
| `LockNotice` | `surfaceAlt` box, radius 12, lock icon + Lato 14 `textSecondary` |
| `StatusText` | Lato 12/700 in a status color: positive, attention, muted, label |
| `ProgressBar` | track `divider`, fill `done`, height 6 (shot list) or 8 (uploads), radius half height |
| `ShotCheckbox` | 24x24, radius 6, 2px `checkboxBorder` on `surface`; checked: `done` fill and border, white check |
| `CalendarDay` | 44px tall, radius 10, Montserrat 14/600; available: `surface` + 1px `border`; booked: `done` fill, `onPrimary` text, not toggleable; unavailable: 45° stripes `border`/`bg`, `textMuted` |
| `RoundIconButton` | 44x44 circle, `surfaceAlt`, icon 20 (call, text) |
| `TabBar` | 84px, `surface`, 1px `border` top; 4 tabs: Home, Jobs, Uploads, Profile; icon 22 over label; active `text`, inactive `textMuted` |
| `BottomActionBar` | pinned above safe area, `bg`, 1px `border` top, padding 16/20/28, holds one primary action plus optional helper text |

### Admin (`apps/admin/components`)

| Component | Spec |
| --- | --- |
| `AppShell` | flex-wrap row: `Sidebar` (flex 1 1 220px) + main (flex 999 1 560px, min-width 0, padding 28x32). On narrow widths the sidebar stacks above |
| `Sidebar` | `surface`, 1px `border` right, padding 24x16; wordmark at top (176px); nav items padding 10x12, radius 8, Lato 14; active: `surfaceAlt` fill, 600 weight, `text`; inactive: `textMuted`, 500 |
| `PageHeader` | Cinzel 28/600 title, Lato 14 `textMuted` subtitle; actions on the right, wrap on narrow widths |
| `PrimaryButton` (admin) | height 40, radius 8, `label` fill (`#7A7059`), white text, Montserrat 14/600 |
| `AttentionStrip` | white card listing problems as tags: danger (`dangerBg`/`dangerText`) for no-shows; warn (`warnBg`/`warnText`) for unconfirmed selections and late uploads |
| `KanbanColumn` | header Montserrat 13/600 `textMuted` with count; cards stacked, gap 10; columns in a horizontally scrolling grid, min 220px each |
| `EventCard` | `surface`, 1px `border`, radius 10, padding 12; title Lato 14/700, meta Lato 12 `textMuted`, status line in status color; actionable cards get a 1px `label` border and link to the relevant page |
| `SlotCard` | radius 12, padding 14; role and rate, staffing mode, status line; the slot being worked on gets a 2px `label` border |
| `CandidateTable` | horizontally scrollable, min width 860; columns: Contractor (name + history), Match (Cinzel 18), Distance, Gear, Reliability, Note and flags (flags in `dangerText`), action |
| `StatusBanner` | positive: `positiveBg` + `positiveBorder` + `positiveStrong` text; warn: `warnBg` + `warnBorder` + `warnText`; always has an Undo where the action is reversible |
| `RatingButtons` | 5 square buttons 32x32, radius 6; filled up to the score (`text` fill, white numbers) |

## 4. Contractor app screens

Routes use expo-router. Every screen needs loading (skeletons in the card shapes), empty and error states; the prototype shows only the populated state.

### 4.1 Home: `app/(tabs)/index.tsx` · prototype `Main.dc.html`

1. Header: monogram 52px + "Hi, {firstName}" (Cinzel 24) on the left; initials avatar 44px (`surfaceAlt`, 1px `border`) on the right, links to Profile.
2. Next-up card (hero, radius 16): eyebrow "{Tonight|Tomorrow|Sat Nov 21} · {role}" in `label`; "Call in 2h 15m" countdown right; event title Cinzel 22; call/wrap time row (clock icon) and venue row (pin icon); two buttons: Open packet (primary) and Directions (tonal, opens native maps).
3. "Needs you" section: action cards in priority order.
   - Confirm request: 1px `attentionBorder`; "You were selected · confirm by {deadline}" in `attention`; role · event; date, time, rate; Confirm (primary) and Decline (secondary). After Confirm: positive card "Confirmed: {event}" / "Packet unlocked and added to your calendar". After Decline: muted card "Declined. The producer has been told so they can pick the next candidate."
   - Upload due: "Upload due in {n} hours" in `attention`, event · deliverable, chevron, links to Uploads.
   - Also changes requested and expiring documents, same pattern.
4. Upcoming list: date block (Montserrat 11 weekday, Cinzel 20 day), event title, role · venue, status on the right (positive "Confirmed", attention "Confirm by 9 PM").
5. Tab bar, Home active.

Data: next confirmed assignment; assignments in `selected`, `changes_requested`, uploads due; upcoming assignments for 30 days.

### 4.2 Job board: `app/(tabs)/jobs/index.tsx` · prototype `JobBoard.dc.html`

1. Title "Open calls"; subtitle "{n} jobs match your area, gear and documents".
2. Filter pills: All, This week, Video, Photo (single select).
3. Job cards (radius 16): role eyebrow + rate (Cinzel 18) on one line; event title Lato 17/700; date · hours · area (neighborhood only); gear chips; interest deadline (attention when under 48 hours, muted otherwise). Whole card links to the detail.
4. Only open-call slots the contractor is eligible for (coverage area, required gear, compliance docs complete). Never show the exact address or client here.

### 4.3 Open call detail: `app/jobs/[slotId].tsx` · prototype `JobDetail.dc.html`

1. BackLink "Open calls".
2. Eyebrow "{role} · 1 of {crewSize} crew"; title Cinzel 28.
3. 2x2 FactTiles: Date, Hours, Area (with distance), Rate.
4. "Gear needed" rows: requirement left; "You have: {item}" or "You have it" in `positive`, or "Missing" in `attention`.
5. LockNotice: "Exact address, client contact, creative brief and shot list unlock when you're confirmed."
6. Optional note textarea (label "Note to the producer (optional)").
7. BottomActionBar: "I'm interested" + "Interest closes {deadline}". After tapping: "Interest sent" with check, "You'll hear whether you're selected by {date}. Nothing is booked until you confirm.", Withdraw interest (secondary).

### 4.4 Event packet: `app/events/[eventId]/index.tsx` · prototype `Packet.dc.html`

Visible only to contractors confirmed on a slot of this event (enforced by RLS, see PRD). Cache the whole packet for offline use at confirmation.

1. BackLink "Home"; "Saved for offline" with check on the right (show only when the cache is current).
2. Eyebrow "{when} · {role}"; title Cinzel 28; "Call {time} · Wrap {time} · {Confirmed|On site}".
3. Check-in card: Check in (primary, 52px). After: positive panel "Checked in at {time}". "Running late" (secondary) until checked in; after tapping: "ETA of {n} minutes sent to {producer} (producer) and {contact} (on site)" in `attention`. Check-in records location; outside the venue radius, still allow it and flag it to the producer.
4. Sections in order, each with an Eyebrow head: Location (venue card + "Open in Maps" tonal button) · Arrival and parking (paragraph) · Dress code · Client contact (name, title, call and text RoundIconButtons) · Creative brief (file row with page count + 3 key bullets) · Shot list link card ("{n} shots · {m} must-have") · Your deliverables (rows with due times) · Crew tonight (name, role) · Emergency contacts (rows with "Call" in `label`).
5. BottomActionBar: "Upload footage" (primary, upload icon).

### 4.5 Shot list: `app/events/[eventId]/shots.tsx` · prototype `ShotList.dc.html`

1. BackLink "Event packet"; title "Shot list".
2. Progress line: "{done} of {total} shots" left, "{mustDone} of {mustTotal} must-haves" right (`attention` until complete, then `positive`); ProgressBar.
3. "Must-have" eyebrow (`attention`), then must-have items as bordered cards; "Also get" eyebrow, then other items with a lighter border and transparent fill.
4. Item: ShotCheckbox + title (Lato 15/700; checked: strikethrough, `textMuted`) + hint (Lato 12 `textMuted`). Whole row toggles. Writes to `shot_checks` and syncs live to the producer via Realtime; works offline and syncs later.
5. BottomActionBar: note "{n} must-haves left. Capture or mark not possible before check out." in `attention`, or "All must-haves captured" in `positive`; Check out button disabled until every must-have is captured or marked "not possible" with a reason (add the not-possible action as a long-press or swipe; it isn't in the prototype).

### 4.6 Upload center: `app/(tabs)/uploads.tsx` · prototype `Upload.dc.html`

1. Title "Uploads".
2. Active upload card per event: event name; lock icon + "Goes to: {client} / {date} {event} / {role}, {contractor} / raw" (the destination is never chosen by the user); "{sent} of {total} GB" and ETA; ProgressBar (paused fill `checkboxBorder`); Pause/Resume and Add files (secondary pair); "Wi-Fi only" switch; file rows (monospace name, size, status: done `positive`, percent `textSecondary`, queued `textMuted`, "+ n more files"); "Mark upload complete" disabled until every file has landed; helper "Big card dump? Use the desktop uploader on your computer."
3. Due-upload cards for other events: "Due in {n} hours" in `attention`, event · deliverable, "Not started".
4. The progress shown must come from the native background upload module, not from JS timers.

### 4.7 Profile: `app/(tabs)/profile/index.tsx` · prototype `Profile.dc.html`

1. Header: photo 72px circle (initials fallback), name Cinzel 24, "{skills} · {city}", Edit (secondary, 40px).
2. "Ready to work" card: Stripe payouts, Contractor agreement, Insurance certificate, each with status (`positive` Ready/Signed, `attention` "Expires {date}" within 60 days, `attention` "Missing").
3. Contact, Skills (chips), Gear (rows: Camera bodies, Lenses, Audio, Lighting, Support), Coverage area ("Based in {city} · travels up to {n} miles").
4. Availability: month grid starting Sunday, CalendarDay cells; tap toggles available/unavailable; booked days are not toggleable; legend: Booked, Available, Unavailable. Writes to `availability`.
5. Link card "Earnings and tax forms".

### 4.8 Earnings: `app/(tabs)/profile/earnings.tsx` · prototype `Earnings.dc.html`

1. BackLink "Profile"; title "Earnings"; "Paid in {year}" + total (Cinzel 40).
2. Payout rows: event, sub-line, amount, status (Upcoming `textMuted`, On the way `label`, Paid `positive`, Failed `attention`).
3. Card "Bank details and tax forms": "Managed securely by Stripe. Your {year} 1099-NEC will be there in January." + "Open Stripe Express" (primary) opening a Stripe Express login link from an Edge Function.

## 5. Admin console screens

Next.js App Router. All pages use `AppShell`. Pages are fluid (no fixed widths), and tables scroll horizontally inside their own box.

### 5.1 Operations board: `app/(admin)/board/page.tsx` · prototype `AdminBoard.dc.html`

1. PageHeader "Operations board", subtitle "{date} · {n} active events"; Producer filter select; New event (admin primary).
2. AttentionStrip: "{n} need attention" + tags (not checked in at call time: danger; selection unconfirmed; upload overdue: warn).
3. Kanban columns: Draft, Staffing, Staffed, In progress, Uploaded, Complete, with counts. EventCard content by column:
   - Draft: date · slot count; missing pieces ("Brief missing").
   - Staffing: "{confirmed} of {total} confirmed"; "{n} interested in {role} · review" (actionable, links to staffing) or selection pending.
   - Staffed: confirmed count.
   - In progress: "{n} of {m} checked in", "Shot list {done} of {total}" (Realtime).
   - Uploaded: uploads count; "{role} ready for review" (actionable, links to review); overdue count.
   - Complete: date · paid.

### 5.2 Staffing: `app/(admin)/events/[eventId]/staffing/page.tsx` · prototype `AdminStaffing.dc.html`

1. "Back to board" link; event title (Cinzel 28); date · hours · venue · producer.
2. Slot cards grid (auto-fit, min 220): role · rate, staffing mode and deadline, status line (confirmed `positive`, invited with expiry `warnText`, open call count `label`).
3. StatusBanner after selecting: "{name} selected. Confirm request sent, due in 12 hours. The other {n} hear the slot is filled once {firstName} confirms." + Undo.
4. CandidateTable "{n} interested in {role}", subtitle "Ranked by distance, gear, availability, reliability and history with this client". Select button per row (admin primary); after selection the chosen row shows "Selected" (`positive` fill) and the others go quiet.

### 5.3 Review: `app/(admin)/events/[eventId]/review/[assignmentId]/page.tsx` · prototype `AdminReview.dc.html`

1. Two-column wrap layout: main (flex 999 1 520px) and decision panel (flex 1 1 320px).
2. Main: back link; "{event} · {role}" title; contractor · shot date · uploaded time · file count and size; preview grid (4 columns, 3:2 thumbnails from generated previews, last tile "+ {n} more"); Deliverables card rows with delivered counts in `positive` and the must-have shot result.
3. Decision panel: "Rate this job" with RatingButtons for Quality, Punctuality, Communication; Approve all deliverables (admin primary); "Or ask for changes" textarea; Request changes (secondary). After approve: positive banner "Approved. A ${amount} payout is queued for owner approval, and {firstName} has been notified." After request: warn banner. Undo while still reversible.

### 5.4 Admin pages not in the prototype

Contractors, Payouts, Announcements, Settings and the Event builder appear in the sidebar but were not drawn. Build them from the components above and the PRD sections "Admin console", "Payments" and "Notifications". Keep the same patterns: PageHeader, white bordered cards on cream, tables in scroll boxes, status tags in the admin status colors.

## 6. Acceptance checklist

- [ ] Every color, font and radius comes from `tokens.ts`; no raw hex in components.
- [ ] Each built screen matches its prototype file side by side at 390px wide (mobile) and 1440px wide (admin), including copy.
- [ ] Every interaction in the prototype's `renderVals()` works against real data and survives an app restart.
- [ ] Event packet, client contact and shot list are unreadable through the API for contractors who are not confirmed (RLS test exists).
- [ ] Event packet and shot list work in airplane mode after first load.
- [ ] Loading, empty and error states exist for every screen.
- [ ] Touch targets are at least 44px; VoiceOver and TalkBack read every button with a clear label.
- [ ] Admin pages work at 1024px and stack cleanly at phone width.
