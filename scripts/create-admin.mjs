// Tạo tài khoản admin đầu tiên từ ADMIN_EMAIL/ADMIN_PASSWORD trong .env.local.
// Chạy: npm run create-admin  (nạp env qua --env-file=.env.local)
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const { MONGODB_URI, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!MONGODB_URI) { console.error('Thiếu MONGODB_URI'); process.exit(1); }
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Thiếu ADMIN_EMAIL / ADMIN_PASSWORD trong .env.local');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const email = ADMIN_EMAIL.toLowerCase().trim();
  const existing = await User.findOne({ email });
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  if (existing) {
    existing.passwordHash = passwordHash;
    await existing.save();
    console.log('Đã cập nhật mật khẩu cho admin:', email);
  } else {
    await User.create({ email, passwordHash, role: 'admin', name: 'Admin' });
    console.log('Đã tạo admin:', email);
  }
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });