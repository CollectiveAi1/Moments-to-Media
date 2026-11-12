# Moments to Media — Contractor Ops App PRD

Nov 12, 2026 · @Devon Scott

## Summary

Moments to Media gets one native app that runs its contractor operation end to end: staff an event, brief the crew, shoot from a complete event packet, upload footage, review deliverables and pay contractors. Contractors get one place for everything they need on a job. Admins run staffing, status, footage and payouts from a single web console.

The app ships to Moments to Media as an internal tool first. It is built multi-tenant so Moments to Media can later sell it to other media companies without a rebuild.

### Decisions locked

| Decision | Choice | What it means for the build |
| --- | --- | --- |
| Ownership | Moments to Media owns the app and IP after handoff | Repo, cloud, app store and Stripe accounts are opened in the client's name from day one, so handoff is a credentials transfer, not a migration |
| Tenancy | Multi-tenant | Every row carries an organization id; row-level security isolates tenants; branding, storage and Stripe settings are per organization |
| Platform | Native | iOS and Android contractor app plus a web admin console |
| Footage | Hosted by the app, with connectors | Footage lands in storage the app controls; per-organization connectors push copies to Google Drive, Dropbox or Frame.io |
| Payments | In-app through Stripe | Contractors onboard as Stripe connected accounts; Moments to Media pays per completed assignment from inside the app; in-app payments stay off for any other organization |

### Goals

1. A contractor can go from notification to fully briefed on an event in under one minute, with no texts or emails needed.
2. An admin can staff a multi-person event from post to confirmed crew in one sitting.
3. Every assignment closes with footage in the right folder, deliverables approved and the contractor paid, all tracked in the app.

### Not in v1

- A client-facing portal (the data model leaves room for it; see Scope)
- Editing and post-production workflow
- Payroll for W-2 employees

## Users and roles

Three roles ship in v1. A fourth, Client, is modeled in the schema but has no screens until the client portal ships.

| Role | Who | Uses | Can do |
| --- | --- | --- | --- |
| Owner | Moments to Media leadership | Web console | Everything: org settings, billing, Stripe, connectors, manage admins, approve payouts |
| Producer | Staff who run events | Web console + mobile app | Create and staff events they own, write briefs and shot lists, review footage and deliverables, request payouts for owner approval |
| Contractor | Freelance shooters, editors, drone ops | Mobile app | Manage profile and availability, browse and opt into jobs, accept invites, see full event packets once confirmed, check in, complete shot lists, upload footage, get paid |
| Client (v2) | Moments to Media's customers | Client portal | View their own events, approve deliverables, download final files |

A person can hold different roles in different organizations. A contractor who works for two media companies on the platform uses one login and switches between organizations.

## Core workflows

Four workflows carry the product: staffing, event day, upload and delivery, and payout. The status lifecycle diagram below shows how they move an event and each contractor through their states.

### Staffing

An event is made of role slots (for example Lead video x1, Photo x2, Drone x1). Each slot has its own rate, call time, required gear and staffing mode, so one event can mix invited and open-call slots.

1. Producer creates the event, attaches the brief and shot list, and adds role slots.
2. For each slot, the producer picks a staffing mode:
   1. Direct invite: one or more named contractors, ranked by match score. Invites expire after a set window (default 24 hours).
   2. Open call: the slot appears on the job board to eligible contractors only (inside coverage area, owns required gear, compliance docs complete). Contractors tap "I'm interested" and can add a note. Interest closes at a deadline or when the producer closes it.
3. Producer reviews everyone who opted in, ranked by match score: distance, gear match, availability, reliability score, past work with this client.
4. Producer selects. The selected contractor gets a confirm request with a deadline (default 12 hours). Selected is not committed until they confirm.
5. On confirm, the slot locks, the full event packet unlocks for that contractor, the event lands on their calendar, and everyone else who opted in is told automatically that the slot is filled.
6. If the deadline passes without a confirm, the slot returns to the producer with the next-ranked candidate suggested.
7. The event moves to Staffed when every required slot is confirmed.

