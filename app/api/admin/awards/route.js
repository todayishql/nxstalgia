import dbConnect from '@/lib/mongodb';
import Award from '@/models/Award';
import Track from '@/models/Track';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { artistKey } from '@/lib/artists';
import { decorateAwards } from '@/lib/awardsData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Đúng 1 winner / (năm, hạng mục): bật won cho 1 doc -> tắt won ở các doc còn lại.
async function clearOtherWinners(year, category, keepId) {
  const filter = { year, category, won: true };
  if (keepId) filter._id = { $ne: keepId };
  await Award.updateMany(filter, { $set: { won: false } });
}

// GET /api/admin/awards?year=&category=&type=&q=  -> danh sách award (kèm tên hiển thị) + các năm đang có.
export const GET = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const { searchParams } = new URL(req.url);
  const filter = {};
  const year = parseInt(searchParams.get('year') || '', 10);
  if (Number.isFinite(year)) filter.year = year;
  const category = (searchParams.get('category') || '').trim();
  if (category) filter.category = category;
  const type = searchParams.get('type');
  if (type === 'track' || type === 'artist') filter.type = type;

  const [docs, years] = await Promise.all([
    Award.find(filter).sort({ year: -1, category: 1, won: -1 }).lean(),
    Award.distinct('year'),
  ]);
  let items = await decorateAwards(docs);

  const q = (searchParams.get('q') || '').trim().toLowerCase();
  if (q) items = items.filter((i) => i.name.toLowerCase().includes(q) || i.artist.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));

  return json({ total: items.length, items, years: years.sort((a, b) => b - a) });
});

// POST /api/admin/awards  body:{ year, category, type, subject, name?, won?, note? }
// type=track -> subject là trackId; type=artist -> subject là tên nghệ sĩ (tự chuẩn hoá thành artistKey).
export const POST = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const body = await req.json().catch(() => ({}));

  const year = parseInt(body.year, 10);
  if (!Number.isFinite(year)) return json({ error: 'year is required' }, 400);
  const category = String(body.category || '').trim();
  if (!category) return json({ error: 'category is required' }, 400);
  const type = body.type === 'artist' ? 'artist' : body.type === 'track' ? 'track' : '';
  if (!type) return json({ error: 'type must be "track" or "artist"' }, 400);

  let subject = String(body.subject || '').trim();
  let name = String(body.name || '').trim();
  if (!subject) return json({ error: 'subject is required' }, 400);

  if (type === 'track') {
    const t = await Track.findById(subject, { name: 1 }).lean();
    if (!t) return json({ error: `Song "${subject}" not found` }, 404);
    name = t.name;
  } else {
    name = name || subject;
    subject = artistKey(subject);
    if (!subject) return json({ error: 'artist name is required' }, 400);
  }

  const won = !!body.won;
  try {
    const doc = await Award.create({ year, category, type, subject, name, won, note: String(body.note || '').trim() });
    if (won) await clearOtherWinners(year, category, doc._id);
    const [item] = await decorateAwards([doc.toObject()]);
    return json({ award: item }, 201);
  } catch (e) {
    if (e.code === 11000) return json({ error: `"${name}" is already nominated in ${category} ${year}` }, 409);
    throw e;
  }
});

// DELETE /api/admin/awards  body:{ year, category? } -> xoá cả hạng mục (hoặc cả năm).
export const DELETE = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const body = await req.json().catch(() => ({}));
  const year = parseInt(body.year, 10);
  if (!Number.isFinite(year)) return json({ error: 'year is required' }, 400);
  const filter = { year };
  const category = String(body.category || '').trim();
  if (category) filter.category = category;
  const r = await Award.deleteMany(filter);
  return json({ deleted: r.deletedCount });
});
