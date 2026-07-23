import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import Artist from '@/models/Artist';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { splitArtists, artistKey } from '@/lib/artists';

export const runtime = 'nodejs';

// POST /api/admin/artists/sync
// Quét toàn bộ Track.artists -> tạo doc Artist cho các nghệ sĩ chưa có (metadata để trống, điền tay sau).
// KHÔNG đụng doc đã tồn tại (giữ nguyên gender/region đã gán).
export const POST = handle(async () => {
  await requireAuth();
  await dbConnect();

  const [tracks, existing] = await Promise.all([
    Track.find({}, { artists: 1, artist: 1 }).lean(),
    Artist.find({}, { _id: 1 }).lean(),
  ]);
  const have = new Set(existing.map((d) => d._id));

  const fresh = new Map(); // key -> name (dạng đầu tiên gặp)
  for (const t of tracks) {
    const names = Array.isArray(t.artists) && t.artists.length ? t.artists : splitArtists(t.artist);
    for (const nm of names) {
      const key = artistKey(nm);
      if (!key || have.has(key) || fresh.has(key)) continue;
      fresh.set(key, nm);
    }
  }

  let created = 0;
  if (fresh.size) {
    const docs = [...fresh.entries()].map(([key, name]) => ({ _id: key, name, gender: '', region: '', genres: [] }));
    const r = await Artist.insertMany(docs, { ordered: false });
    created = r.length;
  }
  return json({ created, totalArtists: have.size + created });
});
