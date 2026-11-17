import type { ReactNode } from 'react';
import { ContractorSidebar } from '@/components/contractor/ContractorSidebar';
import { TabBar } from '@/components/contractor/TabBar';
import { requireContractor } from '@/lib/context';
import { color, radius } from '@/lib/ui';

/**
 * The contractor app as a web view. On a phone it is the UI-SPEC screen: one
 * column and a bottom tab bar. From 960px wide it becomes a desktop layout: a
 * side navigation, a wider page, and two columns where a screen has a main
 * thread and a side panel (the `c-cols` / `c-aside` classes below). On a
 * phone those wrappers are `display: contents`, so the page keeps the single
 * column order and the action bar stays pinned to the whole page.
 *
 * These are classes rather than inline styles because only CSS can change a
 * layout at a breakpoint. Colours still come from the tokens.
 */
const layout = `
.c-shell{min-height:100vh;background:${color.bg};display:flex}
.c-side{display:none}
.c-main{flex:1;min-width:0;display:flex;justify-content:center}
.c-page{width:100%;max-width:480px;padding:20px 20px 120px;display:flex;flex-direction:column;gap:20px}
.c-cols,.c-col,.c-aside{display:contents}
.c-grid{display:flex;flex-direction:column;gap:10px}
.c-facts{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.c-bar{position:sticky;bottom:96px;background:${color.bg};border-top:1px solid ${color.border};padding:16px 0 12px;display:flex;flex-direction:column;gap:8px;z-index:5}
.c-desktop-only{display:none}
@media (min-width:960px){
  .c-side{display:flex}
  .c-tabbar,.c-mobile-only{display:none}
  .c-desktop-only{display:revert}
  .c-page{max-width:1200px;padding:40px 48px 72px;gap:28px}
  .c-cols{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(320px,1fr);gap:32px;align-items:start}
  .c-col,.c-aside{display:flex;flex-direction:column;gap:20px;min-width:0}
  .c-aside>.c-bar{order:-1}
  .c-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
  .c-facts{grid-template-columns:repeat(4,1fr)}
  .c-bar{position:static;background:${color.surface};border:1px solid ${color.border};border-radius:${radius.xl}px;padding:20px}
}
`;

export default async function ContractorLayout({ children }: { children: ReactNode }) {
  const viewer = await requireContractor();
  return (
    <div className="c-shell">
      <style dangerouslySetInnerHTML={{ __html: layout }} />
      <ContractorSidebar name={viewer.name} email={viewer.email} orgName={viewer.org.name} isAdmin={viewer.isAdmin} />
      <div className="c-main">
        <main className="c-page">{children}</main>
      </div>
      <div className="c-tabbar">
        <TabBar />
      </div>
    </div>
  );
}
