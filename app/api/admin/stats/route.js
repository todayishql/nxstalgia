import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import Entry from '@/models/Entry';
import Settings from '@/models/Settings';
import Award from '@/models/Award';
import { handle, json } from '@/lib/api';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await requireAuth();
  await dbConnect();

  const [tracks, entries, artByStatus, genreFilled, years, settings, awardTotal, awardWon] = await Promise.all([
    Track.countDocuments(),
    Entry.countDocuments(),
    Track.aggregate([{ $group: { _id: '$artworkStatus', n: { $sum: 1 } } }]),
    Track.countDocuments({ genre: { $nin: ['', null] } }),
    Entry.distinct('year'),
    Settings.findById('config').lean(),
    Award.countDocuments(),
    Award.countDocuments({ won: true }),
  ]);

  const artwork = { ok: 0, none: 0, pending: 0 };
  for (const a of artByStatus) if (a._id in artwork) artwork[a._id] = a.n;
  const genre = { filled: genreFilled, missing: Math.max(0, tracks - genreFilled) };

  const awards = { total: awardTotal, won: awardWon, nominees: Math.max(0, awardTotal - awardWon) };

  return json({ tracks, entries, artwork, genre, awards, years: years.sort((a, b) => a - b), settings });
});