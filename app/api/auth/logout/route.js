import { handle, json } from '@/lib/api';
import { clearAuthCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export const POST = handle(async () => {
  await clearAuthCookie();
  return json({ ok: true });
});