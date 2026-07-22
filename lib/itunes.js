import { primaryArtist } from './artists.js';

function cleanTerm(s) {
  return String(s || '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

async function searchOnce(term) {
  if (!term) return null;
  const url =
    'https://itunes.apple.com/search?term=' +
    encodeURIComponent(term) +
    '&media=music&entity=song&limit=1';
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('iTunes HTTP ' + res.status);
  const j = await res.json();
  const r = j.results && j.results[0];
  const a = r && r.artworkUrl100;
  if (!a) return null;
  // Lấy kèm genre trong cùng request -> auto-fill thể loại miễn phí khi tra ảnh bìa.
  return { url: a.replace('100x100', '300x300'), genre: (r.primaryGenreName || '').trim() };
}

// Tra ảnh bìa: thử tên bài + nghệ sĩ chính -> tên bài + artist gốc -> chỉ tên bài.
// Trả về { url, status, genre } với status: 'ok' | 'none'. Ném lỗi nếu network hỏng.
export async function fetchArtwork({ name, artist }) {
  const variants = [
    cleanTerm(`${name} ${primaryArtist(artist)}`),
    cleanTerm(`${name} ${artist}`),
    cleanTerm(name),
  ];
  const tried = new Set();
  for (const v of variants) {
    if (!v || tried.has(v)) continue;
    tried.add(v);
    const hit = await searchOnce(v);
    if (hit) return { url: hit.url, status: 'ok', genre: hit.genre };
    await new Promise((r) => setTimeout(r, 200)); // nhẹ tay với rate-limit
  }
  return { url: '', status: 'none', genre: '' };
}