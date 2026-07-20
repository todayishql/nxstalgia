import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import Entry from '@/models/Entry';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { splitArtists } from '@/lib/artists';

export const runtime = 'nodejs';

// PUT /api/admin/tracks/:id  -> cập nhật metadata track
export const PUT = handle(async (req, ctx) => {
  await requireAuth();
  await dbConnect();
  const { id } = await ctx.params;
  const body = await req.json();

  const update = {};
  if (body.name != null) update.name = body.name;
  if (body.artist != null) {
    update.artist = body.artist;
    // artist đổi -> tự tính lại artists[] (trừ khi client gửi mảng riêng)
    update.artists =
      Array.isArray(body.artists) && body.artists.length ? body.artists : splitArtists(body.artist);
    // artist đổi -> ảnh bìa cũ có thể sai, đặt lại pending
    if (body.refetchArtwork !== false) {
      update.artworkStatus = 'pending';
      update.artworkUrl = '';
    }
  } else if (Array.isArray(body.artists)) {
    update.artists = body.artists;
  }
  if (body.aid != null) update.aid = body.aid;
  if (body.baseline != null) update.baseline = Number(body.baseline) || 0;
  if (body.artworkUrl != null) {
    update.artworkUrl = body.artworkUrl;
    update.artworkStatus = body.artworkUrl ? 'ok' : 'none';
  }

  const doc = await Track.findByIdAndUpdate(id, update, { new: true, runValidators: true });
  if (!doc) return json({ error: 'Track not found' }, 404);
  return json({ track: { id: doc._id, ...doc.toObject(), _id: undefined } });
});

// DELETE /api/admin/tracks/:id  -> xoá track + toàn bộ entries của nó
export const DELETE = handle(async (req, ctx) => {
  await requireAuth();
  await dbConnect();
  const { id } = await ctx.params;
  const doc = await Track.findByIdAndDelete(id);
  if (!doc) return json({ error: 'Track not found' }, 404);
  const { deletedCount } = await Entry.deleteMany({ trackId: id });
  return json({ ok: true, deletedEntries: deletedCount });
});
