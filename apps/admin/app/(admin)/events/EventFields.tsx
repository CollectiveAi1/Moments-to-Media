import { Field, Row, inputStyle, textareaStyle } from '@/components/ui';
import { TIME_ZONES, utcToZoned } from '@/lib/format';
import type { Person } from '@/lib/org';

export interface EventDefaults {
  title?: string;
  client_id?: string | null;
  producer_id?: string;
  starts_at?: string;
  ends_at?: string;
  time_zone?: string;
  area_label?: string | null;
  venue_name?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  check_in_radius_m?: number | null;
  arrival_notes?: string | null;
  parking_notes?: string | null;
  dress_code?: string | null;
}

/**
 * The event's own fields, shared by "New event" and the event page. Dates and
 * times are typed as wall-clock time in the event's zone and converted on the
 * server, so a producer in New York building a Phoenix shoot types Phoenix
 * time.
 */
export function EventFields({
  defaults = {},
  producers,
  clients,
  canChooseProducer,
  viewerId,
}: {
  defaults?: EventDefaults;
  producers: Person[];
  clients: Array<{ id: string; name: string }>;
  canChooseProducer: boolean;
  viewerId: string;
}) {
  const zone = defaults.time_zone ?? 'America/New_York';
  const start = defaults.starts_at ? utcToZoned(defaults.starts_at, zone) : { date: '', time: '18:00' };
  const end = defaults.ends_at ? utcToZoned(defaults.ends_at, zone) : { date: '', time: '22:00' };

  return (
    <>
      <Row>
        <Field label="Event title" grow={3}>
          <input name="title" required defaultValue={defaults.title ?? ''} style={inputStyle} placeholder="Northline Bank gala" />
        </Field>
        <Field label="Client">
          <select name="client_id" defaultValue={defaults.client_id ?? ''} style={inputStyle}>
            <option value="">No client yet</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="__new">+ New client…</option>
          </select>
        </Field>
        <Field label="New client name" hint="Only if you chose New client.">
          <input name="new_client" style={inputStyle} />
        </Field>
      </Row>
      <Row>
        <Field label="Producer">
          {canChooseProducer ? (
            <select name="producer_id" defaultValue={defaults.producer_id ?? viewerId} style={inputStyle}>
              {producers.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input type="hidden" name="producer_id" value={viewerId} />
              <input disabled value={producers.find((p) => p.userId === viewerId)?.name ?? 'You'} style={inputStyle} />
            </>
          )}
        </Field>
        <Field label="Time zone" hint="Times below are in this zone.">
          <select name="time_zone" defaultValue={zone} style={inputStyle}>
            {TIME_ZONES.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label} ({z.value})
              </option>
            ))}
          </select>
        </Field>
      </Row>
      <Row>
        <Field label="Date">
          <input type="date" name="date" required defaultValue={start.date} style={inputStyle} />
        </Field>
        <Field label="Starts">
          <input type="time" name="start_time" required defaultValue={start.time} style={inputStyle} />
        </Field>
        <Field label="End date" hint="Leave blank if it ends the same day.">
          <input type="date" name="end_date" defaultValue={end.date !== start.date ? end.date : ''} style={inputStyle} />
        </Field>
        <Field label="Ends">
          <input type="time" name="end_time" required defaultValue={end.time} style={inputStyle} />
        </Field>
      </Row>
      <Row>
        <Field label="Area shown on the job board" hint="Neighborhood only. Contractors see this before they are confirmed.">
          <input name="area_label" defaultValue={defaults.area_label ?? ''} style={inputStyle} placeholder="Short North, Columbus" />
        </Field>
        <Field label="Venue">
          <input name="venue_name" defaultValue={defaults.venue_name ?? ''} style={inputStyle} />
        </Field>
        <Field label="Exact address" grow={2} hint="Only confirmed crew see this.">
          <input name="address" defaultValue={defaults.address ?? ''} style={inputStyle} />
        </Field>
      </Row>
      <Row>
        <Field label="Latitude" hint="Optional. Enables check-in distance and travel radius.">
          <input name="latitude" inputMode="decimal" defaultValue={defaults.latitude?.toString() ?? ''} style={inputStyle} />
        </Field>
        <Field label="Longitude">
          <input name="longitude" inputMode="decimal" defaultValue={defaults.longitude?.toString() ?? ''} style={inputStyle} />
        </Field>
        <Field label="Check-in radius (metres)">
          <input name="check_in_radius_m" type="number" min={10} max={5000} defaultValue={defaults.check_in_radius_m ?? 200} style={inputStyle} />
        </Field>
      </Row>
      <Row>
        <Field label="Arrival">
          <textarea name="arrival_notes" defaultValue={defaults.arrival_notes ?? ''} style={textareaStyle} />
        </Field>
        <Field label="Parking">
          <textarea name="parking_notes" defaultValue={defaults.parking_notes ?? ''} style={textareaStyle} />
        </Field>
        <Field label="Dress code">
          <textarea name="dress_code" defaultValue={defaults.dress_code ?? ''} style={textareaStyle} />
        </Field>
      </Row>
    </>
  );
}
