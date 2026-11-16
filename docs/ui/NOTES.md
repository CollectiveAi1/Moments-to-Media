# Notes on the UI kit

`UI-SPEC.md` and `prototype/` are kept exactly as handed over on 2026-11-16.
This file is where the repo's side of it goes: what was checked, where the
spec and the PRD disagree, and what the screens need that does not exist yet.

## How the kit was landed

- `docs/ui/UI-SPEC.md`, `docs/ui/prototype/*` and `assets/brand/*` are
  byte-for-byte what was in `m2m-ui-handoff.zip`.
- The prototype files reference `./support.js` and two `/_blob/…` image
  sources. Neither is in the kit and neither should be: the spec says not to
  load the canvas runtime, and the two images are the logos in `assets/brand`.
  The files are a reference to read, not pages to serve.
- `packages/shared/src/tokens.ts` now holds the spec's full token set. The
  hex values agree with the list in `CLAUDE.md`; the **names** changed
  (`background` → `bg`, `chip` → `surfaceAlt`, `adminAccent` → `label`,
  `progressFill` → `done`, and so on) and the set grew: `radius`, `space`,
  the admin status colours. Nothing imported the old names.

## Where the spec and the PRD disagree

The PRD wins (`CLAUDE.md`), so these are flagged rather than built as drawn.

1. **Candidate ranking.** Staffing (5.2) says candidates are "Ranked by
   distance, gear, availability, reliability and history with this client".
   The PRD's scope table puts ranking by area, gear and availability in the
   MVP and "Ratings and reliability score in ranking" in v1.1. Build the MVP
   ranking and change the subtitle to match what it actually ranks by; the
   Reliability column can still be shown.
2. **Video previews.** Review (5.3) draws a grid of 3:2 thumbnails "from
   generated previews". The PRD has thumbnails queued at upload completion in
   the MVP and video previews in v1.1. Stills only at first.

## What the screens need that is not built

| Screen | Needs | State |
| --- | --- | --- |
| Staffing 5.2 | A match score per candidate | The inputs exist (home base coordinates, a haversine helper, `equipment`, `availability`, `ratings`). No function computes or orders by it. |
| Review 5.3 | Thumbnails | `uploads.preview_key` exists. Nothing generates a preview: no job, no queue consumer. |
| Event packet 4.4 | "Running late" ETA sent to the producer and the on-site contact | No column or function. Likely a notification with a payload rather than a column. |
| Earnings 4.8 | A Stripe Express login link | Needs an Edge Function. Stripe Connect is not started. |
| Upload center 4.6 | Progress from a native background upload module | The server side is proven at 20 MiB (`docs/upload-proof.md`). The Expo native module does not exist. |
| Upload center 4.6 | CRC-64/NVME per part and per file on the device | `packages/shared` has a correct implementation; in JS it runs at roughly 20 MiB/s, so the native module has to compute it. |
| Admin 5.4 | Contractors, Payouts, Announcements, Settings, Event builder | Not drawn. Built from the shared components and the PRD. |

What is already there and matches the spec: check-in coordinates and a
per-event `check_in_radius_m`, `shot_checks.outcome = 'not_possible'` with a
required reason, the `selected → confirmed` confirm request, `availability`,
`compliance_documents`, and visibility rules that keep the address, client
contact, brief and shot list from an unconfirmed contractor in the database
rather than in the UI.

## Blockers that are not code

- **Vector logos.** The monogram is 288 px. An app icon needs a 1024 × 1024
  master and the splash needs a high-resolution version. Ask Moments to Media
  for SVG or PDF originals before the first TestFlight build (spec section 2).
## Built so far

| Screen | State |
| --- | --- |
| Admin sign-in | Built. Emailed link, no password. |
| Operations board 5.1 | Built against live data, with loading, empty and error states. Cards that need the producer are highlighted but are not links yet, because the Staffing and Review pages they open do not exist. "New event" is disabled until the event builder exists. No Realtime yet: the board is current as of the last page load. |
| Everything else | Not built. |

Where the built board differs from the drawing, on purpose:

- The Producer select is 44px tall, not 40. The spec's own rule that touch
  targets are at least 44px wins over the prototype's inline height.
- A staffing card can show two lines rather than one, when two different slots
  each need something.
- "Active events" in the header does not count completed events.
