'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import type { NavItem } from '@/lib/nav';

interface Props {
  items: NavItem[];
  user: { name: string; roleLabel: string };
  badges: { pendingProducts: number };
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
}

function activeHref(items: NavItem[], pathname: string): string | null {
  let best: string | null = null;
  for (const it of items) {
    const match = it.href === '/' ? pathname === '/' : pathname === it.href || pathname.startsWith(it.href + '/');
    if (match && (!best || it.href.length > best.length)) best = it.href;
  }
  return best;
}

export function AppShell({ items, user, badges, logoutAction, children }: Props) {
  const pathname = usePathname();
  // Izvēlne ir atvērta tikai tajā lapā, kurā tā tika atvērta — pārejot uz citu lapu tā aizveras automātiski
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    setOpenedAt(next ? pathname : null);
  };
  const active = activeHref(items, pathname);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenedAt(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="shell" data-nav-open={open}>
      <header className="topbar">
        <button
          type="button"
          className="btn btn-icon btn-ghost"
          aria-label="Atvērt izvēlni"
          aria-expanded={open}
          aria-controls="galvena-izvelne"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="menu" size={22} />
        </button>
        <Link href="/" className="brand" aria-label="Valmieras tehnikums — uz sākumu">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-text">
            <strong>Valmieras tehnikums</strong>
          </span>
        </Link>
      </header>
      <div className="nav-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className="sidebar" id="galvena-izvelne">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-text">
            <strong>Valmieras tehnikums</strong>
            <span>Pieteikumu sistēma</span>
          </span>
        </Link>
        <nav aria-label="Galvenā izvēlne">
          <ul className="nav">
            {items.map((it) => (
              <li key={it.href}>
                <Link href={it.href} aria-current={active === it.href ? 'page' : undefined}>
                  <Icon name={it.icon} />
                  <span>{it.label}</span>
                  {it.badgeKey && badges[it.badgeKey] > 0 ? (
                    <span className="nav-badge" aria-label={`${badges[it.badgeKey]} gaida izskatīšanu`}>
                      {badges[it.badgeKey]}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-foot">
          <div className="who">{user.name}</div>
          <div className="role">{user.roleLabel}</div>
          <form action={logoutAction}>
            <button type="submit" className="btn btn-sm">
              <Icon name="logout" size={16} /> Iziet
            </button>
          </form>
        </div>
      </aside>
      <div className="main">
        <main id="saturs" className="content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
