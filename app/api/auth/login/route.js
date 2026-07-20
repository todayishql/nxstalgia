import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { handle, json } from '@/lib/api';
import { verifyPassword, signToken, setAuthCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export const POST = handle(async (req) => {
  const { email, password } = await req.json();
  if (!email || !password) return json({ error: 'Email and password are required' }, 400);

  await dbConnect();
  const user = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return json({ error: 'Invalid email or password' }, 401);
  }

  const token = signToken({ sub: String(user._id), email: user.email, role: user.role });
  await setAuthCookie(token);
  return json({ user: { id: user._id, email: user.email, name: user.name, role: user.role } });
});