### Event day

1. Reminders go out 24 hours and 2 hours before call time, with address, parking and call time in the notification itself.
2. The full packet is cached on the device at confirmation, so it opens with no signal.
3. Contractor taps Check in at the venue. Location is recorded; a check-in outside the venue radius is flagged to the producer. The first check-in moves the event to In Progress.
4. A Running late button sends an ETA to the producer and the on-site client contact.
5. The shot list is a live checklist. Must-have shots are marked, and the producer sees progress in real time.
6. Check out asks the contractor to resolve any unchecked must-have shot: capture it, or mark it not possible with a reason.
7. One tap calls or texts the on-site contact, the producer or the event's emergency contacts.

### Upload and delivery

1. The Upload button opens with the destination already set: organization, client, event, role, contractor. Contractors never pick a folder.
2. On the phone, contractors pick clips from the camera roll or files. Uploads run in the background, resume after dropped connections, and can be held for Wi-Fi.
3. For card dumps, a web uploader on desktop takes whole folders with the same resumable engine.
4. Contractor taps Mark upload complete. The slot moves to Uploaded and the producer is notified.
5. Producer reviews against the deliverables list and either approves or requests changes with notes. Changes loop back to the contractor.
6. When every deliverable on a slot is approved, the slot moves to Approved and a payout is queued.
7. Connectors copy footage to the organization's Google Drive, Dropbox or Frame.io according to its rules.

### Payout

1. The rate is fixed on the slot when the contractor confirms: flat, or hourly with an overtime rule.
2. On approval, a payout line is created from the base rate plus adjustments: overtime from check-in and check-out times, and expenses with receipts.
3. The producer submits the payout; the owner approves it, or it auto-approves under a threshold the owner sets.
4. The app sends a Stripe transfer to the contractor's connected account. The contractor sees each payout's status in the app.
5. At year end, 1099-NEC forms are filed and delivered through Stripe.

## Status lifecycles

Status lives at two levels. The event status is what the client's brief asked for and what the operations board shows. Each contractor's status on a slot drives notifications, access and pay.

### Event

The client's five statuses map onto the event lifecycle, with Draft and Cancelled added.

| Event status | Client's term | Enters when |
| --- | --- | --- |
| Draft | — | Event created; not visible to contractors |
| Staffing | Pending | Any slot is invited or posted as an open call |
| Staffed | Accepted | Every required slot has a confirmed contractor |
| In Progress | In Progress | First crew check-in on event day |
| Uploaded | Uploaded | Every slot has marked its upload complete |
| Complete | Complete | Every deliverable is approved |
| Cancelled | — | Producer cancels before In Progress; everyone confirmed or opted in is notified |

### Contractor on a slot

&#91;embedded content: contractor-on-slot lifecycle · 9 states, 4 exits\]

A contractor enters by invite or by opting in, and only a confirm commits them. An expired confirm returns the slot to the producer with the next-ranked candidate suggested. The review loop between Uploaded and Changes requested repeats until every deliverable is approved.

## Contractor app

The contractor app opens on what needs doing next, not a menu. Everything else is one tap away.

