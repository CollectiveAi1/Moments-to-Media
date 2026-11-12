/**
 * Status enums and legal transitions.
 *
 * The database is the source of truth: these mirror the Postgres enums and the
 * CASE tables inside transition_event / transition_assignment / transition_payout
 * (supabase/migrations/20261112000500_transition_functions.sql). Clients use
 * these for labels and for hiding actions the server would reject anyway —
 * never as the enforcement point. See PRD "Status lifecycles".
 */

export const ORG_ROLES = ['owner', 'producer', 'contractor', 'client'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const EVENT_STATUSES = [
  'draft',
  'staffing',
  'staffed',
  'in_progress',
  'uploaded',
  'complete',
  'cancelled',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Client-facing wording from PRD "Status lifecycles → Event". */
export const EVENT_STATUS_CLIENT_TERM: Record<EventStatus, string | null> = {
  draft: null,
  staffing: 'Pending',
  staffed: 'Accepted',
  in_progress: 'In Progress',
  uploaded: 'Uploaded',
  complete: 'Complete',
  cancelled: null,
};

export const EVENT_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  draft: ['staffing', 'cancelled'],
  staffing: ['staffed', 'cancelled'],
  // staffed → staffing: a committed contractor leaving uncovers a required
  // slot, so the event is no longer staffed.
  staffed: ['in_progress', 'staffing', 'cancelled'],
  in_progress: ['uploaded'],
  uploaded: ['complete'],
  complete: [],
  cancelled: [],
};

export const ASSIGNMENT_STATUSES = [
  'invited',
  'interested',
  'selected',
  'confirmed',
  'checked_in',
  'checked_out',
  'uploaded',
  'changes_requested',
  'approved',
  'paid',
  'declined',
  'not_selected',
  'withdrawn',
  'expired',
  'cancelled',
  'dropped',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** Pre-confirm states: the contractor sees the job-board projection, not the packet. */
export const ASSIGNMENT_PRE_CONFIRM = ['invited', 'interested', 'selected'] as const;

/** Confirmed or past it: the full event packet is unlocked. */
export const ASSIGNMENT_PACKET_UNLOCKED = [
  'confirmed',
  'checked_in',
  'checked_out',
  'uploaded',
  'changes_requested',
  'approved',
  'paid',
] as const;

export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, readonly AssignmentStatus[]> = {
  invited: ['confirmed', 'declined', 'expired'],
  interested: ['selected', 'not_selected', 'withdrawn'],
  selected: ['confirmed', 'expired'],
  confirmed: ['checked_in', 'cancelled', 'dropped'],
  checked_in: ['checked_out'],
  checked_out: ['uploaded'],
  uploaded: ['changes_requested', 'approved'],
  changes_requested: ['uploaded'],
  approved: ['paid'],
  paid: [],
  declined: [],
  not_selected: [],
  withdrawn: [],
  expired: [],
  cancelled: [],
  dropped: [],
};

export const PAYOUT_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'sent',
  'paid',
  'failed',
  'reversed',
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_TRANSITIONS: Record<PayoutStatus, readonly PayoutStatus[]> = {
  draft: ['submitted'],
  submitted: ['approved'],
  approved: ['sent'],
  sent: ['paid', 'failed'],
  paid: ['reversed'],
  failed: ['submitted'],
  reversed: [],
};

export const SLOT_STATUSES = ['draft', 'inviting', 'open_call', 'filled', 'cancelled'] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export const STAFFING_MODES = ['direct_invite', 'open_call'] as const;
export type StaffingMode = (typeof STAFFING_MODES)[number];

export const RATE_TYPES = ['flat', 'hourly', 'day'] as const;
export type RateType = (typeof RATE_TYPES)[number];

/** Defaults from PRD "Core workflows → Staffing". Overridable per organization. */
export const DEFAULT_INVITE_WINDOW_HOURS = 24;
export const DEFAULT_CONFIRM_DEADLINE_HOURS = 12;
/** PRD "Permissions and data visibility": packet access ends 7 days after completion. */
export const PACKET_ACCESS_DAYS_AFTER_COMPLETE = 7;
