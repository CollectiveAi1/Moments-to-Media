import Link from 'next/link';
import { switchOrg } from '@/app/actions';
import type { OrgMembership } from '@/lib/context';
import { color, fonts, radius } from '@/lib/ui';
import { SidebarNav } from './SidebarNav';
import { Wordmark } from './Wordmark';

export function Sidebar({
  email,
  orgs,
  orgId,
  isContractor,
}: {
  email: string;
  orgs: OrgMembership[];
  orgId: string;
  isContractor: boolean;
}) {
  const adminOrgs = orgs.filter((o) => o.roles.includes('owner') || o.roles.includes('producer'));
  return (
    <nav
      aria-label="Admin"
      style={{
        flex: '1 1 220px',
        maxWidth: '100%',
        background: color.surface,
        borderRight: `1px solid ${color.border}`,
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <Link href="/board" style={{ margin: '0 8px 20px', display: 'block' }} aria-label="Operations board">
        <Wordmark />
      </Link>

      {adminOrgs.length > 1 ? (
        <form action={switchOrg} style={{ margin: '0 4px 12px', display: 'flex', gap: 6 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, fontSize: 12, color: color.textMuted }}>
            Organization
            <select
              name="org"
              defaultValue={orgId}
              style={{ minHeight: 40, borderRadius: radius.sm, border: `1px solid ${color.border}`, background: color.surface, padding: '0 8px', fontSize: 13 }}
            >
              {adminOrgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" style={{ alignSelf: 'flex-end', minHeight: 40, padding: '0 10px', borderRadius: radius.sm, border: `1px solid ${color.border}`, background: 'transparent', fontSize: 13, cursor: 'pointer' }}>
            Go
          </button>
        </form>
      ) : null}

      <SidebarNav />

      <div style={{ marginTop: 'auto', padding: '24px 12px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isContractor ? (
          <Link
            href="/app"
            style={{
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              fontFamily: fonts.label,
              fontSize: 13,
              fontWeight: 600,
              color: color.label,
            }}
          >
            Contractor view →
          </Link>
        ) : null}
        <span style={{ fontSize: 12, color: color.textMuted, overflowWrap: 'anywhere' }}>{email}</span>
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            style={{
              minHeight: 44,
              padding: '0 12px',
              borderRadius: radius.sm,
              border: `1px solid ${color.border}`,
              background: 'transparent',
              color: color.text,
              fontFamily: fonts.label,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
