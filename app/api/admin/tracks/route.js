import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import Entry from '@/models/Entry';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { splitArtists } from '@/lib/artists';
import { songKey, makeIdGen } from '@/lib/songid';

export const runtime = 'nodejs';

// GET /api/admin/tracks?q=&limit=&skip=  -> danh sách track. all=1 -> trả tất cả (cho export CSV).
export const GET = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const all = searchParams.get('all') === '1';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 500);
  const skip = Math.max(parseInt(searchParams.get('skip') || '0', 10) || 0, 0);

  // Sort theo field cho phép (map -> field DB). Mặc định name tăng dần.
  const SORTABLE = { id: '_id', name: 'name', artist: 'artist', baseline: 'baseline', status: 'artworkStatus' };
  const sortKey = SORTABLE[searchParams.get('sort')] || 'name';
  const dir = searchParams.get('dir') === 'desc' ? -1 : 1;

  const filter = q
    ? { $or: [{ name: new RegExp(q, 'i') }, { artist: new RegExp(q, 'i') }, { _id: q }] }
    : {};
  let query = Track.find(filter).sort({ [sortKey]: dir, _id: 1 });
  if (!all) query = query.skip(skip).limit(limit);
  const [items, total] = await Promise.all([query.lean(), Track.countDocuments(filter)]);
  return json({ total, items: items.map((t) => ({ id: t._id, ...t, _id: undefined })) });
});

// POST /api/admin/tracks  -> tạo track mới. id TỰ SINH (S###); chống trùng theo tên+nghệ sĩ.
export const POST = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const body = await req.json();
  const { aid, name, artist, baseline, artworkUrl } = body;
  if (!name || !artist) return json({ error: 'name and artist are required' }, 400);

  const existing = await Track.find({}, { name: 1, artist: 1 }).lean();
  const keys = new Set(existing.map((t) => songKey(t.name, t.artist)));
  if (keys.has(songKey(name, artist))) {
    return json({ error: 'A song with the same name + artist already exists' }, 409);
  }
  const genId = makeIdGen(existing.map((t) => t._id));

  const doc = await Track.create({
    _id: genId(),
    aid: aid || '',
    name,
    artist,
    artists: Array.isArray(body.artists) && body.artists.length ? body.artists : splitArtists(artist),
    baseline: Number(baseline) || 0,
    artworkUrl: artworkUrl || '',
    artworkStatus: artworkUrl ? 'ok' : 'pending',
  });
  return json({ track: { id: doc._id, ...doc.toObject(), _id: undefined } }, 201);
});

// DELETE /api/admin/tracks  body:{ ids:[...] } -> xoá nhiều track + toàn bộ entries của chúng.
export const DELETE = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!ids.length) return json({ error: 'ids array is required' }, 400);

  const tRes = await Track.deleteMany({ _id: { $in: ids } });
  const eRes = await Entry.deleteMany({ trackId: { $in: ids } });
  return json({ deletedTracks: tRes.deletedCount, deletedEntries: eRes.deletedCount });
});