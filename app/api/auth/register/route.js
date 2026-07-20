import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { handle, json } from '@/lib/api';
import { hashPassword, signToken, setAuthCookie, requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';

// Tạo user mới. Nếu đã có ít nhất 1 user -> yêu cầu đăng nhập (chỉ admin mới thêm được).
// Nếu DB chưa có user nào -> cho phép tạo admin đầu tiên (bootstrap).
export const POST = handle(async (req) => {
  await dbConnect();
  const count = await User.countDocuments();
  if (count > 0) await requireAuth();

  const { email, password, name } = await req.json();
  if (!email || !password) return json({ error: 'Email and password are required' }, 400);
  if (String(password).length < 6)
    return json({ error: 'Password must be at least 6 characters' }, 400);

  const exists = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (exists) return json({ error: 'Email already exists' }, 409);

  const user = await User.create({
    email: String(email).toLowerCase().trim(),
    passwordHash: await hashPassword(password),
    name: name || '',
  });

  // Bootstrap admin đầu tiên -> tự đăng nhập luôn.
  if (count === 0) {
    const token = signToken({ sub: String(user._id), email: user.email, role: user.role });
    await setAuthCookie(token);
  }
  return json({ user: { id: user._id, email: user.email, name: user.name, role: user.role } }, 201);
});