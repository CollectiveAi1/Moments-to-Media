/**
 * What the contractor's home screen asks of them (UI-SPEC 4.1, "Needs you"),
 * in priority order. Pure: rows in, items out, clock passed in.
 */

export interface MyAssignment {
  id: string;
  status: string;
  role: string;
  eventId: string;
  eventTitle: string;
  startsAt: string;
  timeZone: string;
  inviteExpiresAt: string | null;
  confirmDeadline: string | null;
  /** Earliest deliverable due on the slot, once visible. */
  dueAt: string | null;
  /** Latest "changes requested" note, if any. */
  changesNote: string | null;
}

export interface MyDocument {
  id: string;
  docType: string;
  status: string;
  expiresOn: string | null;
}

export type NeedKind = 'respond_selected' | 'respond_invite' | 'changes' | 'upload' | 'document';

export interface Need {
  kind: NeedKind;
  key: string;
  assignmentId?: string;
  title: string;
  detail: string;
  /** When it has to be done by, if there is a deadline. */
  by: string | null;
  urgent: boolean;
}

const HOUR = 3_600_000;
const ORDER: NeedKind[] = ['respond_selected', 'respond_invite', 'changes', 'upload', 'document'];

export function needs(assignments: MyAssignment[], documents: MyDocument[], now: Date): Need[] {
  const out: Need[] = [];
  const t = now.getTime();

  for (const a of assignments) {
    if (a.status === 'selected' && (!a.confirmDeadline || new Date(a.confirmDeadline).getTime() > t)) {
      out.push({
        kind: 'respond_selected',
        key: `sel-${a.id}`,
        assignmentId: a.id,
        title: 'You were selected',
        detail: `${a.role} · ${a.eventTitle}`,
        by: a.confirmDeadline,
        urgent: true,
      });
    }
    if (a.status === 'invited' && (!a.inviteExpiresAt || new Date(a.inviteExpiresAt).getTime() > t)) {
      out.push({
        kind: 'respond_invite',
        key: `inv-${a.id}`,
        assignmentId: a.id,
        title: 'You were invited',
        detail: `${a.role} · ${a.eventTitle}`,
        by: a.inviteExpiresAt,
        urgent: true,
      });
    }
    if (a.status === 'changes_requested') {
      out.push({
        kind: 'changes',
        key: `chg-${a.id}`,
        assignmentId: a.id,
        title: 'Changes requested',
        detail: a.changesNote ? `${a.eventTitle} · “${a.changesNote}”` : a.eventTitle,
        by: a.dueAt,
        urgent: true,
      });
    }
    if (a.status === 'checked_out') {
      out.push({
        kind: 'upload',
        key: `up-${a.id}`,
        assignmentId: a.id,
        title: a.dueAt ? 'Upload due' : 'Upload your footage',
        detail: `${a.eventTitle} · ${a.role}`,
        by: a.dueAt,
        urgent: a.dueAt !== null && new Date(a.dueAt).getTime() - t < 24 * HOUR,
      });
    }
  }

  for (const d of documents) {
    const expires = d.expiresOn ? new Date(`${d.expiresOn}T00:00:00Z`).getTime() : null;
    if (d.status === 'rejected') {
      out.push({ kind: 'document', key: `doc-${d.id}`, title: 'Document needs replacing', detail: label(d.docType), by: null, urgent: true });
    } else if (expires !== null && expires < t) {
      out.push({ kind: 'document', key: `doc-${d.id}`, title: 'Document expired', detail: label(d.docType), by: d.expiresOn, urgent: true });
    } else if (d.status === 'approved' && expires !== null && expires - t < 60 * 24 * HOUR) {
      out.push({ kind: 'document', key: `doc-${d.id}`, title: 'Document expiring', detail: label(d.docType), by: d.expiresOn, urgent: false });
    }
  }

  return out.sort((a, b) => {
    const k = ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);
    if (k !== 0) return k;
    if (a.by && b.by) return a.by.localeCompare(b.by);
    return a.by ? -1 : b.by ? 1 : 0;
  });
}

/** The next job to show in the hero card: on today, or the soonest confirmed one. */
export function nextUp<T extends MyAssignment>(assignments: T[], now: Date): T | null {
  const t = now.getTime();
  return (
    assignments
      .filter((a) => ['checked_in', 'confirmed'].includes(a.status))
      .filter((a) => a.status === 'checked_in' || new Date(a.startsAt).getTime() > t - 12 * HOUR)
      .sort((a, b) => (a.status === 'checked_in' ? -1 : b.status === 'checked_in' ? 1 : a.startsAt.localeCompare(b.startsAt)))[0] ??
    null
  );
}

const LABELS: Record<string, string> = {
  contractor_agreement: 'Contractor agreement',
  insurance: 'Insurance certificate',
  w9: 'W-9',
};
export const label = (docType: string) => LABELS[docType] ?? docType.replace(/_/g, ' ');
