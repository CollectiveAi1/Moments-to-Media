import 'server-only';
import { text } from '@/lib/errors';
import { TIME_ZONES, zonedToUtc } from '@/lib/format';
import type { Viewer } from '@/lib/context';

export type EventValues = {
  title: string;
  producer_id: string;
  time_zone: string;
  starts_at: string;
  ends_at: string;
  area_label: string | null;
  venue_name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  check_in_radius_m: number;
  arrival_notes: string | null;
  parking_notes: string | null;
  dress_code: string | null;
  client_id: string | null;
};

/** Reads and checks EventFields. Returns a message instead of values when something is wrong. */
export async function readEventFields(
  viewer: Viewer,
  orgId: string,
  form: FormData,
): Promise<{ values: EventValues } | { error: string }> {
  const title = text(form, 'title');
  if (!title) return { error: 'Give the event a title.' };

  const timeZone = text(form, 'time_zone') ?? 'America/New_York';
  if (!TIME_ZONES.some((z) => z.value === timeZone)) return { error: 'Choose a time zone from the list.' };

  const date = text(form, 'date');
  const startTime = text(form, 'start_time');
  const endTime = text(form, 'end_time');
  if (!date || !startTime || !endTime) return { error: 'The date, start and end times are all needed.' };
  const endDate = text(form, 'end_date') ?? date;

  const starts = zonedToUtc(date, startTime, timeZone);
  const ends = zonedToUtc(endDate, endTime, timeZone);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return { error: 'That date or time is not valid.' };
  if (ends <= starts) return { error: 'The event has to end after it starts. For an overnight shoot, set the end date.' };

  const latRaw = text(form, 'latitude');
  const lngRaw = text(form, 'longitude');
  if ((latRaw === null) !== (lngRaw === null)) return { error: 'Give both latitude and longitude, or neither.' };
  const latitude = latRaw === null ? null : Number(latRaw);
  const longitude = lngRaw === null ? null : Number(lngRaw);
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) return { error: 'Latitude must be between -90 and 90.' };
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) return { error: 'Longitude must be between -180 and 180.' };

  const radius = Number(text(form, 'check_in_radius_m') ?? 200);
  if (!Number.isInteger(radius) || radius < 10 || radius > 5000) return { error: 'The check-in radius must be between 10 and 5000 metres.' };

  let clientId = text(form, 'client_id');
  if (clientId === '__new') {
    const name = text(form, 'new_client');
    if (!name) return { error: 'Type the new client’s name, or choose an existing client.' };
    const { data, error } = await viewer.supabase
      .from('clients')
      .insert({ org_id: orgId, name })
      .select('id')
      .single();
    if (error) return { error: `The client could not be created: ${error.message}` };
    clientId = String(data.id);
  }

  return {
    values: {
      title,
      producer_id: text(form, 'producer_id') ?? viewer.userId,
      time_zone: timeZone,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      area_label: text(form, 'area_label'),
      venue_name: text(form, 'venue_name'),
      address: text(form, 'address'),
      latitude,
      longitude,
      check_in_radius_m: radius,
      arrival_notes: text(form, 'arrival_notes'),
      parking_notes: text(form, 'parking_notes'),
      dress_code: text(form, 'dress_code'),
      client_id: clientId,
    },
  };
}
