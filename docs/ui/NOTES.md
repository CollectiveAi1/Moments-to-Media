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

Every screen in the spec, against live data, with loading, empty and error
states. QA: `scripts/qa/pass.sh` (typecheck, lint, unit tests, build, and a
52-step end-to-end run of one event's whole life as three real signed-in roles).

| Area | Screens |
| --- | --- |
| Admin | Sign-in · Board · Events (list, builder, event page: details, slots, brief, deliverables, shot list, contacts, client, history, status moves) · Staffing (index, per-event with ranked candidates, invite, select, pass, expire, cancel) · Contractors (roster, invitations, contractor page with document review) · Footage and review (queue, library, review with ratings, approve, request changes) · Payouts · Announcements · Settings |
| Contractor | Home · Jobs · Open call detail · Event packet (check-in with location, running late) · Shot list · Uploads (browser upload straight to R2) · Profile (contact, skills, coverage, gear, availability calendar, documents) · Earnings |

The contractor app is a phone-width web view in the same Next.js app, at
`/app`. **This is in addition to the native Expo app, not instead of it**:
background uploads of whole cards need the native module, so the locked
decision stands. The web view lets a contractor do everything else from any
phone today. Someone who is both owner and contractor switches with the
"Contractor view" link in the sidebar.

### What does not work yet, and why

- **Uploading from a browser needs one bucket setting.** The R2 bucket has no
  CORS rule, so browsers are refused before the first byte. The upload
  credentials cannot change bucket settings (by design: they are object-only),
  so it is a dashboard step: R2 → `moments-to-media-footage` → Settings → CORS
  policy, allowing PUT and GET from the app's origins, the
  `x-amz-checksum-crc64nvme` and `content-type` headers, and exposing `ETag`.
  The uploader says exactly this if it happens.
- **Stripe Connect is not connected.** Payouts move through every state; the
  owner records Sent and Paid by hand. "Open Stripe Express" is disabled.
- **Notifications are not fanned out.** Running late and off-site check-ins
  reach the producer on the board; nothing is pushed or texted, and
  announcements are read on the contractor's home screen rather than sent.
- **No video previews** (PRD v1.1); review lists files with downloads.
- **Offline packet cache** and **Realtime** are not built; the board and shot
  list refresh every 20–30 seconds instead.
- **Producers cannot read organization settings** (owner-only by RLS), so for
  a producer the required-documents check in candidate ranking assumes none.

### Where the built board differs from the drawing, on purpose

- The Producer select is 44px tall, not 40. The spec's own rule that touch
  targets are at least 44px wins over the prototype's inline height.
- A staffing card can show two lines rather than one, when two different slots
  each need something.
- "Active events" in the header does not count completed events.
- Selecting a candidate has no Undo: the assignment state machine has no move
  from `selected` back to `interested`. "Expire selection" reopens the slot.
- A selected contractor cannot Decline in the app (the state machine allows
  only confirm or expire from `selected`); the screen says to tell the
  producer instead.

## Contractor web view on a desktop

UI-SPEC draws the contractor screens at phone width only. On screens 960px and wider the web view now uses a side navigation (Home, Jobs, Uploads, Profile, Earnings, admin console, sign out) instead of the bottom tab bar, a page up to 1200px wide, two columns on Home, the job detail, the event packet, the shot list, Profile and Earnings, and a card grid for Jobs and Uploads. The bottom action bar becomes a card at the top of the side column. Below 960px nothing changes: the column wrappers are `display: contents`, so the phone order and the pinned action bar are as the spec draws them. The classes live in `apps/admin/app/(contractor)/layout.tsx`.
