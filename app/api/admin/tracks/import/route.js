import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { splitArtists } from '@/lib/artists';
import { songKey, makeIdGen } from '@/lib/songid';

export const runtime = 'nodejs';

// POST /api/admin/tracks/import  body:{ rows:[{id?, name, artist, baseline?, genre?, artworkUrl?}] }
// Mỗi dòng có "id" khớp với 1 bài đang có trong DB -> UPDATE bài đó (dùng cho luồng export CSV, sửa, import lại).
// Dòng không có "id" (hoặc id không khớp bài nào) -> thêm mới, id TỰ SINH, bỏ qua nếu trùng tên+nghệ sĩ
// với bài đã có hoặc với 1 dòng khác trong chính lô (chống thêm trùng khi import hàng loạt bài mới).
export const POST = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  const body = await req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return json({ error: 'rows array is required' }, 400);

  const existing = await Track.find({}, { name: 1, artist: 1 }).lean();
  const seen = new Set(existing.map((t) => songKey(t.name, t.artist)));
  const existingIds = new Set(existing.map((t) => String(t._id)));
  const genId = makeIdGen(existing.map((t) => t._id));

  const ops = [];
  let added = 0;
  let updated = 0;
  let skippedDup = 0;
  let skippedInvalid = 0;
  for (const r of rows) {
    const name = String(r.name || '').trim();
    const artist = String(r.artist || '').trim();
    if (!name || !artist) { skippedInvalid += 1; continue; }
    const baseline = Number(String(r.baseline ?? '').replace(/[^\d]/g, '')) || 0;
    const genre = String(r.genre || '').trim();
    const artworkUrl = String(r.artworkUrl || '').trim();

    const id = String(r.id || '').trim();
    if (id && existingIds.has(id)) {
      ops.push({
        updateOne: {
          filter: { _id: id },
          update: { $set: { name, artist, artists: splitArtists(artist), baseline, genre, artworkUrl, artworkStatus: artworkUrl ? 'ok' : 'pending' } },
        },
      });
      updated += 1;
      continue;
    }

    const key = songKey(name, artist);
    if (seen.has(key)) { skippedDup += 1; continue; }
    seen.add(key);
    ops.push({
      insertOne: {
        document: {
          _id: genId(),
          aid: '',
          name,
          artist,
          artists: splitArtists(artist),
          baseline,
          genre,
          artworkUrl,
          artworkStatus: artworkUrl ? 'ok' : 'pending',
        },
      },
    });
    added += 1;
  }

  if (ops.length) await Track.bulkWrite(ops, { ordered: false });
  return json({ added, updated, skippedDuplicate: skippedDup, skippedInvalid, received: rows.length });
});
