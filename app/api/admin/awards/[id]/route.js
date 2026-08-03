import dbConnect from '@/lib/mongodb';
import Award from '@/models/Award';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { decorateAwards } from '@/lib/awardsData';

export const runtime = 'nodejs';

// PATCH /api/admin/awards/:id  body:{ won?, note?, category?, year? }
// Bật won -> tự tắt won của các đề cử khác trong cùng (năm, hạng mục).
export const PATCH = handle(async (req, ctx) => {
  await requireAuth();
  await dbConnect();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const doc = await Award.findById(id);
  if (!doc) return json({ error: 'Award not found' }, 404);

  if (body.category != null) {
    const category = String(body.category).trim();
    if (!category) return json({ error: 'category cannot be empty' }, 400);
    doc.category = category;
  }
  if (body.year != null) {
    const year = parseInt(body.year, 10);
    if (!Number.isFinite(year)) return json({ error: 'year must be a number' }, 400);
    doc.year = year;
  }
  if (body.note != null) doc.note = String(body.note).trim();
  if (body.won != null) doc.won = !!body.won;

  try {
    await doc.save();
  } catch (e) {
    if (e.code === 11000) return json({ error: 'Already nominated in that category/year' }, 409);
    throw e;
  }
  if (doc.won) await Award.updateMany({ year: doc.year, category: doc.category, won: true, _id: { $ne: doc._id } }, { $set: { won: false } });

  const [item] = await decorateAwards([doc.toObject()]);
  return json({ award: item });
});

// DELETE /api/admin/awards/:id
export const DELETE = handle(async (req, ctx) => {
  await requireAuth();
  await dbConnect();
  const { id } = await ctx.params;
  const doc = await Award.findByIdAndDelete(id);
  if (!doc) return json({ error: 'Award not found' }, 404);
  return json({ ok: true });
});
