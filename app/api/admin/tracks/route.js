import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { splitArtists } from '@/lib/artists';

export const runtime = 'nodejs';

// GET /api/admin/tracks?q=&limit=&skip=  -> danh sách track (kèm số tuần đã xuất hiện)
export const GET = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
  const skip = parseInt(searchParams.get('skip') || '0', 10);

  const filter = q
    ? { $or: [{ name: new RegExp(q, 'i') }, { artist: new RegExp(q, 'i') }, { _id: q }] }
    : {};
  const [items, total] = await Promise.all([
    Track.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    Track.countDocuments(filter),
  ]);
  return json({ total, items: items.map((t) => ({ id: t._id, ...t, _id: undefined })) });
});

// POST /api/admin/tracks  -> tạo track mới
export const POST = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const body = await req.json();
  const { id, aid, name, artist, baseline, artworkUrl } = body;
  if (!id || !name || !artist) return json({ error: 'id, name and artist are required' }, 400);

  const exists = await Track.findById(id);
  if (exists) return json({ error: 'id already exists' }, 409);

  const doc = await Track.create({
    _id: String(id),
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