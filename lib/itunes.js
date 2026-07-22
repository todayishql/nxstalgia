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
  if (!r) return null;
  const a = r.artworkUrl100;
  return {
    url: a ? a.replace('100x100', '300x300') : '',
    genre: (r.primaryGenreName || '').trim(),
  };
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
    if (hit && hit.url) return { url: hit.url, status: 'ok', genre: hit.genre };
    await new Promise((r) => setTimeout(r, 200)); // nhẹ tay với rate-limit
  }
  return { url: '', status: 'none', genre: '' };
}

// Tra thể loại cho bài đã có ảnh bìa nhưng thiếu genre: dùng chính lookup iTunes,
// nhưng chấp nhận cả kết quả không có ảnh (chỉ cần genre). Trả về { genre }.
export async function fetchGenre({ name, artist }) {
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
    if (hit && hit.genre) return { genre: hit.genre };
    await new Promise((r) => setTimeout(r, 200)); // nhẹ tay với rate-limit
  }
  return { genre: '' };
}