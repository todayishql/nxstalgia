import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { fetchArtwork } from '@/lib/itunes';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/admin/artwork -> tra ảnh bìa hàng loạt cho các track còn 'pending'.
// body (tuỳ chọn): { limit: 25, retryNone: false }
export const POST = handle(async (req) => {
  await requireAuth();
  await dbConnect();
  let body = {};
  try { body = await req.json(); } catch { /* body rỗng */ }
  const limit = Math.min(parseInt(body.limit || '25', 10), 100);
  const statuses = body.retryNone ? ['pending', 'none'] : ['pending'];

  const tracks = await Track.find({ artworkStatus: { $in: statuses } }).limit(limit);
  let ok = 0, none = 0, failed = 0;
  for (const track of tracks) {
    try {
      const { url, status, genre } = await fetchArtwork({ name: track.name, artist: track.artist });
      track.artworkUrl = url;
      track.artworkStatus = status;
      if (genre && !track.genre) track.genre = genre; // auto-fill genre khi trống
      await track.save();
      status === 'ok' ? ok++ : none++;
    } catch {
      failed++; // giữ nguyên pending để lần sau thử lại
    }
  }
  const remaining = await Track.countDocuments({ artworkStatus: 'pending' });
  return json({ processed: tracks.length, ok, none, failed, remaining });
});