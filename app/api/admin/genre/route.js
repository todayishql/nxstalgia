import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { fetchGenre } from '@/lib/itunes';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/admin/genre -> tra thể loại hàng loạt cho các track còn thiếu genre.
// body (tuỳ chọn): { limit: 25 }
export const POST = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  let body = {};
  try { body = await req.json(); } catch { /* body rỗng */ }
  const limit = Math.min(parseInt(body.limit || '25', 10), 100);

  const tracks = await Track.find({ genre: { $in: ['', null] } }).limit(limit);
  let ok = 0, none = 0, failed = 0;
  for (const track of tracks) {
    try {
      const { genre } = await fetchGenre({ name: track.name, artist: track.artist });
      if (genre) { track.genre = genre; await track.save(); ok++; }
      else none++;
    } catch {
      failed++; // để lần sau thử lại
    }
  }
  const remaining = await Track.countDocuments({ genre: { $in: ['', null] } });
  return json({ processed: tracks.length, ok, none, failed, remaining });
});
