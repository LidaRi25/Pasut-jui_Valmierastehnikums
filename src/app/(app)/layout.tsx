import { AppShell } from '@/components/app-shell';
import { requireUser } from '@/lib/auth';
import { ROLE_LABEL, isAdminRole } from '@/lib/labels';
import { navFor } from '@/lib/nav';
import { createClient } from '@/lib/supabase/server';
import { logoutAction } from './actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  let pending = 0;
  if (isAdminRole(user.role)) {
    const supabase = await createClient();
    const { count } = await supabase
      .from('product_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    pending = count ?? 0;
  }
  return (
    <AppShell
      items={navFor(user.role)}
      user={{ name: user.fullName, roleLabel: ROLE_LABEL[user.role] }}
      badges={{ pendingProducts: pending }}
      logoutAction={logoutAction}
    >
      {children}
    </AppShell>
  );
}
