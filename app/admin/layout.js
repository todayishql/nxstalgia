'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from './api';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/tracks', label: 'Songs' },
  { href: '/admin/artists', label: 'Artists' },
  { href: '/admin/chart', label: 'Chart' },
];

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/admin/login';
  const [user, setUser] = useState(undefined); // undefined = đang kiểm tra

  useEffect(() => {
    if (isLogin) return;
    api('/api/auth/me')
      .then((d) => {
        if (!d.user) router.replace('/admin/login');
        else setUser(d.user);
      })
      .catch(() => router.replace('/admin/login'));
  }, [isLogin, pathname, router]);

  if (isLogin) return children;
  if (user === undefined) return <div className="container muted">Loading…</div>;

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    router.replace('/admin/login');
  }

  return (
    <>
      <nav className="topnav">
        <span className="brand">N[26]stalgia</span>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
            {n.label}
          </Link>
        ))}
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>{user.email}</span>
        <button className="ghost sm" onClick={logout}>Sign out</button>
      </nav>
      <div className="container">{children}</div>
    </>
  );
}