| Screen | What it does | Key details |
| --- | --- | --- |
| Home | Next assignment and anything waiting on the contractor | Next-event card with countdown, call time, address and a Check in button that appears inside the check-in window. Action strip: confirm requests, invites, uploads due, changes requested |
| Job board | Open calls the contractor is eligible for | Card shows role, date, area (neighborhood, not exact address), rate, gear needed and interest deadline. I'm interested with optional note; withdraw anytime before selection |
| Invites | Direct invites | Accept or decline with a reason; shows expiry countdown |
| Event packet | Everything needed to cover the event, unlocked on confirm, cached offline | Overview (date, call and wrap time, address with maps link) · Arrival and parking (instructions, entrance photos) · Dress code · Client contact (call, text) · Creative brief (PDF and image viewer) · Shot list · Deliverables (specs and due dates) · Crew on this event · Emergency contacts · Upload |
| Shot list | Live checklist | Must-haves pinned on top, check off with optional reference photo, "not possible" requires a reason |
| Upload center | Every upload in flight and done | Per-file progress, pause and resume, Wi-Fi-only toggle, retry, upload history per event |
| Calendar and availability | When the contractor can work | Month view of booked events; mark available or unavailable by day; recurring weekly pattern; blackout ranges; subscribe link for Google or Apple Calendar |
| Profile | What admins match on | Photo, name, phone, email, bio, portfolio links; skills (video, photo, drone, audio, editing); camera bodies, lenses, audio, lighting, drone kit; coverage area as home base plus travel radius; default rate |
| Documents | Compliance status | Contractor agreement (e-sign), NDAs per client, insurance certificate with expiry, drone certification where relevant; tax info collected by Stripe |
| Earnings | Getting paid | Payout list with status, year-to-date total, link to Stripe Express for bank details and tax forms |
| Inbox | Announcements and notifications | Organization announcements, assignment updates; pinned announcements stay on top |
| Settings | Preferences | Notification channels per type, organization switcher, sign out |

Details stay locked until confirmation. Before confirm, a contractor never sees the client's contact, the exact address or the brief.

## Admin console

The admin console is a web app built around one board of every event by status, so a producer sees what is stuck at a glance.

| Area | What it does | Key details |
| --- | --- | --- |
| Operations board | Every event as a card in its status column | Filters by date, producer, client, status; red flags for unfilled slots inside 72 hours, unconfirmed selections, late uploads, overdue deliverables |
| Event builder | Create and edit events | Date, call and wrap time, venue with map pin and check-in radius, client and on-site contact, arrival and parking, dress code, emergency contacts, notes. Duplicate an event or save as template |
| Briefs and shot lists | Creative direction | Upload PDFs and images or write in the editor; shot list builder with must-have flags and reference images; reusable shot list templates per event type |
| Deliverables | What must come back | Per slot: item, format, resolution, frame rate, due date (for example "40 edited photos, JPEG, 48 hours") |
| Staffing | Fill role slots | Per slot: direct invite or open call; ranked candidate list with match score and why (distance, gear, reliability, history with client); availability conflicts shown before inviting; one-click select; bulk invite |
| Contractor directory | Everyone on the roster | Search and filter by skill, gear, camera type, coverage area, availability on a date, reliability score, compliance status; full profile with job history and ratings |
| Availability view | Who is free when | Calendar grid of contractors by day; booked, available, unavailable |
| Footage library | Everything uploaded | Browse by client, event, contractor; video and photo previews; download single files or whole folders; share link with expiry; connector sync status |
| Review | Approve deliverables | Side-by-side with the deliverables list; approve or request changes with notes; rate the contractor (quality, punctuality, communication) |
| Payouts | Pay contractors | Queue of approved slots with computed amount; adjust with reason; approve singly or in batch; owner approval threshold; payout history and export |
| Announcements | Talk to the roster | Send to all, by skill, by coverage area, or to one event's crew; push plus inbox, optional SMS; pin and schedule |
| Settings | Organization setup | Branding, roles and admins, Stripe account, connectors, default rates, reminder timing, required compliance documents |
| Activity log | Who did what | Every status change, selection, payout and file action with actor and time |

## Footage pipeline

