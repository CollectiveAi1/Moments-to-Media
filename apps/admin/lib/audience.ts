/**
 * Who an announcement is for. Stored as announcements.audience, which
 * defaults to { kind: 'all' } (PRD "Admin console → Announcements": all, by
 * skill, by area, or one event's crew).
 */
export type Audience =
  | { kind: 'all' }
  | { kind: 'skill'; skill: string }
  | { kind: 'area'; area: string }
  | { kind: 'event'; event_id: string; event_title?: string };

export function parseAudience(value: unknown): Audience {
  const v = (value ?? {}) as Record<string, unknown>;
  if (v.kind === 'skill' && typeof v.skill === 'string') return { kind: 'skill', skill: v.skill };
  if (v.kind === 'area' && typeof v.area === 'string') return { kind: 'area', area: v.area };
  if (v.kind === 'event' && typeof v.event_id === 'string') {
    return typeof v.event_title === 'string'
      ? { kind: 'event', event_id: v.event_id, event_title: v.event_title }
      : { kind: 'event', event_id: v.event_id };
  }
  return { kind: 'all' };
}

export function describeAudience(a: Audience): string {
  switch (a.kind) {
    case 'all':
      return 'Everyone';
    case 'skill':
      return `Contractors with ${a.skill}`;
    case 'area':
      return `Based around ${a.area}`;
    case 'event':
      return `Crew on ${a.event_title ?? 'one event'}`;
  }
}

/** Whether a contractor is in the audience. The database already limits it to members. */
export function reaches(
  a: Audience,
  who: { skills: string[]; homeLabel: string | null; eventIds: string[] },
): boolean {
  switch (a.kind) {
    case 'all':
      return true;
    case 'skill':
      return who.skills.some((s) => s.toLowerCase() === a.skill.toLowerCase());
    case 'area':
      return (who.homeLabel ?? '').toLowerCase().includes(a.area.toLowerCase());
    case 'event':
      return who.eventIds.includes(a.event_id);
  }
}
