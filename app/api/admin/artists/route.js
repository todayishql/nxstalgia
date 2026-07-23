import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import Artist from '@/models/Artist';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { splitArtists, artistKey } from '@/lib/artists';

export const runtime = 'nodejs';

// Gom danh sách nghệ sĩ từ Track.artists (theo key chuẩn hoá) + số bài + genre của các bài.
async function collectFromTracks() {
  const tracks = await Track.find({}, { artists: 1, artist: 1, genre: 1 }).lean();
  const map = new Map(); // key -> { key, name, trackCount, trackGenres:Set }
  for (const t of tracks) {
    const names = Array.isArray(t.artists) && t.artists.length ? t.artists : splitArtists(t.artist);
    for (const nm of names) {
      const key = artistKey(nm);
      if (!key) continue;
      let e = map.get(key);
      if (!e) { e = { key, name: nm, trackCount: 0, trackGenres: new Set() }; map.set(key, e); }
      e.trackCount++;
      if (t.genre) e.trackGenres.add(t.genre);
    }
  }
  return map;
}

// GET /api/admin/artists?q=&missing=gender|region&sort=name|tracks&dir=&limit=&skip=
// Trả list nghệ sĩ (gộp bài hát đang có + metadata đã lưu), kể cả nghệ sĩ chưa từng lưu.
export const GET = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const missing = searchParams.get('missing') || '';
  const sort = searchParams.get('sort') === 'tracks' ? 'tracks' : 'name';
  const dir = searchParams.get('dir') === 'desc' ? -1 : 1;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 500);
  const skip = Math.max(parseInt(searchParams.get('skip') || '0', 10) || 0, 0);

  const [map, docs] = await Promise.all([collectFromTracks(), Artist.find({}).lean()]);
  const byKey = new Map(docs.map((d) => [d._id, d]));

  const rows = [];
  for (const e of map.values()) {
    const d = byKey.get(e.key);
    rows.push({
      key: e.key,
      name: d?.name || e.name,
      trackCount: e.trackCount,
      trackGenres: [...e.trackGenres],
      gender: d?.gender || '',
      region: d?.region || '',
      genres: d?.genres || [],
      saved: !!d,
    });
  }
  // Nghệ sĩ đã lưu nhưng không còn bài nào (mồ côi) -> vẫn hiện để sửa/xoá.
  for (const d of docs) {
    if (!map.has(d._id)) rows.push({ key: d._id, name: d.name, trackCount: 0, trackGenres: [], gender: d.gender || '', region: d.region || '', genres: d.genres || [], saved: true });
  }

  let filtered = rows;
  if (q) filtered = filtered.filter((r) => r.name.toLowerCase().includes(q));
  if (missing === 'gender') filtered = filtered.filter((r) => !r.gender);
  else if (missing === 'region') filtered = filtered.filter((r) => !r.region);

  filtered.sort((a, b) =>
    sort === 'tracks' ? (b.trackCount - a.trackCount) * dir || a.name.localeCompare(b.name)
                      : a.name.localeCompare(b.name) * dir
  );

  const total = filtered.length;
  return json({ total, items: filtered.slice(skip, skip + limit) });
});

// POST /api/admin/artists  body:{ name, gender?, region?, genres? } -> tạo/ghi đè metadata 1 nghệ sĩ.
export const POST = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const body = await req.json();
  const name = String(body.name || '').trim();
  if (!name) return json({ error: 'name is required' }, 400);
  const key = artistKey(name);
  const doc = await Artist.findByIdAndUpdate(
    key,
    {
      $set: {
        name,
        gender: body.gender || '',
        region: body.region || '',
        genres: Array.isArray(body.genres) ? body.genres : [],
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  return json({ artist: doc }, 201);
});

// PATCH /api/admin/artists  body:{ items:[{key,name}], gender?, region? }
// Gán gender/region cho nhiều nghệ sĩ cùng lúc; upsert nếu chưa có doc.
export const PATCH = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ error: 'items array is required' }, 400);

  const set = {};
  if (body.gender !== undefined) set.gender = body.gender || '';
  if (body.region !== undefined) set.region = body.region || '';
  if (!Object.keys(set).length) return json({ error: 'gender or region is required' }, 400);

  const ops = items
    .filter((it) => it && it.key)
    .map((it) => ({
      updateOne: {
        filter: { _id: String(it.key) },
        update: { $set: set, $setOnInsert: { name: String(it.name || it.key) } },
        upsert: true,
      },
    }));
  if (!ops.length) return json({ error: 'no valid items' }, 400);
  const r = await Artist.bulkWrite(ops, { ordered: false });
  return json({ matched: r.matchedCount, modified: r.modifiedCount, upserted: r.upsertedCount, set });
});

// DELETE /api/admin/artists  body:{ keys:[...] } -> xoá metadata nghệ sĩ (không đụng track).
export const DELETE = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const body = await req.json().catch(() => ({}));
  const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
  if (!keys.length) return json({ error: 'keys array is required' }, 400);
  const r = await Artist.deleteMany({ _id: { $in: keys } });
  return json({ deleted: r.deletedCount });
});
