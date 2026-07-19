import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_TTL = parseInt(process.env.JWT_TTL || '604800', 10); // 7 ngày
export const AUTH_COOKIE = 'nxstalgia_token';

function secret() {
  if (!JWT_SECRET) throw new Error('Thiếu biến môi trường JWT_SECRET');
  return JWT_SECRET;
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}
export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload) {
  return jwt.sign(payload, secret(), { expiresIn: JWT_TTL });
}
export function verifyToken(token) {
  try {
    return jwt.verify(token, secret());
  } catch {
    return null;
  }
}

// Đặt/xoá cookie httpOnly (gọi trong route handler).
export async function setAuthCookie(token) {
  const jar = await cookies();
  jar.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: JWT_TTL,
  });
}
export async function clearAuthCookie() {
  const jar = await cookies();
  jar.delete(AUTH_COOKIE);
}

// Đọc user hiện tại từ cookie. Trả về payload {sub, email} hoặc null.
export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

// Bảo vệ route admin: ném lỗi 401 nếu chưa đăng nhập.
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    const err = new Error('Chưa đăng nhập');
    err.status = 401;
    throw err;
  }
  return user;
}