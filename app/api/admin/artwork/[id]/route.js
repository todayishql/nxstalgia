import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { fetchArtwork } from '@/lib/itunes';

export const runtime = 'nodejs';

// POST /api/admin/artwork/:id -> tra lại ảnh bìa 1 track (dùng artists[0])
export const POST = handle(async (req, ctx) => {
  await requireAuth();
  await dbConnect();
  const { id } = await ctx.params;
  const track = await Track.findById(id);
  if (!track) return json({ error: 'Track not found' }, 404);

  const { url, status, genre } = await fetchArtwork({ name: track.name, artist: track.artist });
  track.artworkUrl = url;
  track.artworkStatus = status;
  if (genre && !track.genre) track.genre = genre; // chỉ điền khi trống, không đè giá trị đã sửa tay
  await track.save();
  return json({ id, artworkUrl: url, artworkStatus: status, genre: track.genre });
});