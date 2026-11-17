'use client';

import { useEffect, useState } from 'react';
import { color } from '@/lib/ui';

/**
 * Picks up a session delivered in the URL fragment by an emailed link and
 * hands it to /auth/session, which sets the httpOnly session cookie. The fragment is cleared straight away so
 * the tokens do not linger in the address bar or history.
 */
export function HashSession() {
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access = hash.get('access_token');
    const refresh = hash.get('refresh_token');
    const type = hash.get('type') ?? '';
    if (!access || !refresh) {
      if (hash.get('error_description')) setState('failed');
      return;
    }
    setState('working');
    history.replaceState(null, '', window.location.pathname);
    fetch('/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ access_token: access, refresh_token: refresh }),
    })
      .then((res) => {
        if (!res.ok) setState('failed');
        else window.location.replace(`/auth/finish?type=${encodeURIComponent(type)}`);
      })
      .catch(() => setState('failed'));
  }, []);

  if (state === 'idle') return <p style={{ margin: 0, fontSize: 14, color: color.textMuted }}>Nothing to do here. Use the link below to sign in.</p>;
  return (
    <p role={state === 'failed' ? 'alert' : 'status'} style={{ margin: 0, fontSize: 14, color: state === 'failed' ? color.warnText : color.positiveStrong }}>
      {state === 'working' ? 'Signing you in…' : 'That link has expired or was already used. Sign in with your password, or use “Forgot password” for a new link.'}
    </p>
  );
}
