import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import Entry from '@/models/Entry';
import Settings from '@/models/Settings';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await requireAuth();
  await dbConnect();

  const [tracks, entries, artByStatus, years, settings] = await Promise.all([
    Track.countDocuments(),
    Entry.countDocuments(),
    Track.aggregate([{ $group: { _id: '$artworkStatus', n: { $sum: 1 } } }]),
    Entry.distinct('year'),
    Settings.findById('config').lean(),
  ]);

  const artwork = { ok: 0, none: 0, pending: 0 };
  for (const a of artByStatus) if (a._id in artwork) artwork[a._id] = a.n;

  return json({ tracks, entries, artwork, years: years.sort((a, b) => a - b), settings });
});