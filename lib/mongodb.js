import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

// Cache kết nối qua global để không tạo nhiều connection khi Next hot-reload.
let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

export default async function dbConnect() {
  if (!MONGODB_URI) {
    throw new Error('Thiếu biến môi trường MONGODB_URI (xem .env.local.example)');
  }
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}