import { handle, json } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const user = await getCurrentUser();
  return json({ user: user ? { id: user.sub, email: user.email, role: user.role } : null });
});