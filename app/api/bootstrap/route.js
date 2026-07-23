import dbConnect from '@/lib/mongodb';
import Track from '@/models/Track';
import Entry from '@/models/Entry';
import Settings from '@/models/Settings';
import Artist from '@/models/Artist';
import { handle, json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Dữ liệu công khai cho trang xem bảng xếp hạng: settings + tracks + entries + artists (metadata).
// Thống kê (peak/total/streak/woc) KHÔNG lưu — client tự tính từ entries.
export const GET = handle(async () => {
  await dbConnect();
  const [settings, tracks, entries, artists] = await Promise.all([
    Settings.findById('config').lean(),
    Track.find({}, { createdAt: 0, updatedAt: 0, __v: 0 }).lean(),
    Entry.find({}, { _id: 0, year: 1, week: 1, trackId: 1, rank: 1, stream: 1 })
      .sort({ year: 1, week: 1, rank: 1 })
      .lean(),
    // chỉ nghệ sĩ đã gán ít nhất 1 thuộc tính -> map key -> {gender, region, genres}
    Artist.find({ $or: [{ gender: { $nin: ['', null] } }, { region: { $nin: ['', null] } }] },
      { _id: 1, gender: 1, region: 1, genres: 1 }).lean(),
  ]);

  return json({
    settings: settings || { chartName: 'THE N[26]stalgia', currentYear: 2026, weeksPerYear: 52 },
    tracks: tracks.map((t) => ({ id: t._id, ...t, _id: undefined })),
    entries,
    artists: artists.map((a) => ({ key: a._id, gender: a.gender || '', region: a.region || '', genres: a.genres || [] })),
  });
});