'use client';

import { startTransition, useActionState, useState } from 'react';
import type { Action, ActionResult } from '@/lib/action-types';
import { color } from '@/lib/ui';
import { buttonStyle } from '../ui';

/**
 * Check-in asks the phone where it is first (UI-SPEC 4.4: check-in records
 * location). If the person declines or it times out, they still check in;
 * the database just records no coordinates.
 */
export function CheckInButton({ action, assignmentId }: { action: Action; assignmentId: string }) {
  const [state, run, pending] = useActionState<ActionResult, FormData>(action, null);
  const [locating, setLocating] = useState(false);

  const submit = () => {
    const form = new FormData();
    form.set('assignment_id', assignmentId);
    const go = () => startTransition(() => run(form));
    if (!('geolocation' in navigator)) return go();
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        form.set('latitude', pos.coords.latitude.toFixed(6));
        form.set('longitude', pos.coords.longitude.toFixed(6));
        go();
      },
      () => {
        setLocating(false);
        go();
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  };

  const busy = pending || locating;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" onClick={submit} disabled={busy} style={{ ...buttonStyle(busy ? 'disabled' : 'primary', 52), width: '100%' }}>
        {locating ? 'Finding your location…' : pending ? 'Checking in…' : 'Check in'}
      </button>
      {state ? (
        <span role={state.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: state.ok ? color.positiveStrong : color.warnText }}>
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
