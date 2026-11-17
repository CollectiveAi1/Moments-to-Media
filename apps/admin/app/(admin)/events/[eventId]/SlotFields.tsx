import { Field, Row, inputStyle } from '@/components/ui';
import { utcToZoned } from '@/lib/format';
import { color } from '@/lib/ui';

export const GEAR_LABELS: Record<string, string> = {
  camera_body: 'Camera body',
  lens: 'Lens',
  audio: 'Audio',
  lighting: 'Lighting',
  drone: 'Drone',
  other: 'Other',
};

export interface SlotDefaults {
  role?: string;
  rate_type?: string;
  rate_amount_cents?: number;
  call_time?: string;
  required_gear?: string[];
  staffing_mode?: string;
  interest_deadline?: string | null;
  is_required?: boolean;
  minimum_hours?: number | null;
  overtime_rule?: { after_hours?: number; multiplier?: number } | null;
}

export function SlotFields({ defaults = {}, zone, eventStart }: { defaults?: SlotDefaults; zone: string; eventStart: string }) {
  const call = utcToZoned(defaults.call_time ?? eventStart, zone);
  const deadline = defaults.interest_deadline ? utcToZoned(defaults.interest_deadline, zone) : { date: '', time: '21:00' };
  const gear = new Set(defaults.required_gear ?? []);
  return (
    <>
      <Row>
        <Field label="Role" grow={2}>
          <input name="role" required defaultValue={defaults.role ?? ''} placeholder="Lead video" style={inputStyle} />
        </Field>
        <Field label="Rate type">
          <select name="rate_type" defaultValue={defaults.rate_type ?? 'flat'} style={inputStyle}>
            <option value="flat">Flat</option>
            <option value="hourly">Hourly</option>
            <option value="day">Day</option>
          </select>
        </Field>
        <Field label="Rate ($)">
          <input name="rate" required inputMode="decimal" defaultValue={defaults.rate_amount_cents !== undefined ? String(defaults.rate_amount_cents / 100) : ''} style={inputStyle} />
        </Field>
        <Field label="Staffing">
          <select name="staffing_mode" defaultValue={defaults.staffing_mode ?? 'direct_invite'} style={inputStyle}>
            <option value="direct_invite">Direct invite</option>
            <option value="open_call">Open call</option>
          </select>
        </Field>
      </Row>
      <Row>
        <Field label="Call date">
          <input type="date" name="call_date" defaultValue={call.date} style={inputStyle} />
        </Field>
        <Field label="Call time">
          <input type="time" name="call_time" defaultValue={call.time} style={inputStyle} />
        </Field>
        <Field label="Interest closes" hint="Open calls only.">
          <input type="date" name="deadline_date" defaultValue={deadline.date} style={inputStyle} />
        </Field>
        <Field label="at">
          <input type="time" name="deadline_time" defaultValue={deadline.time} style={inputStyle} />
        </Field>
      </Row>
      <Row>
        <Field label="Minimum hours" hint="Hourly only.">
          <input name="minimum_hours" inputMode="decimal" defaultValue={defaults.minimum_hours?.toString() ?? ''} style={inputStyle} />
        </Field>
        <Field label="Overtime after (hours)" hint="Hourly only.">
          <input name="overtime_after" inputMode="decimal" defaultValue={defaults.overtime_rule?.after_hours?.toString() ?? ''} style={inputStyle} />
        </Field>
        <Field label="Overtime multiplier">
          <input name="overtime_multiplier" inputMode="decimal" defaultValue={defaults.overtime_rule?.multiplier?.toString() ?? '1.5'} style={inputStyle} />
        </Field>
      </Row>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'center' }}>
        <legend style={{ fontSize: 12, fontWeight: 600, color: color.textMuted, marginBottom: 6 }}>Gear required</legend>
        {Object.entries(GEAR_LABELS).map(([value, label]) => (
          <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 32, fontSize: 14 }}>
            <input type="checkbox" name={`gear_${value}`} defaultChecked={gear.has(value)} /> {label}
          </label>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 32, fontSize: 14, marginLeft: 'auto' }}>
          <input type="checkbox" name="is_required" defaultChecked={defaults.is_required ?? true} /> Required for the event to count as staffed
        </label>
      </fieldset>
    </>
  );
}
