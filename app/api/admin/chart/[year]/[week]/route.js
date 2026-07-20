import dbConnect from '@/lib/mongodb';
import Entry from '@/models/Entry';
import Track from '@/models/Track';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/admin/chart/:year/:week -> các entry của tuần đó (kèm tên bài/nghệ sĩ)
export const GET = handle(async (req, ctx) => {
  await requireAuth();
  await dbConnect();
  const { year, week } = await ctx.params;
  const y = parseInt(year, 10), w = parseInt(week, 10);

  const entries = await Entry.find({ year: y, week: w }).sort({ rank: 1 }).lean();
  const ids = entries.map((e) => e.trackId);
  const tracks = await Track.find({ _id: { $in: ids } }, { name: 1, artist: 1 }).lean();
  const meta = Object.fromEntries(tracks.map((t) => [t._id, t]));

  return json({
    year: y,
    week: w,
    rows: entries.map((e) => ({
      trackId: e.trackId,
      name: meta[e.trackId]?.name || '(track deleted)',
      artist: meta[e.trackId]?.artist || '',
      rank: e.rank,
      stream: e.stream,
    })),
  });
});

// PUT /api/admin/chart/:year/:week -> THAY THẾ toàn bộ entry của tuần bằng rows gửi lên.
// body: { rows: [{ trackId, rank, stream }] }
export const PUT = handle(async (req, ctx) => {
  await requireAuth();
  await dbConnect();
  const { year, week } = await ctx.params;
  const y = parseInt(year, 10), w = parseInt(week, 10);
  const { rows } = await req.json();
  if (!Array.isArray(rows)) return json({ error: 'rows array is required' }, 400);

  // Kiểm tra track tồn tại
  const ids = [...new Set(rows.map((r) => String(r.trackId)))];
  const known = new Set((await Track.find({ _id: { $in: ids } }, { _id: 1 }).lean()).map((t) => t._id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) return json({ error: 'trackId does not exist: ' + unknown.join(', ') }, 400);

  const ops = rows.map((r) => ({
    updateOne: {
      filter: { year: y, week: w, trackId: String(r.trackId) },
      update: {
        $set: {
          rank: r.rank == null || r.rank === '' ? null : Number(r.rank),
          stream: Number(r.stream) || 0,
        },
      },
      upsert: true,
    },
  }));
  if (ops.length) await Entry.bulkWrite(ops);

  // Xoá các entry cũ của tuần không còn trong rows.
  await Entry.deleteMany({ year: y, week: w, trackId: { $nin: ids } });

  return json({ ok: true, count: rows.length });
});