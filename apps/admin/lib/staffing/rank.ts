/**
 * Ranking contractors for a slot (PRD "Staffing", "Admin console → Staffing").
 *
 * The PRD's MVP ranks by area, gear and availability; reliability and history
 * with the client are shown beside the score but do not move it until v1.1
 * (docs/ui/NOTES.md). The score is out of 100 so a producer can read it at a
 * glance, and every point lost comes with a reason they can see.
 */

export interface AvailabilityRow {
  startsOn: string; // YYYY-MM-DD
  endsOn: string;
  isAvailable: boolean;
  recurrenceDays: number[] | null; // 0 = Sunday
}

export interface Candidate {
  userId: string;
  name: string;
  homeLabel: string | null;
  homeLat: number | null;
  homeLng: number | null;
  travelRadiusMiles: number | null;
  gear: string[];
  availability: AvailabilityRow[];
  /** Committed elsewhere at an overlapping time. */
  bookedElsewhere: boolean;
  complianceComplete: boolean;
  ratings: Array<{ quality: number; punctuality: number; communication: number }>;
  jobsDone: number;
  jobsWithClient: number;
}

export interface SlotNeeds {
  requiredGear: string[];
  eventDate: string; // YYYY-MM-DD in the event's zone
  eventLat: number | null;
  eventLng: number | null;
}

export interface Ranked {
  candidate: Candidate;
  score: number;
  distanceMiles: number | null;
  missingGear: string[];
  availability: 'available' | 'unavailable' | 'booked' | 'unknown';
  reliability: number | null;
  flags: string[];
}

const EARTH_MILES = 3958.8;

export function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** What the contractor has said about that date. Specific rows beat recurring ones. */
export function availabilityOn(rows: AvailabilityRow[], date: string): 'available' | 'unavailable' | 'unknown' {
  const covering = rows.filter((r) => r.startsOn <= date && r.endsOn >= date);
  const specific = covering.filter((r) => !r.recurrenceDays || r.recurrenceDays.length === 0);
  const recurring = covering.filter((r) => r.recurrenceDays?.includes(dayOfWeek(date)));
  const decide = (list: AvailabilityRow[]) =>
    list.length === 0 ? null : list.some((r) => !r.isAvailable) ? 'unavailable' : 'available';
  return decide(specific) ?? decide(recurring) ?? 'unknown';
}

export function rank(candidates: Candidate[], slot: SlotNeeds): Ranked[] {
  return candidates
    .map((c): Ranked => {
      const flags: string[] = [];

      // Area: 40 points.
      let distance: number | null = null;
      let areaScore = 20;
      if (slot.eventLat !== null && slot.eventLng !== null && c.homeLat !== null && c.homeLng !== null) {
        distance = milesBetween(c.homeLat, c.homeLng, slot.eventLat, slot.eventLng);
        const radius = Math.max(c.travelRadiusMiles ?? 0, 1);
        if (distance <= radius) {
          areaScore = Math.round(40 - 30 * (distance / radius));
        } else {
          areaScore = 0;
          flags.push(`Outside travel radius (${Math.round(distance)} mi, travels ${c.travelRadiusMiles ?? 0})`);
        }
      }

      // Gear: 30 points.
      const owned = new Set(c.gear);
      const missingGear = slot.requiredGear.filter((g) => !owned.has(g));
      const gearScore =
        slot.requiredGear.length === 0
          ? 30
          : Math.round((30 * (slot.requiredGear.length - missingGear.length)) / slot.requiredGear.length);
      if (missingGear.length) flags.push(`Missing ${missingGear.join(', ').replace(/_/g, ' ')}`);

      // Availability: 30 points.
      let availability: Ranked['availability'] = availabilityOn(c.availability, slot.eventDate);
      if (c.bookedElsewhere) availability = 'booked';
      const availabilityScore = availability === 'available' ? 30 : availability === 'unknown' ? 20 : 0;
      if (availability === 'booked') flags.push('Booked on another job then');
      if (availability === 'unavailable') flags.push('Marked unavailable that day');

      if (!c.complianceComplete) flags.push('Documents incomplete');

      const reliability =
        c.ratings.length === 0
          ? null
          : Math.round(
              (c.ratings.reduce((n, r) => n + (r.quality + r.punctuality + r.communication) / 3, 0) / c.ratings.length) * 10,
            ) / 10;

      return {
        candidate: c,
        score: areaScore + gearScore + availabilityScore,
        distanceMiles: distance === null ? null : Math.round(distance * 10) / 10,
        missingGear,
        availability,
        reliability,
        flags,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.reliability ?? 0) - (a.reliability ?? 0) ||
        b.candidate.jobsWithClient - a.candidate.jobsWithClient ||
        a.candidate.name.localeCompare(b.candidate.name),
    );
}