Footage goes straight from the contractor's device to object storage in parallel chunks, and never passes through the app's servers. Storage is Cloudflare R2, chosen because footage is downloaded many times (review, editors, connector sync, client delivery), and R2 charges [no egress fees](https://www.cloudflare.com/products/r2/).

### Why R2 over S3 or Supabase Storage

| Option | Storage | Egress | Fit |
| --- | --- | --- | --- |
| [Cloudflare R2](https://developers.cloudflare.com:2053/r2/pricing) | $0.015 per GB-month (Infrequent Access $0.01) | Free | Best for footage that is read often; S3-compatible multipart API |
| AWS S3 Standard | $0.023 per GB-month | About $0.09 per GB after the free tier ([source](https://upstash.com/kb/cloudflare-r2-pricing-in-2026-storage-operations-and-real-monthly-bills)) | Egress becomes the biggest line once footage is reviewed and synced |
| [Supabase Storage](https://supabase.com/blog/storage-500gb-uploads-cheaper-egress-pricing) | Plan-based | Cached egress $0.03 per GB | Used for small files only: profile photos, briefs, receipts, documents |

At 10 TB of footage stored, R2 runs about $150 a month with nothing charged for downloads.

### How an upload works

1. The app asks the backend to start an upload for a slot. The backend checks that the contractor is confirmed on that slot, opens a multipart upload on R2 and returns signed URLs for the parts.
2. A native upload module sends the parts in parallel in the background, retries failed parts and saves its state so it resumes after the app is closed. Expo published this pattern for [Boom's video uploads](https://expo.dev/blog/faster-more-reliable-video-uploads-with-expo-modules): median upload time fell about 20% for 100 to 300 MB clips, with no stuck uploads in testing.
3. When the last part lands, the backend completes the upload, checks size and checksum, records the file and queues a low-resolution preview and thumbnail.
4. Card dumps go through a desktop web uploader that uses the same multipart flow and takes whole folders.

The app shows estimated time before a large upload starts and recommends Wi-Fi or the desktop uploader for big card dumps. Pushing hundreds of GB over a venue's cell connection is not realistic and the product should say so.

### Folder structure

Every file lands at a path the contractor never has to choose:

```
/{organization}/{client}/{YYYY-MM-DD}_{event}/{role}_{contractor}/{raw | selects | deliverables}/{original filename}
```

Original filenames are kept; name collisions get a numeric suffix.

### Connectors

Each organization sets rules for copying footage out to Google Drive, Dropbox or Frame.io:

- What: raw footage, approved deliverables, or both
- When: on upload complete or on approval
- Where: a root folder in the connected account, mirroring the path above

Sync runs as a background job with retries. Its status shows per file in the footage library. Connector credentials are stored encrypted per organization.

### Retention and access

- Buckets are private. Downloads use signed URLs that expire in minutes.
- Contractors see only their own uploads. Share links expire on a date the producer sets.
- Originals move to Infrequent Access after a period the organization sets. Infrequent Access has a 30-day minimum and a $0.01 per GB retrieval fee, so the default should be 90 days after event completion.

## Payments

Contractors onboard as Stripe Connect Express accounts, and Moments to Media's Stripe account pays each approved slot by transfer. Stripe hosts identity checks, bank details and tax information, so the app never stores bank or tax ID numbers.

### Setup

- Moments to Media's Stripe account is the Connect platform. It is opened in the client's name from day one.
- Contractors start Stripe onboarding from the Documents screen. They can opt into jobs before finishing, but cannot confirm a slot until onboarding is complete.
- The platform balance is funded by bank transfer. Each approved payout is a transfer to the contractor's connected account, then paid to their bank on Stripe's schedule.

### Payout states

| State | Meaning | Who moves it |
| --- | --- | --- |
| Draft | Created when a slot is approved; amount computed | System |
| Submitted | Producer has checked adjustments | Producer |
| Approved | Cleared to send | Owner, or auto under the threshold |
| Sent | Transfer created in Stripe | System |
| Paid | Funds reached the contractor's bank | Stripe webhook |
| Failed or reversed | Bank rejected or transfer reversed; owner alerted | Stripe webhook |

### 1099s

With Express accounts, [the platform is responsible for filing and delivering 1099 forms](https://support.stripe.com/questions/1099-forms-for-platforms-and-marketplaces), using Stripe's Connect tax reporting product. Stripe recommends e-filing by January 22 so forms are postmarked by the [January 31 IRS deadline](https://docs.stripe.com/docs/connect/get-started-tax-reporting). Contractors who consent to e-delivery get their forms in the [Stripe Express Dashboard](https://docs.stripe.com/connect/deliver-tax-forms); others get them by mail. The app sends the owner a checklist reminder in early January.

### Open items

- Current Stripe Connect fees for active accounts and payouts need to be confirmed and priced into the client's budget.
- In-app payments are a per-organization setting, switched on for Moments to Media only. Any other organization that uses the app pays its contractors outside it, so the app never holds funds for another company.

## Notifications

Push is the default channel. Anything that can cost a shoot also goes by SMS, because push alone gets missed. Every notification also lands in the in-app inbox.

| Trigger | Recipient | Push | SMS | Email |
| --- | --- | --- | --- | --- |
| Direct invite sent | Invited contractor | Yes | Yes | Yes |
| New open call matching profile | Eligible contractors | Yes | No | Daily digest |
| Selected, confirm needed | Selected contractor | Yes | Yes | Yes |
| Confirm deadline in 2 hours | Selected contractor | Yes | Yes | No |
| Slot filled | Everyone else who opted in | Yes | No | No |
| Selection expired, next candidate suggested | Producer | Yes | No | Yes |
| Event details changed after confirm | Confirmed crew | Yes | Yes | Yes |
| Event cancelled | Confirmed crew and anyone opted in | Yes | Yes | Yes |
| Reminder 24 hours and 2 hours before call | Confirmed crew | Yes | 2-hour only | No |
| Crew member not checked in at call time | Producer | Yes | Yes | No |
| Running late | Producer, on-site contact | Yes | Yes | No |
| Upload complete | Producer | Yes | No | No |
| Deliverable due in 24 hours | Contractor | Yes | No | No |
| Changes requested | Contractor | Yes | No | Yes |
| Approved | Contractor | Yes | No | No |
| Payout sent or failed | Contractor; owner on failure | Yes | No | Yes |
| Compliance document expiring in 30 days | Contractor, owner | Yes | No | Yes |
| Announcement | Targeted contractors | Yes | Optional | Optional |

Contractors can turn off any non-critical type. Critical types (confirm needed, details changed, cancelled, 2-hour reminder) cannot be muted while the contractor is confirmed on an event.

## Permissions and data visibility

What a contractor can see depends on where they stand on a slot, not just their role. Rules are enforced in the database with row-level security, never only in the app.

| Data | Owner | Producer | Contractor, not on slot | Contractor, opted in or invited | Contractor, confirmed |
| --- | --- | --- | --- | --- | --- |
| Event date, area, role, rate, gear needed | All | All | If eligible for an open call | Yes | Yes |
| Exact address, arrival and parking | All | All | No | No | Yes |
| Client and on-site contact | All | All | No | No | Yes |
| Creative brief, shot list, deliverables | All | All | No | Summary line only | Yes |
| Other crew on the event | All | All | No | No | Names, roles, phone |
| Emergency contacts | All | All | No | No | Yes |
| Footage | All | Own events | No | No | Own uploads only |
| Contractor profiles | All | All | Own only | Own only | Own only |
| Ratings and reliability score | All | All | No | No | No |
| Payouts | All | Own events | Own only | Own only | Own only |
| Organization settings, Stripe, connectors | Yes | No | No | No | No |

Access to the full packet ends 7 days after the event completes, except the contractor's own uploads and payout records. Every read of client contact details and every footage download is written to the activity log.

## Data model

The core is Event → Slot → Assignment: an event has role slots, and each contractor's relationship to a slot is one assignment row with its own status. Every organization-scoped table carries `org_id`, and row-level security filters on it.

| Table | Belongs to | Key fields |
| --- | --- | --- |
| `organizations` | — | name, slug, branding, stripe\_account\_id, settings (reminder timing, payout threshold, retention days) |
| `memberships` | organization, user | role (owner, producer, contractor, client), status |
| `profiles` | user | full name, phone, email, photo, bio, portfolio links |
| `contractor_details` | user | skills, home base (geo point), travel radius in miles, default rate |
| `equipment` | user | category (camera body, lens, audio, lighting, drone, other), make, model |
| `availability` | user | date range, available or unavailable, optional weekly recurrence |
| `compliance_documents` | organization, user | type, status, file, expires\_on |
| `clients`, `client_contacts` | organization | name; contact name, phone, email |
| `events` | organization, client | producer, title, start and end (with time zone), venue, address, geo point, check-in radius, arrival and parking, dress code, status |
| `event_contacts` | event | kind (on-site, emergency), name, phone |
| `briefs` | event | body, attachments |
| `slots` | event | role, rate type and amount in cents, overtime rule, call time, required gear, staffing mode, interest deadline, status |
| `assignments` | slot, user | status, note, confirm deadline, check-in and check-out time and location |
| `shot_list_items` | event, optional slot | title, description, must-have, reference image, order |
| `shot_checks` | shot item, assignment | captured or not possible, reason, photo |
| `deliverables` | slot | title, spec (format, resolution, frame rate), due date |
| `deliverable_reviews` | deliverable, assignment | approved or changes requested, notes, reviewer |
| `uploads` | assignment | storage key, filename, bytes, checksum, multipart id, status, preview key |
| `connector_accounts`, `connector_rules`, `sync_jobs` | organization, upload | provider, encrypted token, root folder; what and when; status, attempts, error |
| `payouts` | organization, assignment | amount in cents, adjustments, status, Stripe transfer id |
| `ratings` | assignment | quality, punctuality, communication (1 to 5), notes |
| `announcements`, `notifications` | organization, user | audience, body, pinned, schedule; type, channels, read time |
| `activity_log` | organization | actor, entity, action, change, time |

Conventions: money in integer cents, times as UTC timestamps with the event's time zone stored, every foreign key indexed, schema changes only through tracked migrations. A future `client` role reads `events`, `deliverables` and approved `uploads` for its own client id, which is why client contacts are their own table now.

## Architecture and stack

Two clients share one Supabase backend. Footage is the exception: devices send it straight to R2 using upload URLs the backend signs, so video never loads the API.

&#91;embedded content: system architecture · 2 clients, 1 backend, 4 services\]

The desktop uploader in the web app sends footage to R2 the same way as the phone. Stripe webhooks, notifications and connector copies run as background jobs in Supabase.

| Layer | Choice | Why |
| --- | --- | --- |
| Contractor app | Expo (React Native) with a custom native upload module | One codebase for iOS and Android; native code only where it matters, for background uploads |
| Admin console | Next.js on Vercel | Fast to build and ship; server rendering keeps the operations board quick |
| Database and auth | Supabase Postgres and Auth | Row-level security enforces tenant and slot-level access in the database; passwordless sign-in by SMS or email link |
| Live updates | Supabase Realtime | Operations board and shot list progress update without refresh |
| Background jobs | Supabase Edge Functions and a Postgres-backed queue | Webhooks, reminders, connector sync, preview generation, with retries |
| Footage | Cloudflare R2 | S3-compatible multipart uploads; no egress fees |
| Documents and photos | Supabase Storage | Briefs, profile photos, receipts, compliance files |
| Payments | Stripe Connect, Express accounts | Hosted onboarding and tax forms; transfers per approved slot |
| Push and SMS | Expo Push Notifications, Twilio | Push by default; SMS for critical notices |
| Monitoring | Sentry, Supabase logs | Crash and error reporting on both clients; audit trail in the activity log |

## Competitive landscape

None of the tools reviewed covers the full loop for event media crews. Crew tools stop when the shift ends; this app treats a job as done only when footage is in, approved and paid.

| Product | Built for | What it covers | Gap this app fills |
| --- | --- | --- | --- |
| [Worksuite](https://worksuite.com/resources/industries/video-production) | Large media companies (FloSports, ITN, Fubo TV) | Contractor roster, onboarding, contracts, compliance, payments, deadline tracking | Its video production page mentions no mobile crew app and no footage handling; demo-only pricing aimed at enterprise |
| [Rentman](https://rentman.io/products/crew-scheduling-software) | AV and event production teams | Crew database with skills and rates, crew planner, free crew app with job details and confirmations, bulk or first-come invites, time tracking | Pay syncs to accounting software rather than paying out; no footage, brief or shot list handling |
| [LASSO](https://www.lasso.io/articles/manage-labor-processes-crew-todays-gig-economy/) | Event companies with W-2 and 1099 crews | Scheduling, onboarding, travel booking, time tracking, crew payment | Labor-hours focus; nothing on creative direction or media delivery |
| [Crewrig](https://www.capterra.ca/software/1242822/Crewrig) | Film, TV and live event productions | Crew management and scheduling | Listed for Sweden and in Swedish only |

### Positioning

- **Who it is for:** event media companies (photo and video agencies, sports media, corporate event coverage) that run freelance crews and deliver footage to clients. Moments to Media is the first customer and the reference account.
- **The wedge:** creative direction and media delivery are part of the job, not separate tools. Brief, shot list, footage upload, deliverable review and payout live on the same assignment.
- **What compounds:** every job adds reliability, punctuality and shot-list completion data to the contractor record. Over time staffing gets faster and better, which a new competitor starts without.

This review covers the products' own pages as of today. A deeper teardown with hands-on trials of Rentman and Worksuite belongs in the prototype phase.

## Scope and phases

The MVP is everything Moments to Media needs to run real events end to end without another tool. Anything that only gets better with data or more customers waits for v1.1 or v2.

| Area | MVP (pilot) | v1.1 (handoff) | v2 (market) |
| --- | --- | --- | --- |
| Accounts | Auth, organizations, Owner, Producer and Contractor roles | Organization switcher for contractors in several organizations | Self-serve signup and subscription billing for new organizations |
| Contractors | Profile, equipment, coverage area, availability | Calendar subscription, compliance document vault with expiry alerts | Public portfolio pages |
| Events | Event builder, brief and shot list upload, deliverables, role slots | Event and shot list templates, duplicate event | Recurring events |
| Staffing | Direct invite, open call, ranked candidates (area, gear, availability), select and confirm, automatic notices | Ratings and reliability score in ranking | Suggested crew for a new event in one click |
| Event day | Offline packet, reminders, check-in and check-out, running late, live shot list | Check-in radius alerts to producer | — |
| Footage | Background resumable upload, desktop web uploader, footage library, review and approve | Video previews, Google Drive, Dropbox and Frame.io connectors beyond the first | Native desktop uploader for card dumps |
| Payments | Stripe Express onboarding, payout queue with owner approval | Expenses with receipts, overtime from check-in times, 1099 reminder | Payments stay Moments to Media only; other organizations pay outside the app |
| Comms | Push and SMS notifications, announcements | Scheduled and targeted announcements | — |
| Admin | Operations board, activity log | Reporting: fill rate, on-time rate, spend by client | Client portal |

The MVP includes one connector: whichever storage Moments to Media uses today.

### Phases and gates

1. **Contract and accounts.** IP assignment to Moments to Media, scope and payment terms signed; GitHub, Supabase, Cloudflare, Apple, Google Play, Stripe and Twilio accounts opened in the client's name. Gate: signed agreement.
2. **Clickable prototype.** Contractor app and admin console screens for every workflow above. Gate: client signs off on flows and the event packet layout.
3. **Foundation.** Schema, row-level security, auth, organization setup, upload pipeline proven with a 50 GB test upload over a throttled connection. Gate: security review of access rules.
4. **MVP build.** Contractor app, admin console, payments, notifications. Gate: internal test of three mock events end to end.
5. **Pilot.** Moments to Media runs real events on the app alongside its current process. Gate: ten events staffed, shot, uploaded, approved and paid with no fallback to text or email.
6. **v1.1 and handoff.** Gate: documentation, runbook and credentials transferred.

## Success metrics

The pilot succeeds when Moments to Media stops using texts, email threads and shared folders to run events. Baselines get measured from their current process in week one of the pilot.

| Metric | Definition | Pilot target |
| --- | --- | --- |
| Time to staff | Event posted to all slots confirmed | Under 24 hours for events 7 or more days out |
| Fill rate | Slots confirmed by call time / slots posted | 98% |
| Confirm rate | Selected contractors who confirm before the deadline | 90% |
| On-time check-in | Check-ins at or before call time | 95% |
| Must-have shot completion | Must-have shots checked / must-have shots listed | 98% |
| Upload lag | Check-out to upload complete | Under 24 hours median |
| Approval cycle | Upload complete to all deliverables approved | Under 72 hours median |
| Pay cycle | Approval to payout sent | Under 3 business days |
| Off-app fallback | Events where staff had to text or email event details | Zero by pilot end |
| Weekly active contractors | Contractors opening the app at least once a week | 80% of roster |

Targets are starting points to agree with the client, not commitments.

## Risks and open questions

The biggest risk is adoption: if contractors don't open the app, nothing else matters. Getting paid in the app is the strongest pull, so payments ship in the MVP.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Contractors resist another app | Admins fall back to texting; pilot fails | Invite by SMS link with passwordless sign-in; pay only through the app; packet only in the app |
| Large uploads fail at venues | Footage late or lost; trust drops | Background resumable uploads, Wi-Fi hold, desktop uploader, honest time estimates |
| Push notifications missed | No-shows on event day | SMS on every critical notice; producer alerted if crew hasn't checked in at call time |
| App store review delays | Pilot slips | TestFlight and internal testing builds from the foundation phase; account deletion and location-permission wording handled up front |
| Location data concerns | Contractor pushback, privacy exposure | Location captured only on check-in and check-out taps, never tracked in the background; disclosed in onboarding |
| Worker classification | Legal exposure for the client, not the app | The app records instructions the client already gives; the client's counsel should review contractor terms |
| Scope creep before pilot | Pilot slips | MVP list frozen at prototype sign-off; new asks go to v1.1 |
| Footage storage grows | Monthly cost rises | Move originals to Infrequent Access after the retention period; per-organization storage reporting |

### Questions for Moments to Media

- [ ] How many contractors are on the roster today, and how many in 12 months?
- [ ] How many events a month, and how many people on a typical crew?
- [ ] Where does footage live today? This sets the first connector.
- [ ] How are contractors paid now: flat, hourly or day rate; travel and expenses?
- [ ] Which clients require NDAs, and which venues require proof of insurance?
- [ ] Which cities and regions do they cover? Any work outside the US?
- [ ] Who are the owners and who are the producers?
- [ ] What is the app called, and is there a brand guide?
- [ ] What timeline and budget do they expect for the pilot?

## Sources

- [Worksuite: video production](https://worksuite.com/resources/industries/video-production)
- [Rentman: crew scheduling software](https://rentman.io/products/crew-scheduling-software)
- [LASSO: managing crew labor processes](https://www.lasso.io/articles/manage-labor-processes-crew-todays-gig-economy/)
- [Crewrig on Capterra](https://www.capterra.ca/software/1242822/Crewrig)
- [Stripe: 1099 forms for platforms and marketplaces](https://support.stripe.com/questions/1099-forms-for-platforms-and-marketplaces)
- [Stripe: get started with tax reporting](https://docs.stripe.com/docs/connect/get-started-tax-reporting)
- [Stripe: deliver 1099 tax forms](https://docs.stripe.com/connect/deliver-tax-forms)
- [Expo: faster, more reliable video uploads with Expo Modules](https://expo.dev/blog/faster-more-reliable-video-uploads-with-expo-modules)
- [Cloudflare R2 pricing](https://developers.cloudflare.com:2053/r2/pricing)
- [Cloudflare R2 product page](https://cloudflare.com/product/r2)
- [R2 vs S3 pricing in 2026 (Upstash)](https://upstash.com/kb/cloudflare-r2-pricing-in-2026-storage-operations-and-real-monthly-bills)
- [Supabase: 500 GB uploads and egress pricing](https://supabase.com/blog/storage-500gb-uploads-cheaper-egress-pricing)
- [Supabase: resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
