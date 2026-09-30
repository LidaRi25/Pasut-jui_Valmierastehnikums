import type { AppRole } from '@/lib/labels';
import type { IconName } from '@/components/icons';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badgeKey?: 'pendingProducts';
}

const TEACHER: NavItem[] = [
  { href: '/', label: 'Sākums', icon: 'home' },
  { href: '/pieteikumi', label: 'Mani pieteikumi', icon: 'list' },
  { href: '/pieteikumi/jauns', label: 'Jauns pieteikums', icon: 'plus' },
  { href: '/katalogs', label: 'Preču katalogs', icon: 'box' },
  { href: '/profils', label: 'Profils', icon: 'user' },
];

const ADMIN: NavItem[] = [
  { href: '/', label: 'Sākums', icon: 'home' },
  { href: '/pieteikumi', label: 'Pieteikumi', icon: 'list' },
  { href: '/pasutijums', label: 'Kopējais pasūtījums', icon: 'layers' },
  { href: '/katalogs', label: 'Preču katalogs', icon: 'box' },
  { href: '/jaunas-preces', label: 'Jaunās preces', icon: 'inbox', badgeKey: 'pendingProducts' },
  { href: '/grupas', label: 'Grupas', icon: 'users' },
  { href: '/periodi', label: 'Periodi', icon: 'calendar' },
  { href: '/parskati', label: 'Pārskati', icon: 'chart' },
];

const SYSADMIN_EXTRA: NavItem[] = [
  { href: '/lietotaji', label: 'Lietotāji', icon: 'user' },
  { href: '/iestatijumi', label: 'Iestatījumi', icon: 'settings' },
];

export function navFor(role: AppRole): NavItem[] {
  if (role === 'teacher') return TEACHER;
  if (role === 'admin') return ADMIN;
  return [...ADMIN, ...SYSADMIN_EXTRA];
}
