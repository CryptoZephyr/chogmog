import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { applyCssVariables, colour } from './tokens';

export type AppTab = 'play' | 'build' | 'gallery';
const TABS: { id: AppTab; label: string; href: string }[] = [
  { id: 'play', label: 'Play', href: './' },
  { id: 'build', label: 'Build', href: '?harness=machine' },
  { id: 'gallery', label: 'Gallery', href: '?harness=gallery' },
];

export function AppFrame({ tab, layout, wall = colour.wall, onSignIn, children }: {
  tab: AppTab | null; layout: 'play' | 'workspace' | 'single'; wall?: string; onSignIn?: () => void; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (root.current) applyCssVariables(root.current); }, []);
  return <div className={`app ${layout}`} ref={root} style={{ '--wall': wall } as CSSProperties}>
    <header className="panel topbar">
      <a className="wordmark" href="./" aria-label="chogmog, home">ch<span className="cheek">o</span>gm<span className="cheek">o</span>g</a>
      <nav className="tabs" aria-label="Main">
        {TABS.map((item) => <a key={item.id} className={`${item.id}-tab`} href={item.href} aria-current={tab === item.id ? 'page' : undefined}>{item.label}</a>)}
      </nav>
      <span className="spacer" />
      {onSignIn && <button className="chip-button" onClick={onSignIn}>Sign in (no transaction)</button>}
    </header>
    {children}
  </div>;
}
