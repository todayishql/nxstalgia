import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { splitArtists } from '@/lib/artists';
import { songKey, makeIdGen } from '@/lib/songid';

export const runtime = 'nodejs';

// POST /api/admin/tracks/import  body:{ rows:[{name, artist, baseline?, artworkUrl?}] }
// Thêm hàng loạt bài mới: id TỰ SINH, bỏ qua bài trùng (theo tên+nghệ sĩ) trong DB hoặc trong chính lô.
export const POST = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const body = await req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return json({ error: 'rows array is required' }, 400);

  const existing = await Track.find({}, { name: 1, artist: 1 }).lean();
  const seen = new Set(existing.map((t) => songKey(t.name, t.artist)));
  const genId = makeIdGen(existing.map((t) => t._id));

  const ops = [];
  let added = 0;
  let skippedDup = 0;
  let skippedInvalid = 0;
  for (const r of rows) {
    const name = String(r.name || '').trim();
    const artist = String(r.artist || '').trim();
    if (!name || !artist) { skippedInvalid += 1; continue; }
    const key = songKey(name, artist);
    if (seen.has(key)) { skippedDup += 1; continue; }
    seen.add(key);
    const artworkUrl = String(r.artworkUrl || '').trim();
    ops.push({
      insertOne: {
        document: {
          _id: genId(),
          aid: '',
          name,
          artist,
          artists: splitArtists(artist),
          baseline: Number(String(r.baseline ?? '').replace(/[^\d]/g, '')) || 0,
          genre: String(r.genre || '').trim(),
          artworkUrl,
          artworkStatus: artworkUrl ? 'ok' : 'pending',
        },
      },
    });
    added += 1;
  }

  if (ops.length) await Track.bulkWrite(ops, { ordered: false });
  return json({ added, skippedDuplicate: skippedDup, skippedInvalid, received: rows.length });
});
