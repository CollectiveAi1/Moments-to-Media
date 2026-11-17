'use client';

import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { color } from '@/lib/ui';

/**
 * Picks up a session delivered in the URL fragment by an emailed link and
 * turns it into the session cookie. The fragment is cleared straight away so
 * the tokens do not linger in the address bar or history.
 */
export function HashSession() {
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access = hash.get('access_token');
    const refresh = hash.get('refresh_token');
    if (!access || !refresh) {
      if (hash.get('error_description')) setState('failed');
      return;
    }
    setState('working');
    history.replaceState(null, '', window.location.pathname);
    browserClient()
      .auth.setSession({ access_token: access, refresh_token: refresh })
      .then(({ error }) => {
        if (error) setState('failed');
        else window.location.replace('/auth/finish');
      });
  }, []);

  if (state === 'idle') return null;
  return (
    <p role={state === 'failed' ? 'alert' : 'status'} style={{ margin: 0, fontSize: 14, color: state === 'failed' ? color.warnText : color.positiveStrong }}>
      {state === 'working' ? 'Signing you in…' : 'That sign-in link has expired or was already used. Ask for a new one below.'}
    </p>
  );
}
