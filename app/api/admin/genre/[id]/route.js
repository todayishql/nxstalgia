import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { fetchGenre } from '@/lib/itunes';

export const runtime = 'nodejs';

// POST /api/admin/genre/:id -> tra lại thể loại 1 track từ iTunes (không đè giá trị đã có).
export const POST = handle(async (req, ctx) => {
  await requireAuth();
  await dbConnect();
  const { id } = await ctx.params;
  const track = await Track.findById(id);
  if (!track) return json({ error: 'Track not found' }, 404);

  const { genre } = await fetchGenre({ name: track.name, artist: track.artist });
  if (genre) { track.genre = genre; await track.save(); }
  return json({ id, genre: track.genre, found: !!genre });
});
