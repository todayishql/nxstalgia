// Server-only: gắn tên hiển thị cho award (import model -> không dùng ở client component).
import Track from '@/models/Track';
import Artist from '@/models/Artist';

// track -> tra Track (tên luôn mới nhất); artist -> tên đã lưu, fallback Artist.name.
export async function decorateAwards(docs) {
  const trackIds = [...new Set(docs.filter((d) => d.type === 'track').map((d) => d.subject))];
  const artistKeys = [...new Set(docs.filter((d) => d.type === 'artist').map((d) => d.subject))];
  const [tracks, artists] = await Promise.all([
    trackIds.length ? Track.find({ _id: { $in: trackIds } }, { name: 1, artist: 1, artworkUrl: 1 }).lean() : [],
    artistKeys.length ? Artist.find({ _id: { $in: artistKeys } }, { name: 1 }).lean() : [],
  ]);
  const tById = new Map(tracks.map((t) => [t._id, t]));
  const aById = new Map(artists.map((a) => [a._id, a]));
  return docs.map((d) => {
    const t = d.type === 'track' ? tById.get(d.subject) : null;
    return {
      id: String(d._id),
      year: d.year,
      category: d.category,
      type: d.type,
      subject: d.subject,
      name: t ? t.name : d.name || aById.get(d.subject)?.name || d.subject,
      artist: t ? t.artist : '',
      artworkUrl: t ? t.artworkUrl || '' : '',
      missing: d.type === 'track' && !t, // track đã bị xoá -> vẫn hiện để admin dọn
      won: !!d.won,
      note: d.note || '',
    };
  });
}
