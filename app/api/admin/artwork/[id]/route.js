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
  if (!track) return json({ error: 'Không tìm thấy track' }, 404);

  const { url, status } = await fetchArtwork({ name: track.name, artist: track.artist });
  track.artworkUrl = url;
  track.artworkStatus = status;
  await track.save();
  return json({ id, artworkUrl: url, artworkStatus: status });
});