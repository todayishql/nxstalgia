import dbConnect from '@/lib/mongodb';
import Artist from '@/models/Artist';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';

// PUT /api/admin/artists/:id  -> cập nhật metadata 1 nghệ sĩ (upsert theo key).
export const PUT = handle(async (req, ctx) => {
  await requireAuth();
  await dbConnect();
  const { id } = await ctx.params;
  const body = await req.json();

  const set = {};
  if (body.name != null) set.name = String(body.name).trim();
  if (body.gender != null) set.gender = body.gender || '';
  if (body.region != null) set.region = body.region || '';
  if (Array.isArray(body.genres)) set.genres = body.genres;
  if (body.imageUrl != null) set.imageUrl = body.imageUrl;

  const doc = await Artist.findByIdAndUpdate(
    id,
    { $set: set, $setOnInsert: { name: set.name || id } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  return json({ artist: doc });
});

// DELETE /api/admin/artists/:id  -> xoá metadata 1 nghệ sĩ.
export const DELETE = handle(async (req, ctx) => {
  await requireAuth();
  await dbConnect();
  const { id } = await ctx.params;
  const doc = await Artist.findByIdAndDelete(id);
  if (!doc) return json({ error: 'Artist not found' }, 404);
  return json({ ok: true });
});
